// Syncing the books between a person's own devices (issue #123), stage 1.
//
// Off unless the person switched it on for this device (consent screen,
// "Eigene Geräte synchronisieren"; a flag in this browser). Then the node
// under Helia and OrbitDB goes online the way the UCEP node does
// (ucep/net.js): a WebSocket to the relay, a reservation there, WebRTC for the
// direct connection the relay helps to set up. Every device of the same
// passkey opens the same databases (their names come from the PRF answer),
// and OrbitDB replicates them over gossipsub; everything is sealed before it
// is written, so the relay and the network see ciphertext only. And only
// a device that proved it holds the passkey gets them at all (device-gate.js):
// not the relay, not a peer whose id someone typed in by mistake.
//
// Devices find each other by peer id: each device writes itself into the
// sealed settings (`device:<peer id>`), the settings replicate, and every
// device dials the ones it knows through the relay – now, and again while
// they are not connected. The first time, one device's id is typed or
// scanned on the other (Integrationen → Eigene Geräte; `belege-device:<id>`
// as a QR code).
//
// Removing a device soft-deletes its record. The deletion replicates; every
// device hangs up on it and refuses it from then on (the connection gater
// reads `blocked`), and the removed device, once it learns, switches its
// own sync off. Switched on there again later, the newer switch wins and it
// writes itself back. Removing ends the syncing, not the access: whoever
// holds the passkey can open the books.
//
// OrbitDB 4.0.0 exchanges heads once per peer, when gossipsub says it
// subscribed, and never again; over a relayed (limited) connection that dial
// is refused and swallowed. So once a device is connected directly, every
// database's sync is restarted once (bounded, debounced) – the exchange then
// runs over the direct connection.
//
// gossipsub keeps its streams on the first connection to a device, the
// relay's circuit. When the relay closes it beside a direct connection,
// gossipsub is told of the connection that is left (regossip.js, #393), and
// the databases exchange their heads once more.

import { FaultTolerance } from '@libp2p/interface';
import { isLoopback, isPrivate } from '@libp2p/utils';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { NODE_INFO, gatedIdentify } from './quiet-identify.js';
import { gossipsub } from '@libp2p/gossipsub';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { isLocal } from '../ucep/net.js';
import { qrTransport } from './qr-link.js';
import { connectionToRegossip, gossips, regossip } from './regossip.js';
import { t } from '../i18n/index.js';

export const SYNC_FLAG_KEY = 'belege.device-sync';
export const DEVICE_SALT_KEY = 'belege.device-salt';
/** How often a known device that is not connected is dialled again. */
export const REDIAL_MS = 30_000;
/** A WebSocket on this machine: where a bridge's node listens for the browser beside it. */
const LOOPBACK_WS = /^\/(ip4\/127\.\d+\.\d+\.\d+|ip6\/::1)\/tcp\/\d+\/ws(\/|$)/;
/** How long a connected device may stay without a gossipsub stream before it is hung up. */
export const MUTE_MS = 45_000;
/** No device is hung up for being mute more often than this: a wrong guess must not loop. */
export const HANGUP_EVERY_MS = 5 * 60_000;
/** The first wait before a lost place at a relay is asked for again; it doubles up to RELAY_RETRY_MAX_MS. */
export const RELAY_RETRY_MS = 30_000;
export const RELAY_RETRY_MAX_MS = 10 * 60_000;
/**
 * After a connection to a device closed: how long until gossipsub is looked
 * at. Its own bookkeeping of the closed streams has run by then, and a device
 * that is gone altogether has been reported as disconnected.
 */
export const REGOSSIP_SETTLE_MS = 250;
/**
 * How much later the device with the greater peer id runs its extra heads
 * exchange. Both devices see the same connection open or close at the same
 * moment; restarting every database's sync on both at once, each can ask
 * while the other has just stopped listening, and the exchange is lost. One
 * after the other, either restart alone brings both up to date.
 */
export const RESYNC_STAGGER_MS = 3000;
/**
 * Pings report the devices' state no more often than this: each one is a
 * pulse at once, but the state a pulse changes (a link's round trip) is told
 * once for all the pings that came in meanwhile, not once per ping.
 */
export const PULSE_REPORT_MS = 1000;
/** How often gossipsub is told of the connection that is left, a second apart, before the redial round takes over. */
export const REGOSSIP_TRIES = 5;
/** A settings record per device: one record each, so two devices never overwrite each other. */
export const DEVICE_PREFIX = 'device:';

/** A WebSocket address without TLS. @param {string} addr */
const insecureWebSocket = (addr) => /\/ws(\/|$)/.test(addr) && !/\/tls(\/|$)/.test(addr);

/** @returns {Storage | null} */
function storage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** @returns {string | null} */
function flag() {
	try {
		return storage()?.getItem(SYNC_FLAG_KEY) ?? null;
	} catch {
		return null;
	}
}

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** Whether this device syncs (the consent screen's switch). */
export function deviceSyncOn() {
	const v = flag();
	return v === 'on' || (v !== null && ISO.test(v));
}

/**
 * When the switch was turned on (ISO), '' when not known (an earlier build
 * stored `on`): a removal that is newer switches this device off.
 */
export function deviceSyncSince() {
	const v = flag();
	return v !== null && ISO.test(v) ? v : '';
}

/** @param {boolean} on @param {() => Date} [now] */
export function setDeviceSync(on, now = () => new Date()) {
	try {
		if (on) storage()?.setItem(SYNC_FLAG_KEY, now().toISOString());
		else storage()?.removeItem(SYNC_FLAG_KEY);
	} catch {
		// Blocked: stays off.
	}
}

/** No STUN server: host candidates only (the own network's mode). */
const noStun = () => ({ iceServers: [] });

/** Peers removed from the books: refused by the node's connection gater. */
export const blocked = new Set();

/** The devices the books know (not removed), for the device gate's first-contact rule. */
export const knownPeers = new Set();

/**
 * What the device gate needs besides `knownPeers` (first-contact.js): whether
 * the books' device list has been read yet, and whether it ever named another
 * device – removed ones count. Books that never knew another device let their
 * first one in (a new own device, a member who just joined).
 */
export const knownState = { loaded: false, ever: false };

/** Devices that proved the books' key but are not on their list: asking to be let in. */
export const asking = new Set();

/** A device's record as it would come from the books, before the books have it. @param {string} peerId @param {string} label @returns {Device} */
const deviceOf = (peerId, label) => ({
	peerId,
	label,
	addedAt: '',
	removed: false,
	changedAt: '',
	bridge: false,
	addrs: [],
	hosted: null,
	bridgeScopes: null
});

const QR_PREFIX = 'belege-device:';

/** What a device shows as its QR code. @param {string} peerId */
export const deviceCode = (peerId) => `${QR_PREFIX}${peerId}`;

/**
 * Whether a connection's remote address reaches the device itself rather
 * than through a relay. By the address, not `limited`: a relay that sets no
 * limits (the test relay, a bridge's) gives a circuit that is not limited,
 * and still relayed. WebRTC signalled through a relay is direct – but only
 * WebRTC after the circuit: the bridge's relay is itself reached over
 * `/webrtc-direct`, and a circuit through it is not.
 * @param {string} addr
 */
export function isDirectAddr(addr) {
	const circuit = addr.lastIndexOf('/p2p-circuit');
	return circuit < 0 || /\/webrtc(\/|$)/.test(addr.slice(circuit));
}

/**
 * A scanned or pasted code → the peer id in it, or null.
 *
 * @param {unknown} text
 */
export function parseDeviceCode(text) {
	const raw = String(text ?? '').trim();
	const id = raw.startsWith(QR_PREFIX) ? raw.slice(QR_PREFIX.length) : raw;
	return isPeerId(id) ? id : null;
}

/**
 * This device's salt for its peer key (database-keys.js deriveDevicePeerSeed),
 * made once and kept in this browser; alone it is worth nothing.
 */
export function deviceSalt() {
	const s = storage();
	const kept = s?.getItem(DEVICE_SALT_KEY);
	if (kept && /^[0-9a-f]{32}$/.test(kept)) return kept;
	const fresh = [...crypto.getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	try {
		s?.setItem(DEVICE_SALT_KEY, fresh);
	} catch {
		// Not kept: a new peer id next time, which only means dialling it anew.
	}
	return fresh;
}

/**
 * The network switch of the header menu (network-pause.js): while it is off,
 * the sync node dials nobody and lets nobody in – the books stay open, the
 * network is shut. Module state, like `blocked`: the gater reads it on every
 * connection.
 */
let gateClosed = false;
/** @param {boolean} closed */
export function setSyncGateClosed(closed) {
	gateClosed = closed;
}

/**
 * The online node's config: the UCEP transports plus gossipsub for OrbitDB;
 * in the own network's mode WebRTC-Direct to the bridge's relay instead of a
 * WebSocket – or, in the mode "Ohne Relay, per QR" (network-mode.js), only the transport
 * that carries a connection two scanned codes built (qr-link.js): no
 * WebSocket, no relay, nothing it could dial on its own.
 *
 * @param {{ privateKey: any, relays: string[], gate: { service: (components: any) => any, isProved: (peerId: string) => boolean, onProved: (listener: (peerId: string) => void) => () => void }, mode?: import('./network-mode.js').NetworkMode }} params
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function syncLibp2pConfig({ privateKey, relays, gate, mode = 'public' }) {
	const qr = mode === 'qr';
	const lan = mode === 'lan';
	const both = mode === 'both';
	// A device that has just proved the passkey is asked again: only now is it
	// told – and tells – more than the public list.
	const whoAmI = gatedIdentify(gate);
	gate.onProved((/** @type {string} */ peer) => {
		whoAmI.learn(peer).catch(() => {});
	});
	return {
		privateKey,
		addresses: {
			listen: qr ? [] : [...relays.map((relay) => `${relay}/p2p-circuit`), '/webrtc']
		},
		transports: qr
			? [qrTransport()]
			: both
				? // Everything: codes, the bridge's relay by WebRTC-Direct, the public relays.
					[
						qrTransport(),
						webSockets(),
						webRTCDirect({ rtcConfiguration: noStun() }),
						webRTC(),
						circuitRelayTransport()
					]
				: lan
					? // The bridge's relay by WebRTC-Direct, then WebRTC between the devices;
						// host candidates only, so no STUN server is asked.
						[
							webRTCDirect({ rtcConfiguration: noStun() }),
							webRTC({ rtcConfiguration: noStun() }),
							circuitRelayTransport()
						]
					: [webSockets(), webRTC(), circuitRelayTransport()],
		// Not the browser's user agent string (quiet-identify.js).
		nodeInfo: NODE_INFO,
		// A relay that is down must not keep the books from opening on the others.
		transportManager: { faultTolerance: FaultTolerance.NO_FATAL },
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionManager: { inboundConnectionThreshold: 100 },
		connectionGater: {
			// A relay in the own network (or the test relay) has a private address,
			// which libp2p refuses to dial by default – and so has the bridge's own
			// node on this machine (127.0.0.1, remote-bridge.js), in every mode.
			denyDialMultiaddr:
				lan || both || relays.some(isLocal)
					? () => gateClosed
					: // libp2p's own rule for a browser (private addresses, insecure
						// WebSockets), with this machine let through. WebSockets over TLS
						// are secure however written: the Le Space relays announce
						// `/tls/ws` (or `/tls/sni/<host>/ws`), not `/wss`.
						(/** @type {any} */ addr) =>
							gateClosed ||
							(!isLoopback(addr) && (isPrivate(addr) || insecureWebSocket(addr.toString()))),
			// A device removed from the books is neither dialled nor let in; with
			// the network switched off in the header, nobody is.
			denyDialPeer: (/** @type {any} */ peerId) => gateClosed || blocked.has(String(peerId)),
			denyInboundConnection: () => gateClosed,
			denyOutboundConnection: () => gateClosed,
			denyInboundEncryptedConnection: (/** @type {any} */ peerId) =>
				gateClosed || blocked.has(String(peerId))
		},
		services: {
			// First: it wraps the registrar before anything registers there.
			deviceGate: gate.service,
			// Two lists (quiet-identify.js): a relay or a stranger is told identify
			// and the relay protocols only; a device that proved the passkey the rest.
			...whoAmI.services,
			pubsub: gossipsub({
				emitSelf: false,
				allowPublishToZeroTopicPeers: true,
				// OrbitDB's sync rides gossipsub; over a relayed connection too.
				runOnLimitedConnection: true
			})
		}
	};
}

/** Whether a peer id looks like one libp2p makes (Ed25519, base58). @param {unknown} id */
export const isPeerId = (id) => /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/.test(String(id ?? ''));

/**
 * @typedef {{ peerId: string, label: string, addedAt: string, removed: boolean, changedAt: string, bridge: boolean, addrs: string[], hosted: { host: string } | null, bridgeScopes: string[] | null }} Device
 *   `bridge`: the bridge's own node (remote-bridge.js, #573) – a device of the books that holds no books,
 *   so no replication is expected of it; `bridgeScopes`: what the person ticked for it at the bridge when
 *   adding it (#579) – the bridge gives these to a device new to it; null: every scope, as before; `addrs`: where it listens besides the relays (its WebSocket on the
 *   machine it runs on), from its invitation; `hosted`: a bridge in a confidential VM, paired with the
 *   unlock after this browser attested it (integrations/hosted-bridge.js, #585), and the VM's name
 */

/** A bridge scope's name (@le-space/bridge-protocol). */
const SCOPE_NAME = /^bridge:[a-z]+(:[a-z]+)?$/;

/**
 * The bridge scopes a device record carries: names only, at most 32; null
 * when it carries none (every scope, as before #579).
 *
 * @param {unknown} raw
 * @returns {string[] | null}
 */
export function bridgeScopesOf(raw) {
	if (!Array.isArray(raw)) return null;
	return [...new Set(raw.filter((s) => typeof s === 'string' && SCOPE_NAME.test(s)))]
		.slice(0, 32)
		.sort();
}

/**
 * Every device the books have a record of – its latest record, since two
 * devices may add the same one at once: removed when that one is deleted.
 * Pass the deleted records too (`list({ includeDeleted: true })`).
 *
 * @param {Record<string, any>[]} settingsRecords
 * @returns {Device[]}
 */
export function deviceRecords(settingsRecords) {
	/** @type {Map<string, Record<string, any>>} */
	const latest = new Map();
	/** The newest name a device was given: the device names itself, another may not know it. */
	/** @type {Map<string, { label: string, at: string }>} */
	const names = new Map();
	for (const r of settingsRecords) {
		const key = String(r.key ?? '');
		if (!key.startsWith(DEVICE_PREFIX)) continue;
		const at = String(r.updatedAt ?? '');
		const kept = latest.get(key);
		if (!kept || at > String(kept.updatedAt ?? '')) latest.set(key, r);
		const label = String(r.value?.label ?? '');
		if (label && at >= (names.get(key)?.at ?? '')) names.set(key, { label, at });
	}
	return [...latest.values()]
		.map((r) => ({
			peerId: String(r.key).slice(DEVICE_PREFIX.length),
			label: names.get(String(r.key))?.label ?? '',
			addedAt: String(r.value?.addedAt ?? ''),
			removed: Boolean(r.deleted),
			changedAt: String(r.updatedAt ?? ''),
			bridge: Boolean(r.value?.bridge),
			addrs: Array.isArray(r.value?.addrs) ? r.value.addrs.map(String).slice(0, 8) : [],
			hosted:
				r.value?.bridge && typeof r.value?.hosted?.host === 'string'
					? { host: r.value.hosted.host.slice(0, 253) }
					: null,
			bridgeScopes: bridgeScopesOf(r.value?.bridgeScopes)
		}))
		.filter((d) => isPeerId(d.peerId));
}

/**
 * The devices the books know and have not removed.
 *
 * @param {Record<string, any>[]} settingsRecords
 */
export const knownDevices = (settingsRecords) =>
	deviceRecords(settingsRecords).filter((d) => !d.removed);

/**
 * Keep the devices connected and the books in step, on an online node.
 *
 * @param {object} p
 * @param {any} p.libp2p the node under Helia and OrbitDB
 * @param {{ settings: import('../store/repository.js').Collection, resync: () => Promise<void> }} p.store
 * @param {string[]} p.relays
 * @param {string} p.label this device, as the person may call it
 * @param {string} [p.since] when sync was switched on here (deviceSyncSince)
 * @param {(state: SyncState) => void} [p.onState]
 * @param {(pulse: SyncPulse) => void} [p.onPulse] an own device answered a ping
 * @param {() => void} [p.onRemoved] another device removed this one
 * @param {{ isProved: (peerId: string) => boolean, forget: (peerId: string) => void, proveTo?: (peerId: string) => Promise<void>, onProved?: (listener: (peerId: string) => void) => () => void }} [p.gate]
 *   which peers proved the passkey (device-gate.js); one that has not is not connected
 * @param {() => string} [p.now]
 */
export async function startDeviceSync({
	libp2p,
	store,
	relays,
	label,
	since = '',
	onState = () => {},
	onPulse = () => {},
	onRemoved = () => {},
	gate = { isProved: () => true, forget: () => {} },
	now = () => new Date().toISOString()
}) {
	const self = libp2p.peerId.toString();
	/** @type {Set<string>} */
	const known = new Set();
	/** @type {Set<string>} */
	const resynced = new Set();
	let stopped = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let resyncTimer;

	const all = () => store.settings.list({ includeDeleted: true });
	/** @type {Map<string, Device>} */
	let records = new Map();
	/** Removed by another device after sync was switched on here. */
	const removedHere = (/** @type {Device | undefined} */ d) =>
		Boolean(d?.removed && d.changedAt > since);

	/**
	 * A device's record, new or back from removed: the latest record of an
	 * earlier removal is taken up again rather than a second one written.
	 *
	 * @param {string} peerId
	 * @param {string} name
	 * @param {{ bridge?: boolean, addrs?: string[], hosted?: { host: string } | null, bridgeScopes?: string[] | null }} [how] the bridge's node (no books on it), where it listens, and the VM it runs in; what the person ticked for it at the bridge (#579)
	 */
	async function writeDevice(
		peerId,
		name,
		{ bridge = false, addrs = [], hosted = null, bridgeScopes = null } = {}
	) {
		const key = `${DEVICE_PREFIX}${peerId}`;
		const latest = (await all())
			.filter((r) => r.key === key)
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
		if (latest && !latest.deleted) return;
		await store.settings.put({
			...(latest ? { id: latest.id } : {}),
			key,
			value: {
				label: name || latest?.value?.label || '',
				addedAt: now(),
				...(bridge ? { bridge: true, addrs: addrs.slice(0, 8) } : {}),
				...(bridge && hosted ? { hosted: { host: hosted.host } } : {}),
				...(!bridge && bridgeScopes ? { bridgeScopes: bridgeScopesOf(bridgeScopes) } : {})
			},
			deleted: false
		});
	}

	// This device, in the books (once; the record replicates to the others).
	// Removed before it was switched on again here: back in.
	const mine = deviceRecords(await all()).find((d) => d.peerId === self);
	if (removedHere(mine)) {
		onRemoved();
		return {
			self,
			removed: true,
			async addDevice() {
				throw new Error(t('messages.sync.removed'));
			},
			async removeDevice() {},
			/** @returns {Promise<boolean>} */
			async bridgeListensAt() {
				return false;
			},
			expectDevice() {},
			refresh() {},
			async stop() {}
		};
	}
	// A member's device writes its record once the books' grant has come over
	// (#612): until then the access list refuses it, and every round tries again.
	let selfWritten = Boolean(mine && !mine.removed);
	async function writeSelf() {
		if (selfWritten) return;
		try {
			await writeDevice(self, label);
			selfWritten = true;
		} catch {
			// Not allowed yet: the grant is on its way.
		}
	}
	await writeSelf();

	/** @returns {any[]} the connections to a device */
	const linksTo = (/** @type {string} */ peerId) =>
		libp2p.getConnections().filter((/** @type {any} */ c) => c.remotePeer.toString() === peerId);
	const open = (/** @type {string} */ peerId) => linksTo(peerId).length > 0;
	const connected = (/** @type {string} */ peerId) => open(peerId) && gate.isProved(peerId);
	const direct = (/** @type {string} */ peerId) =>
		libp2p
			.getConnections()
			.some(
				(/** @type {any} */ c) =>
					c.remotePeer.toString() === peerId && isDirectAddr(c.remoteAddr.toString())
			);

	/**
	 * Is gossipsub talking to this device? OrbitDB's heads ride gossipsub, so a
	 * connection carrying no `/meshsub/` stream replicates nothing, however
	 * healthy it looks – and that is exactly the state #393 leaves behind: the
	 * relay closes the circuit gossipsub bound its streams to, the direct
	 * connection beside it survives, and gossipsub opens nothing on the
	 * survivor. Asking whether a connection is open cannot see that.
	 */
	const gossiping = (/** @type {string} */ peerId) => {
		const to = linksTo(peerId);
		// Both ways: each device opens only the stream it speaks on.
		return gossips(to, 'outbound') && gossips(to, 'inbound');
	};

	/** Since when a device has been connected with gossipsub silent, in ms. */
	const muteSince = new Map();
	/** When each device was last hung up for it, so a false alarm cannot loop. */
	const lastHangUp = new Map();
	let hangUps = 0;

	/**
	 * Devices that were removed and are being added again right now: a bridge
	 * whose pairing was undone keeps its peer id, and pairing it again starts
	 * with dialling it – before any record says it is back.
	 * @type {Set<string>}
	 */
	const expected = new Set();

	async function refreshKnown() {
		records = new Map(deviceRecords(await all()).map((d) => [d.peerId, d]));
		if (removedHere(records.get(self))) {
			await leave();
			return;
		}
		known.clear();
		knownPeers.clear();
		knownState.ever = [...records.keys()].some((p) => p !== self);
		knownState.loaded = true;
		for (const d of records.values()) {
			if (d.peerId === self) continue;
			// Being paired again (expectDevice): its record is still the removal's.
			if (d.removed && expected.has(d.peerId)) continue;
			if (d.removed) {
				if (!blocked.has(d.peerId)) {
					blocked.add(d.peerId);
					gate.forget(d.peerId);
					await hangUp(d.peerId);
				}
			} else {
				blocked.delete(d.peerId);
				known.add(d.peerId);
				knownPeers.add(d.peerId);
				asking.delete(d.peerId);
			}
		}
	}

	/** @param {string} peerId */
	async function hangUp(peerId) {
		for (const c of libp2p.getConnections())
			if (c.remotePeer.toString() === peerId) await c.close().catch(() => {});
	}

	/**
	 * Hang up a device that has been connected while gossipsub stayed silent.
	 *
	 * Dialling it again would change nothing – libp2p hands back the connection
	 * that already exists instead of building a circuit – so the connection has
	 * to go, and the next dial builds one gossipsub will actually use. Waiting
	 * `MUTE_MS` first keeps a connection that is merely still settling; the
	 * rate limit keeps a wrong guess from hanging up a working device in a loop.
	 *
	 * @param {string} peerId
	 * @returns {Promise<boolean>} whether it was hung up
	 */
	async function hangUpIfMute(peerId) {
		const at = Date.parse(now());
		if (gossiping(peerId)) {
			muteSince.delete(peerId);
			return false;
		}
		const since = muteSince.get(peerId);
		if (since === undefined) {
			muteSince.set(peerId, at);
			return false;
		}
		if (at - since < MUTE_MS) return false;
		const last = lastHangUp.get(peerId);
		if (last !== undefined && at - last < HANGUP_EVERY_MS) return false;
		lastHangUp.set(peerId, at);
		muteSince.delete(peerId);
		hangUps++;
		await hangUp(peerId);
		return true;
	}

	/** Timers of `putGossipBack`, by device: one look at a time. @type {Map<string, ReturnType<typeof setTimeout>>} */
	const regossiping = new Map();

	/**
	 * Put gossipsub back on a connection to a device it has no stream of its
	 * own to (#393, regossip.js): told of the best connection that is left, as
	 * it would be of a new one, and looked at again a second later until the
	 * stream is there. Then every database exchanges its heads once more: what
	 * was written into the silence is not sent again by itself, and OrbitDB
	 * saw no disconnect that would make it ask.
	 *
	 * Nothing is dialled and nothing closed. Not while the network is paused,
	 * and not for a device that has not proved the passkey.
	 *
	 * @param {string} peerId
	 * @param {number} [tries] how often it is still told when the stream does not come
	 */
	function putGossipBack(peerId, tries = REGOSSIP_TRIES) {
		clearTimeout(regossiping.get(peerId));
		regossiping.delete(peerId);
		if (stopped || gateClosed || !known.has(peerId) || isBridge(peerId) || !connected(peerId))
			return;
		const connection = connectionToRegossip(linksTo(peerId), isDirectAddr);
		if (!connection) return;
		if (tries <= 0 || !regossip(libp2p, connection)) return;
		regossiping.set(
			peerId,
			setTimeout(() => {
				regossiping.delete(peerId);
				if (stopped) return;
				if (gossips(linksTo(peerId), 'outbound')) {
					report();
					resyncSoon(peerId);
				} else putGossipBack(peerId, tries - 1);
			}, 1000)
		);
	}

	/**
	 * Every database's heads exchange once more, a moment from now; several
	 * askings make one. The two devices take turns (RESYNC_STAGGER_MS).
	 *
	 * @param {string} peerId the device it is for
	 */
	function resyncSoon(peerId) {
		clearTimeout(resyncTimer);
		resyncTimer = setTimeout(
			() => {
				if (!stopped) store.resync().catch(() => {});
			},
			1000 + (self > peerId ? RESYNC_STAGGER_MS : 0)
		);
	}

	/** Another device removed this one: stop and hang up. */
	async function leave() {
		if (stopped) return;
		await stopAll();
		for (const peerId of known) await hangUp(peerId);
		known.clear();
		onRemoved();
	}

	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let pulseReport;
	/** The state, once for every ping in the next PULSE_REPORT_MS. */
	function reportSoon() {
		if (pulseReport !== undefined) return;
		pulseReport = setTimeout(() => {
			pulseReport = undefined;
			if (!stopped) report();
		}, PULSE_REPORT_MS);
	}

	/** @type {WeakSet<object>} connections whose pings are watched */
	const watched = new WeakSet();
	/**
	 * libp2p's connection monitor pings every connection (every 10 s) and
	 * writes the round trip to `conn.rtt`. Watched here, not sent: an own
	 * device's answer is a pulse, with no ping of our own on the wire.
	 *
	 * @param {any} conn
	 */
	function watchPings(conn) {
		if (!conn || watched.has(conn)) return;
		watched.add(conn);
		let rtt = conn.rtt;
		try {
			Object.defineProperty(conn, 'rtt', {
				configurable: true,
				enumerable: true,
				get: () => rtt,
				set: (value) => {
					rtt = value;
					const peerId = conn.remotePeer.toString();
					if (stopped || !connected(peerId)) return;
					onPulse({
						peerId,
						rtt: Math.round(value),
						addr: conn.remoteAddr.toString(),
						at: Date.now()
					});
					reportSoon();
				}
			});
		} catch {
			// A connection that does not let its rtt be watched: no pulse from it.
		}
	}

	/** The connections to a device, as they are: address, direct or relayed, round trip. @param {string} peerId */
	const links = (peerId) =>
		libp2p
			.getConnections()
			.filter((/** @type {any} */ c) => c.remotePeer.toString() === peerId)
			.map((/** @type {any} */ c) => {
				watchPings(c);
				const addr = c.remoteAddr.toString();
				return {
					addr,
					direct: isDirectAddr(addr),
					rtt: typeof c.rtt === 'number' ? Math.round(c.rtt) : null
				};
			});

	function report() {
		/** @type {string[]} */
		const addrs = libp2p.getMultiaddrs().map((/** @type {any} */ a) => a.toString());
		onState({
			self,
			reachable: addrs.some((a) => a.includes('/p2p-circuit')),
			hangUps,
			addrs,
			asking: [...asking].filter((p) => !blocked.has(p)),
			devices: [...known].map((peerId) => ({
				peerId,
				label: records.get(peerId)?.label ?? '',
				connected: connected(peerId),
				direct: direct(peerId),
				gossiping: gossiping(peerId),
				links: links(peerId),
				...(isBridge(peerId) ? { bridge: true } : {}),
				...(records.get(peerId)?.hosted ? { hosted: records.get(peerId)?.hosted } : {})
			}))
		});
	}

	/** The bridge's node holds no books: gossipsub stays silent to it by design. @param {string} peerId */
	const isBridge = (peerId) => Boolean(records.get(peerId)?.bridge);

	/**
	 * Where a device is dialled: through the relays; the bridge's node also where
	 * it listens itself (on this machine). Empty in the mode "Ohne Relay, per QR":
	 * a connection two scanned codes built cannot be dialled again.
	 *
	 * @param {string} peerId
	 */
	const dialAddrs = (peerId) => [
		...relays.map((relay) => `${relay}/p2p-circuit/p2p/${peerId}`),
		...(records.get(peerId)?.addrs ?? [])
	];

	/** @param {string} peerId */
	async function dial(peerId) {
		if (stopped) return;
		const addrs = dialAddrs(peerId);
		if (open(peerId)) {
			// Connected, but not proved yet (the first exchange failed): again.
			await gate.proveTo?.(peerId);
			if (isBridge(peerId)) return;
			// Open is not the same as replicating. A mute one first has gossipsub
			// put back on it, should the look after a closed connection have
			// missed it; one that stays mute is hung up, and then dialled below
			// as if it had never been connected (#393, #403).
			// Only one seen mute on an earlier round already: a connection that
			// is just being set up has no streams yet either.
			if (muteSince.has(peerId) && !regossiping.has(peerId) && !gossiping(peerId))
				putGossipBack(peerId);
			// Nowhere to dial it again (QR mode): the connection is all there is,
			// so it stays, and gossipsub is put back on it round after round.
			if (!addrs.length) {
				if (gossiping(peerId)) muteSince.delete(peerId);
				else if (!muteSince.has(peerId)) muteSince.set(peerId, Date.parse(now()));
				return;
			}
			if (!(await hangUpIfMute(peerId))) return;
		}
		const { multiaddr } = await import('@multiformats/multiaddr');
		for (const addr of addrs) {
			try {
				await libp2p.dial(multiaddr(addr), { signal: AbortSignal.timeout(15_000) });
				return;
			} catch {
				// Not there, or not yet: tried again on the next round.
			}
		}
	}

	/** When the place at a relay may be asked for again, and how long the wait after that is. */
	let relayRetryAt = 0;
	let relayRetryMs = RELAY_RETRY_MS;

	/**
	 * Keep a place at a relay. libp2p reserves one at each configured relay once,
	 * at start (circuit-relay-v2's listener); when the relay connection goes – a
	 * laptop asleep, another network, a redeployed relay – the address goes with
	 * it and is never asked for again, so this device stays reachable by nobody
	 * until a reload. Without any place, listen on the relays once more; after a
	 * failure wait longer each time, up to ten minutes.
	 */
	async function keepRelayPlace() {
		if (!relays.length || gateClosed) return;
		const placed = libp2p
			.getMultiaddrs()
			.some((/** @type {any} */ a) => String(a).includes('/p2p-circuit'));
		if (placed) {
			relayRetryMs = RELAY_RETRY_MS;
			return;
		}
		const at = Date.parse(now());
		if (at < relayRetryAt) return;
		relayRetryAt = at + relayRetryMs;
		relayRetryMs = Math.min(relayRetryMs * 2, RELAY_RETRY_MAX_MS);
		const transports = libp2p.components?.transportManager;
		if (!transports?.listen) return;
		const { multiaddr } = await import('@multiformats/multiaddr');
		await transports
			.listen(relays.map((relay) => multiaddr(`${relay}/p2p-circuit`)))
			.catch(() => {});
	}

	async function round() {
		if (stopped) return;
		await writeSelf();
		await refreshKnown();
		await keepRelayPlace().catch(() => {});
		await Promise.all([...known].map(dial));
		report();
	}

	// A device connected over a connection OrbitDB may use: run every
	// database's heads exchange once more, now that it can go through (see
	// above). A relay's limited circuit is not one – libp2p 3 marks it with
	// `limits` (`limited` is gone) –, so the exchange waits for the connection
	// that follows it, instead of being spent on the circuit a second after it
	// opened.
	libp2p.addEventListener('connection:open', (/** @type {any} */ e) => {
		const peerId = e.detail.remotePeer.toString();
		report();
		if (!known.has(peerId) || isBridge(peerId) || e.detail.limits != null || resynced.has(peerId))
			return;
		resynced.add(peerId);
		resyncSoon(peerId);
	});
	libp2p.addEventListener('connection:close', (/** @type {any} */ e) => {
		const peerId = e.detail.remotePeer.toString();
		if (!connected(peerId)) resynced.delete(peerId);
		// Gone altogether: its silence is over. Back later, it gets the time
		// any new connection gets before it counts as mute.
		if (!open(peerId)) muteSince.delete(peerId);
		report();
		// The connection gossipsub's streams were on may be the one that went
		// (#393): looked at once its close has settled.
		if (!stopped && known.has(peerId) && !isBridge(peerId) && !regossiping.has(peerId)) {
			regossiping.set(
				peerId,
				setTimeout(() => putGossipBack(peerId), REGOSSIP_SETTLE_MS)
			);
		}
		// A relay's connection takes this node's place there with it, a moment
		// after the close: told again, so the relay light does not stay green.
		setTimeout(() => {
			if (!stopped) report();
		}, 500);
	});
	libp2p.addEventListener('self:peer:update', report);
	const unproved = gate.onProved?.(report) ?? (() => {});

	const unsubscribe = store.settings.onChange(() => {
		round().catch(() => {});
	});
	const timer = setInterval(() => round().catch(() => {}), REDIAL_MS);
	async function stopAll() {
		stopped = true;
		clearInterval(timer);
		clearTimeout(resyncTimer);
		clearTimeout(pulseReport);
		for (const pending of regossiping.values()) clearTimeout(pending);
		regossiping.clear();
		unsubscribe();
		unproved();
	}
	await round();

	return {
		self,
		/**
		 * "Gerät hinzufügen": the other device's id, as it shows it; dialled at once.
		 *
		 * @param {string} peerId
		 * @param {string} [otherLabel]
		 * @param {{ bridge?: boolean, addrs?: string[], hosted?: { host: string } | null, bridgeScopes?: string[] | null }} [how] the bridge's node, where it listens besides the relays, and the VM it runs in; what the person ticked for it at the bridge (#579)
		 */
		async addDevice(
			peerId,
			otherLabel = '',
			{ bridge = false, addrs = [], hosted = null, bridgeScopes = null } = {}
		) {
			if (!isPeerId(peerId) || peerId === self) throw new Error(t('messages.sync.notDeviceId'));
			await writeDevice(peerId, otherLabel, { bridge, addrs, hosted, bridgeScopes });
			expected.delete(peerId);
			blocked.delete(peerId);
			known.add(peerId);
			knownPeers.add(peerId);
			// Known as the bridge before the books' record comes back: the dial below uses its addresses.
			if (bridge) {
				records.set(peerId, {
					...(records.get(peerId) ?? deviceOf(peerId, otherLabel)),
					bridge: true,
					addrs,
					hosted
				});
			}
			await dial(peerId);
			report();
		},
		/**
		 * A removed device is about to be added again and has to be dialled for
		 * it (the bridge's node, paired anew): let it through until `addDevice`
		 * writes its record – or, with `false`, shut it out again when that failed.
		 *
		 * @param {string} peerId
		 * @param {boolean} [coming]
		 */
		expectDevice(peerId, coming = true) {
			if (!isPeerId(peerId) || peerId === self) return;
			if (coming) {
				expected.add(peerId);
				blocked.delete(peerId);
			} else if (expected.delete(peerId) && records.get(peerId)?.removed) {
				blocked.add(peerId);
			}
		},
		/**
		 * Where the bridge's node listens on this machine now. It takes a free
		 * port at every start, so the address the books keep from its pairing is
		 * good only until the bridge is started again; the bridge's status
		 * (`/health`, `node.addrs`) names the one in use. Kept in the books when
		 * it changed, and dialled.
		 *
		 * @param {string} peerId the bridge's node, a device of the books
		 * @param {string} addr `/ip4/127.0.0.1/tcp/<port>/ws`, with or without the peer id
		 * @returns {Promise<boolean>} whether the address was new
		 */
		async bridgeListensAt(peerId, addr) {
			const before = records.get(peerId);
			if (!before?.bridge || !known.has(peerId) || !LOOPBACK_WS.test(addr)) return false;
			const here = addr.replace(/\/p2p\/[^/]+$/, '');
			const full = `${here}/p2p/${peerId}`;
			const kept = (before.addrs ?? []).filter((a) => !LOOPBACK_WS.test(a));
			const changed = !(before.addrs ?? []).some((a) => a === full || a === here);
			if (changed) {
				const addrs = [full, ...kept].slice(0, 8);
				const key = `${DEVICE_PREFIX}${peerId}`;
				const latest = (await all())
					.filter((r) => r.key === key && !r.deleted)
					.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
				if (latest) {
					await store.settings.put({
						id: latest.id,
						key,
						value: { ...latest.value, addrs },
						deleted: false
					});
				}
				records.set(peerId, { ...before, addrs });
			}
			// Dialled either way: the bridge may have come up since the last round.
			if (!open(peerId)) await dial(peerId);
			report();
			return changed;
		},
		/**
		 * "Entfernen": every record of the device deleted; the deletion
		 * replicates, and every device lets go of it.
		 *
		 * @param {string} peerId
		 */
		async removeDevice(peerId) {
			if (peerId === self) throw new Error(t('messages.sync.removeFromOther'));
			const key = `${DEVICE_PREFIX}${peerId}`;
			for (const r of await store.settings.list({ where: (x) => x.key === key }))
				await store.settings.softDelete(r.id);
			known.delete(peerId);
			knownPeers.delete(peerId);
			blocked.add(peerId);
			gate.forget(peerId);
			await hangUp(peerId);
			report();
		},
		refresh: report,
		stop: stopAll
	};
}

/**
 * @typedef {{ self: string, reachable: boolean, hangUps?: number, addrs?: string[], asking?: string[], devices: { peerId: string, label: string, connected: boolean, direct: boolean, gossiping?: boolean, bridge?: boolean, hosted?: { host: string } | null, links?: { addr: string, direct: boolean, rtt: number | null }[] }[] }} SyncState
 *   a device's `bridge`: the bridge's own node (#573), reached for the bridge's functions, replicating nothing;
 *   `addrs`: this node's own addresses (a `/p2p-circuit` one is its place at a relay);
 *   a device's `links`: each connection to it, by remote address, direct or relayed, with the last round trip in ms
 *   `gossiping`: a `/meshsub/` stream is open to it each way, so replication can actually move (#393);
 *   `hangUps`: how often a device was hung up for staying mute while connected
 */

/**
 * @typedef {{ peerId: string, rtt: number, addr: string, at: number }} SyncPulse
 *   an own device answered the connection monitor's ping, over `addr`, after `rtt` ms
 */

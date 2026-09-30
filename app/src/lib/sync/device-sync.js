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

import { FaultTolerance } from '@libp2p/interface';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { NODE_INFO, gatedIdentify } from './quiet-identify.js';
import { gossipsub } from '@libp2p/gossipsub';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { isLocal } from '../ucep/net.js';
import { qrTransport } from './qr-link.js';
import { t } from '../i18n/index.js';

export const SYNC_FLAG_KEY = 'belege.device-sync';
export const DEVICE_SALT_KEY = 'belege.device-salt';
/** How often a known device that is not connected is dialled again. */
export const REDIAL_MS = 30_000;
/** A settings record per device: one record each, so two devices never overwrite each other. */
export const DEVICE_PREFIX = 'device:';

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

const QR_PREFIX = 'belege-device:';

/** What a device shows as its QR code. @param {string} peerId */
export const deviceCode = (peerId) => `${QR_PREFIX}${peerId}`;

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
			// which libp2p refuses to dial by default.
			...(lan || both || relays.some(isLocal) ? { denyDialMultiaddr: () => gateClosed } : {}),
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
 * @typedef {{ peerId: string, label: string, addedAt: string, removed: boolean, changedAt: string }} Device
 */

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
			changedAt: String(r.updatedAt ?? '')
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
	 */
	async function writeDevice(peerId, name) {
		const key = `${DEVICE_PREFIX}${peerId}`;
		const latest = (await all())
			.filter((r) => r.key === key)
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
		if (latest && !latest.deleted) return;
		await store.settings.put({
			...(latest ? { id: latest.id } : {}),
			key,
			value: { label: name || latest?.value?.label || '', addedAt: now() },
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
			refresh() {},
			async stop() {}
		};
	}
	if (!mine || mine.removed) await writeDevice(self, label);

	const open = (/** @type {string} */ peerId) =>
		libp2p.getConnections().some((/** @type {any} */ c) => c.remotePeer.toString() === peerId);
	const connected = (/** @type {string} */ peerId) => open(peerId) && gate.isProved(peerId);
	const direct = (/** @type {string} */ peerId) =>
		libp2p
			.getConnections()
			.some((/** @type {any} */ c) => c.remotePeer.toString() === peerId && !c.limited);

	async function refreshKnown() {
		records = new Map(deviceRecords(await all()).map((d) => [d.peerId, d]));
		if (removedHere(records.get(self))) {
			await leave();
			return;
		}
		known.clear();
		knownPeers.clear();
		for (const d of records.values()) {
			if (d.peerId === self) continue;
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
			}
		}
	}

	/** @param {string} peerId */
	async function hangUp(peerId) {
		for (const c of libp2p.getConnections())
			if (c.remotePeer.toString() === peerId) await c.close().catch(() => {});
	}

	/** Another device removed this one: stop and hang up. */
	async function leave() {
		if (stopped) return;
		await stopAll();
		for (const peerId of known) await hangUp(peerId);
		known.clear();
		onRemoved();
	}

	function report() {
		onState({
			self,
			reachable: libp2p
				.getMultiaddrs()
				.some((/** @type {any} */ a) => a.toString().includes('/p2p-circuit')),
			devices: [...known].map((peerId) => ({
				peerId,
				label: records.get(peerId)?.label ?? '',
				connected: connected(peerId),
				direct: direct(peerId)
			}))
		});
	}

	/** @param {string} peerId */
	async function dial(peerId) {
		if (stopped) return;
		// Connected, but not proved yet (the first exchange failed): again.
		if (open(peerId)) return void (await gate.proveTo?.(peerId));
		const { multiaddr } = await import('@multiformats/multiaddr');
		for (const relay of relays) {
			try {
				await libp2p.dial(multiaddr(`${relay}/p2p-circuit/p2p/${peerId}`), {
					signal: AbortSignal.timeout(15_000)
				});
				return;
			} catch {
				// Not there, or not yet: tried again on the next round.
			}
		}
	}

	async function round() {
		if (stopped) return;
		await refreshKnown();
		await Promise.all([...known].map(dial));
		report();
	}

	// A device connected directly: run every database's heads exchange once
	// more, now that it goes over a connection OrbitDB may use (see above).
	libp2p.addEventListener('connection:open', (/** @type {any} */ e) => {
		const peerId = e.detail.remotePeer.toString();
		report();
		if (!known.has(peerId) || e.detail.limited || resynced.has(peerId)) return;
		resynced.add(peerId);
		clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			if (!stopped) store.resync().catch(() => {});
		}, 1000);
	});
	libp2p.addEventListener('connection:close', (/** @type {any} */ e) => {
		const peerId = e.detail.remotePeer.toString();
		if (!connected(peerId)) resynced.delete(peerId);
		report();
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
		 */
		async addDevice(peerId, otherLabel = '') {
			if (!isPeerId(peerId) || peerId === self) throw new Error(t('messages.sync.notDeviceId'));
			await writeDevice(peerId, otherLabel);
			blocked.delete(peerId);
			known.add(peerId);
			knownPeers.add(peerId);
			await dial(peerId);
			report();
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
 * @typedef {{ self: string, reachable: boolean, devices: { peerId: string, label: string, connected: boolean, direct: boolean }[] }} SyncState
 */

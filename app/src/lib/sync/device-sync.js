// Syncing the books between a person's own devices (issue #123), stage 1.
//
// Off unless the person switched it on for this device (consent screen,
// "Eigene Geräte synchronisieren"; a flag in this browser). Then the node
// under Helia and OrbitDB goes online the way the UCEP node does
// (ucep/net.js): a WebSocket to the relay, a reservation there, WebRTC for the
// direct connection the relay helps to set up. Every device of the same
// passkey opens the same databases (their names come from the PRF answer),
// and OrbitDB replicates them over gossipsub; everything is sealed before it
// is written, so the relay and the network see ciphertext only.
//
// Devices find each other by peer id: each device writes itself into the
// sealed settings (`device:<peer id>`), the settings replicate, and every
// device dials the ones it knows through the relay – now, and again while
// they are not connected. The first time, one device's id is typed or
// scanned on the other (Integrationen → Eigene Geräte).
//
// OrbitDB 4.0.0 exchanges heads once per peer, when gossipsub says it
// subscribed, and never again; over a relayed (limited) connection that dial
// is refused and swallowed. So once a device is connected directly, every
// database's sync is restarted once (bounded, debounced) – the exchange then
// runs over the direct connection.

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { isLocal } from '../ucep/net.js';

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

/** Whether this device syncs (the consent screen's switch). */
export function deviceSyncOn() {
	try {
		return storage()?.getItem(SYNC_FLAG_KEY) === 'on';
	} catch {
		return false;
	}
}

/** @param {boolean} on */
export function setDeviceSync(on) {
	try {
		if (on) storage()?.setItem(SYNC_FLAG_KEY, 'on');
		else storage()?.removeItem(SYNC_FLAG_KEY);
	} catch {
		// Blocked: stays off.
	}
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
 * The online node's config: the UCEP transports plus gossipsub for OrbitDB.
 *
 * @param {{ privateKey: any, relays: string[] }} params
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function syncLibp2pConfig({ privateKey, relays }) {
	return {
		privateKey,
		addresses: { listen: [...relays.map((relay) => `${relay}/p2p-circuit`), '/webrtc'] },
		transports: [webSockets(), webRTC(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionManager: { inboundConnectionThreshold: 100 },
		...(relays.some(isLocal) ? { connectionGater: { denyDialMultiaddr: () => false } } : {}),
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
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
 * @typedef {{ peerId: string, label: string, addedAt: string }} Device
 */

/**
 * The devices the books know, from the settings records.
 *
 * @param {Record<string, any>[]} settingsRecords
 * @returns {Device[]}
 */
export function knownDevices(settingsRecords) {
	return settingsRecords
		.filter((r) => !r.deleted && String(r.key ?? '').startsWith(DEVICE_PREFIX))
		.map((r) => ({
			peerId: String(r.key).slice(DEVICE_PREFIX.length),
			label: String(r.value?.label ?? ''),
			addedAt: String(r.value?.addedAt ?? '')
		}))
		.filter((d) => isPeerId(d.peerId));
}

/**
 * Keep the devices connected and the books in step, on an online node.
 *
 * @param {object} p
 * @param {any} p.libp2p the node under Helia and OrbitDB
 * @param {{ settings: import('../store/repository.js').Collection, resync: () => Promise<void> }} p.store
 * @param {string[]} p.relays
 * @param {string} p.label this device, as the person may call it
 * @param {(state: SyncState) => void} [p.onState]
 * @param {() => string} [p.now]
 */
export async function startDeviceSync({
	libp2p,
	store,
	relays,
	label,
	onState = () => {},
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

	// This device, in the books (once; the record replicates to the others).
	const own = await store.settings.list({ where: (r) => r.key === `${DEVICE_PREFIX}${self}` });
	if (!own.length) {
		await store.settings.put({ key: `${DEVICE_PREFIX}${self}`, value: { label, addedAt: now() } });
	}

	const connected = (/** @type {string} */ peerId) =>
		libp2p.getConnections().some((/** @type {any} */ c) => c.remotePeer.toString() === peerId);
	const direct = (/** @type {string} */ peerId) =>
		libp2p
			.getConnections()
			.some((/** @type {any} */ c) => c.remotePeer.toString() === peerId && !c.limited);

	async function refreshKnown() {
		for (const d of knownDevices(await store.settings.list()))
			if (d.peerId !== self) known.add(d.peerId);
	}

	function report() {
		onState({
			self,
			reachable: libp2p
				.getMultiaddrs()
				.some((/** @type {any} */ a) => a.toString().includes('/p2p-circuit')),
			devices: [...known].map((peerId) => ({
				peerId,
				connected: connected(peerId),
				direct: direct(peerId)
			}))
		});
	}

	/** @param {string} peerId */
	async function dial(peerId) {
		if (stopped || connected(peerId)) return;
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

	const unsubscribe = store.settings.onChange(() => {
		round().catch(() => {});
	});
	const timer = setInterval(() => round().catch(() => {}), REDIAL_MS);
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
			if (!isPeerId(peerId) || peerId === self) throw new Error('Das ist keine Gerätekennung.');
			const key = `${DEVICE_PREFIX}${peerId}`;
			const kept = await store.settings.list({ where: (r) => r.key === key });
			if (!kept.length)
				await store.settings.put({ key, value: { label: otherLabel, addedAt: now() } });
			known.add(peerId);
			await dial(peerId);
			report();
		},
		refresh: report,
		async stop() {
			stopped = true;
			clearInterval(timer);
			clearTimeout(resyncTimer);
			unsubscribe();
		}
	};
}

/**
 * @typedef {{ self: string, reachable: boolean, devices: { peerId: string, connected: boolean, direct: boolean }[] }} SyncState
 */

// The light next to "Wo sich Geräte treffen": whether this device is
// reachable at a relay of the chosen kind right now – green when it holds a
// reservation there (an own `/p2p-circuit` address, which libp2p drops as soon
// as the relay connection goes), red when not. Pure: it reads the addresses
// device sync reports (device-sync.js `SyncState.addrs`).

import { relayPeerOf } from './first-contact.js';

/** @typedef {'up' | 'down'} Light */

/**
 * The relay a circuit address of this node goes through: the peer id before
 * `/p2p-circuit`.
 *
 * @param {string} addr
 */
export function circuitRelayOf(addr) {
	const at = addr.indexOf('/p2p-circuit');
	return at < 0 ? null : relayPeerOf(addr.slice(0, at));
}

/**
 * The lights for the modes that meet at a relay, as this session's node runs.
 * No light without device sync online, nor for a mode this node does not use.
 *
 * @param {object} p
 * @param {import('./network-mode.js').NetworkMode} p.mode as the node was built
 * @param {boolean} p.online device sync is on and the network not paused
 * @param {string[]} p.addrs this node's own addresses
 * @param {string | null} p.lanRelay the bridge's relay, as the books know it
 * @returns {{ public: Light | null, lan: Light | null, relays: { public: string[], lan: string[] } }}
 *   `relays`: the relay peers it is reachable at, for the tooltip
 */
export function relayLights({ mode, online, addrs, lanRelay }) {
	const lanPeer = relayPeerOf(lanRelay);
	const at = [...new Set(addrs.map(circuitRelayOf).filter((p) => p !== null))];
	const relays = {
		public: at.filter((p) => p !== lanPeer),
		lan: at.filter((p) => p === lanPeer)
	};
	if (!online) return { public: null, lan: null, relays };
	const usesPublic = mode === 'public' || mode === 'both';
	const usesLan = mode === 'lan' || (mode === 'both' && lanPeer !== null);
	return {
		public: usesPublic ? (relays.public.length ? 'up' : 'down') : null,
		lan: usesLan ? (relays.lan.length ? 'up' : 'down') : null,
		relays
	};
}

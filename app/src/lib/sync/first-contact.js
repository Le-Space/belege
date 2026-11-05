// "Beides" (issue #148, step 2d): own devices meet at the public relays, at
// the relay in the own bridge and by QR – but a device the books do not know
// yet is let in only over the own network: a connection built by two scanned
// codes, or one through the bridge's relay. Once its record is in the books
// (it replicates), it may come over the public relays too. A device someone
// adds from far away, with a passkey that leaked, gets nothing.
//
// Pure: the device gate (device-gate.js) asks `admit` for every proof it
// checks, on both sides of the connection.

/**
 * The peer id at the end of a relay's address, or null.
 *
 * @param {string | null} addr
 */
export function relayPeerOf(addr) {
	return /\/p2p\/(12D3KooW[1-9A-HJ-NP-Za-km-z]{44})$/.exec(String(addr ?? ''))?.[1] ?? null;
}

/**
 * Whether a connection runs over the own network: built by a code exchange
 * with that peer, or relayed by the bridge's relay.
 *
 * @param {any} connection
 * @param {{ lanRelayPeer: string | null, qrPeers: Set<string> }} local
 */
export function isLocalPath(connection, { lanRelayPeer, qrPeers }) {
	const peer = String(connection?.remotePeer ?? '');
	if (qrPeers.has(peer)) return true;
	const addr = String(connection?.remoteAddr ?? '');
	return Boolean(lanRelayPeer) && addr.includes(`/p2p/${lanRelayPeer}/p2p-circuit`);
}

/**
 * The gate's `admit`, in every mode: a device the books know over any path.
 * An unknown one only over the own network – two scanned codes, or the
 * bridge's relay, so someone is there with both devices –, or when these books
 * never knew another device (`state.ever`, removed ones count): a new own
 * device or a member who just joined meets its first device that way. Any
 * other unknown device that proved the key is named in `onUnknown`, for the
 * person to let in – never let in by itself: a member taken out still holds
 * the key.
 *
 * @param {object} p
 * @param {import('./network-mode.js').NetworkMode} [p.mode] how devices meet: the rule is the same in every one
 * @param {Set<string>} p.knownPeers the devices the books know (device-sync.js)
 * @param {{ loaded: boolean, ever: boolean }} p.state whether the list is read, and ever named another device
 * @param {string | null} p.lanRelayPeer
 * @param {Set<string>} p.qrPeers
 * @param {(peer: string) => void} [p.onUnknown]
 * @returns {(peer: string, connection: any) => boolean}
 */
export function firstContactPolicy({ knownPeers, state, lanRelayPeer, qrPeers, onUnknown }) {
	return (peer, connection) => {
		if (knownPeers.has(peer)) return true;
		if (isLocalPath(connection, { lanRelayPeer, qrPeers })) return true;
		if (state.loaded && !state.ever) return true;
		onUnknown?.(peer);
		return false;
	};
}

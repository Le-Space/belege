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
 * The gate's `admit` for a mode: in "Beides" a known device over any path,
 * an unknown one over the own network only; in every other mode anyone who
 * proves the passkey.
 *
 * @param {object} p
 * @param {import('./network-mode.js').NetworkMode} p.mode
 * @param {Set<string>} p.knownPeers the devices the books know (device-sync.js)
 * @param {string | null} p.lanRelayPeer
 * @param {Set<string>} p.qrPeers
 * @returns {(peer: string, connection: any) => boolean}
 */
export function firstContactPolicy({ mode, knownPeers, lanRelayPeer, qrPeers }) {
	if (mode !== 'both') return () => true;
	return (peer, connection) =>
		knownPeers.has(peer) || isLocalPath(connection, { lanRelayPeer, qrPeers });
}

// Putting gossipsub back on a connection that is still there (#393).
//
// gossipsub 16 opens its outbound stream to a peer on the first connection it
// is told about and keeps it there: a later connection to the same peer gets
// none. Two devices that met through a relay therefore gossip over the relay's
// circuit, also once WebRTC connects them directly. When the relay closes the
// circuit – its duration, its data cap, a lost relay connection – both
// streams go with it. gossipsub keeps the peer, since libp2p reports a
// disconnect only when the last connection went, and opens a new stream only
// when it is told of a *new* connection. None comes: the devices look
// connected, and nothing replicates.
//
// What a new connection would do is done here for the one that is left: the
// topology gossipsub registered with libp2p is told of it once more. That
// opens the outbound stream on it and sends this node's subscriptions; the
// other device does the same for its side. No connection is closed and
// nothing is dialled, so the pause and the network mode have nothing to
// refuse.

/** What OrbitDB's heads and updates ride on. */
export const MESHSUB = '/meshsub/';

/** @param {any} stream @param {'inbound' | 'outbound'} direction */
const gossipStream = (stream, direction) =>
	String(stream?.protocol ?? '').startsWith(MESHSUB) &&
	// A stream that does not say which way it runs counts for both.
	(stream.direction === undefined || stream.direction === direction);

/** @param {any} connection */
const isOpen = (connection) => (connection?.status ?? 'open') === 'open';

/**
 * Does one of these connections carry a gossipsub stream in this direction?
 * Outbound is what this node says, inbound what it hears: replication needs
 * both, and each device opens only its own outbound one.
 *
 * @param {any[]} connections the connections to one device
 * @param {'inbound' | 'outbound'} direction
 */
export const gossips = (connections, direction) =>
	connections.some(
		(c) => isOpen(c) && (c.streams ?? []).some((/** @type {any} */ s) => gossipStream(s, direction))
	);

/**
 * The decision: after something changed about the connections to a device,
 * which of them should gossipsub be put on – or none (null).
 *
 * - No open connection left: nothing to do here. libp2p reports the
 *   disconnect, gossipsub and OrbitDB forget the peer, the next dial starts
 *   over.
 * - An outbound gossipsub stream is open: this node still talks.
 * - Otherwise the best of what is left: a connection without a relay's limits
 *   before a limited one (a limited one is the next to be closed), and among
 *   those a direct one before a relayed one.
 *
 * @param {any[]} connections the connections to one device, as libp2p lists them now
 * @param {(addr: string) => boolean} isDirect whether a remote address reaches the device itself
 * @returns {any | null} the connection to tell gossipsub of
 */
export function connectionToRegossip(connections, isDirect) {
	const open = connections.filter(isOpen);
	if (!open.length || gossips(open, 'outbound')) return null;
	const rank = (/** @type {any} */ c) =>
		(c.limits == null ? 0 : 2) + (isDirect(String(c.remoteAddr)) ? 0 : 1);
	return open.reduce((best, c) => (rank(c) < rank(best) ? c : best));
}

/**
 * Tell gossipsub of a connection as libp2p's registrar does for a new one.
 *
 * @param {any} libp2p
 * @param {any} connection an open connection to a peer gossipsub has no outbound stream to
 * @returns {boolean} whether gossipsub was told (false: no gossipsub, or a libp2p that keeps its topologies elsewhere)
 */
export function regossip(libp2p, connection) {
	const protocols = libp2p?.services?.pubsub?.protocols;
	const registrar = libp2p?.components?.registrar;
	if (!Array.isArray(protocols) || typeof registrar?.getTopologies !== 'function') return false;
	// gossipsub registers one topology under each of its protocols: once is enough.
	for (const protocol of protocols) {
		for (const topology of registrar.getTopologies(protocol) ?? []) {
			if (typeof topology?.onConnect !== 'function') continue;
			topology.onConnect(connection.remotePeer, connection);
			return true;
		}
	}
	return false;
}

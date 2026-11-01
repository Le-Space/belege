// What this node says about itself in identify (security audit, #209).
//
// libp2p's identify answers any peer that asks – a relay, a stranger who
// knows the peer id – with every protocol the node has a handler for, and
// identify-push sends the list again whenever it changes.
//
// 1. Names nobody is told (`isAnnounced`). OrbitDB registers one protocol per
//    database, `/orbitdb/heads/<address>`: the list named every database of
//    the books. The device proof's protocol names the app. Both are dialled
//    by who knows them; the handlers stay where they are.
//
// 2. Two lists (`gatedIdentify`), for the node that syncs the books. A peer
//    that has not proved the passkey – every relay, every stranger – is told
//    only what it needs to connect at all: identify and the circuit relay.
//    Gossipsub, Bitswap, WebRTC signalling and the extensions a desktop
//    serves its own devices are named to a device only after its proof. So a
//    relay no longer learns what kind of app is behind a peer id.
//
//    After the proof each side asks the other once more (`learn`), and only
//    then do libp2p's topologies start gossipsub and Bitswap with that peer.
//    A later change of the list is pushed to proven devices with the full
//    list and to everybody else with the public one – never the short list
//    to a device, which would make it drop the sync.
//
// How: the identify services are handed a view of libp2p's components in
// which the node's own protocol list is filtered. identify reads that list
// from the peer store when it answers; whom it answers is noted at the moment
// its handler is called, and a request whose asker is not known gets the
// public list. identify-push reads it from the registrar; there are two of
// them, each pushing to its own audience.
//
// 3. What the node calls itself (`NODE_INFO`).

import { identify, identifyPush } from '@libp2p/identify';

/**
 * What the node calls itself in identify. libp2p's default in a browser is
 * its name, its version and the browser's whole user agent string – operating
 * system and browser version, to every peer and every relay. None of their
 * business: the name alone.
 */
export const NODE_INFO = Object.freeze({ userAgent: 'js-libp2p' });

/**
 * Protocol names that are never announced: OrbitDB's carry a database's
 * address, and the device proof's names the app. Both are dialled by who
 * knows them; nobody needs to be told.
 */
const PRIVATE = ['/orbitdb/heads/', '/belege/'];

/** Whether a protocol may be named in identify at all. @param {string} protocol */
export const isAnnounced = (protocol) => !PRIVATE.some((p) => String(protocol).startsWith(p));

/** What a peer that has not proved the passkey is told: enough to connect, and no more. */
const PUBLIC = ['/ipfs/id/', '/libp2p/circuit/relay/'];

/** Whether a protocol is named to everybody. @param {string} protocol */
export const isPublic = (protocol) => PUBLIC.some((p) => String(protocol).startsWith(p));

const IDENTIFY = '/ipfs/id/1.0.0';
const PUSH = '/ipfs/id/push/1.0.0';

/** @param {any} target @param {Record<string, any>} over */
const view = (target, over) =>
	new Proxy(target, {
		get(t, prop) {
			if (typeof prop === 'string' && Object.hasOwn(over, prop)) return over[prop];
			const value = Reflect.get(t, prop, t);
			return typeof value === 'function' ? value.bind(t) : value;
		}
	});

/**
 * libp2p's components as an identify service sees them: the same, except
 * that this node's own protocols come filtered, and – where given – only
 * some connections exist and the registrar is wrapped.
 *
 * @param {any} components
 * @param {object} [o]
 * @param {() => (protocol: string) => boolean} [o.filter] the filter for the request being answered now
 * @param {(connection: any) => boolean} [o.connections] which connections a push goes to
 * @param {Record<string, any>} [o.registrar] what the registrar does differently
 */
export function quietComponents(
	components,
	{ filter = () => isAnnounced, connections, registrar } = {}
) {
	const peerStore = view(components.peerStore, {
		get(/** @type {any} */ peerId, /** @type {any} */ options) {
			// Read now, not after the await: the asker is known only while the handler is entered.
			const announced = filter();
			return components.peerStore
				.get(peerId, options)
				.then((/** @type {any} */ peer) =>
					components.peerId.equals(peerId)
						? { ...peer, protocols: peer.protocols.filter(announced) }
						: peer
				);
		}
	});
	const quietRegistrar = view(components.registrar, {
		getProtocols: () => components.registrar.getProtocols().filter(filter()),
		...registrar
	});
	const connectionManager = connections
		? view(components.connectionManager, {
				getConnections: (/** @type {any} */ peerId) =>
					components.connectionManager.getConnections(peerId).filter(connections)
			})
		: components.connectionManager;
	return new Proxy(components, {
		get(t, prop) {
			if (prop === 'peerStore') return peerStore;
			if (prop === 'registrar') return quietRegistrar;
			if (prop === 'connectionManager') return connectionManager;
			return Reflect.get(t, prop, t);
		}
	});
}

/** identify, quiet about the databases. @param {Parameters<typeof identify>[0]} [init] */
export const quietIdentify = (init) => (/** @type {any} */ components) =>
	identify(init)(quietComponents(components));

/** identify-push, quiet about the databases. @param {Parameters<typeof identifyPush>[0]} [init] */
export const quietIdentifyPush = (init) => (/** @type {any} */ components) =>
	identifyPush(init)(quietComponents(components));

/**
 * The identify services of a node behind a device gate: the public list for
 * who has not proved the passkey, the full one (without the private names)
 * for who has.
 *
 * @param {{ isProved: (peerId: string) => boolean }} gate
 * @returns {{
 *   services: { identify: (c: any) => any, identifyPush: (c: any) => any, identifyPushDevices: (c: any) => any },
 *   learn: (peerId: string) => Promise<void>
 * }} `learn`: ask a device that just proved the passkey again, for its full list
 */
export function gatedIdentify(gate) {
	const forDevices = isAnnounced;
	const forAll = (/** @type {string} */ protocol) => isAnnounced(protocol) && isPublic(protocol);
	const proved = (/** @type {any} */ connection) => gate.isProved(String(connection.remotePeer));

	/** Who is asking right now: set while identify's handler is entered, else null. */
	/** @type {any} */
	let asking = null;
	/** @type {any} */
	let service = null;
	/** @type {any} */
	let components = null;

	return {
		services: {
			identify: (/** @type {any} */ c) => {
				components = c;
				service = identify()(
					quietComponents(c, {
						// Not known who asks: the public list.
						filter: () => (asking && proved(asking) ? forDevices : forAll),
						registrar: {
							handle: (
								/** @type {string} */ protocol,
								/** @type {any} */ handler,
								/** @type {any} */ options
							) =>
								c.registrar.handle(
									protocol,
									protocol === IDENTIFY
										? (/** @type {any} */ stream, /** @type {any} */ connection) => {
												asking = connection;
												try {
													return handler(stream, connection);
												} finally {
													asking = null;
												}
											}
										: handler,
									options
								)
						}
					})
				);
				return service;
			},
			// To everybody who has not proved the passkey: the public list.
			identifyPush: (/** @type {any} */ c) =>
				identifyPush()(
					quietComponents(c, {
						filter: () => forAll,
						connections: (connection) => !proved(connection)
					})
				),
			// To proven devices: the full list. It shares the push protocol with the
			// one above, which has registered the handler for incoming pushes.
			identifyPushDevices: (/** @type {any} */ c) =>
				identifyPush()(
					quietComponents(c, {
						filter: () => forDevices,
						connections: proved,
						registrar: {
							handle: (
								/** @type {string} */ protocol,
								/** @type {any} */ handler,
								/** @type {any} */ options
							) =>
								protocol === PUSH
									? Promise.resolve()
									: c.registrar.handle(protocol, handler, options),
							unhandle: (/** @type {string} */ protocol) =>
								protocol === PUSH ? Promise.resolve() : c.registrar.unhandle(protocol)
						}
					})
				)
		},

		async learn(peerId) {
			if (!service || !components) return;
			// The other side marks this node as proved a moment after this node marked
			// it: ask until it names more than the public list, a few times.
			for (let attempt = 0; attempt < 8; attempt++) {
				const connection = components.connectionManager
					.getConnections()
					.find((/** @type {any} */ c) => String(c.remotePeer) === peerId && c.status === 'open');
				if (!connection) return;
				try {
					const told = await service.identify(connection, { signal: AbortSignal.timeout(5000) });
					if (told.protocols.some((/** @type {string} */ p) => !isPublic(p))) return;
				} catch {
					// Closed meanwhile, or busy: once more.
				}
				await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
			}
		}
	};
}

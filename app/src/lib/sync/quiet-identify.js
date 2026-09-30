// What this node says about itself in identify (security audit, #209).
//
// libp2p's identify answers any peer that asks – a relay, a stranger who
// knows the peer id – with every protocol the node has a handler for, and
// identify-push sends the list again whenever it changes. OrbitDB registers
// one protocol per database, `/orbitdb/heads/<address>`: the list therefore
// named every database of the books, to everybody, before any device proof.
//
// Nobody needs those names from identify: OrbitDB dials the protocol of a
// database it already has the address of. So they are left out of what
// identify and identify-push say, for every peer. The handlers stay where they
// are (behind the device gate); only the announcement is quiet.
//
// Done by handing the two identify services a view of libp2p's components in
// which the node's own protocol list is filtered: identify reads it from the
// peer store (the node's own record), identify-push from the registrar.

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

/** Whether a protocol may be named in identify. @param {string} protocol */
export const isAnnounced = (protocol) => !PRIVATE.some((p) => String(protocol).startsWith(p));

/**
 * libp2p's components as the identify services see them: the same, except
 * that this node's own protocols come filtered.
 *
 * @param {any} components
 * @param {(protocol: string) => boolean} [announced]
 */
export function quietComponents(components, announced = isAnnounced) {
	/** @param {any} target @param {Record<string, (...args: any[]) => any>} over */
	const view = (target, over) =>
		new Proxy(target, {
			get(t, prop) {
				if (typeof prop === 'string' && Object.hasOwn(over, prop)) return over[prop];
				const value = Reflect.get(t, prop, t);
				return typeof value === 'function' ? value.bind(t) : value;
			}
		});
	const peerStore = view(components.peerStore, {
		async get(/** @type {any} */ peerId, /** @type {any} */ options) {
			const peer = await components.peerStore.get(peerId, options);
			if (!components.peerId.equals(peerId)) return peer;
			return { ...peer, protocols: peer.protocols.filter(announced) };
		}
	});
	const registrar = view(components.registrar, {
		getProtocols: () => components.registrar.getProtocols().filter(announced)
	});
	return new Proxy(components, {
		get(t, prop) {
			if (prop === 'peerStore') return peerStore;
			if (prop === 'registrar') return registrar;
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

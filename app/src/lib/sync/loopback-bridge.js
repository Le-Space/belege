// The bridge on this machine over a stream, with device sync off (#580).
//
// With "Eigene Geräte synchronisieren" off, the books' node has no transports
// (network.js) and the app reached the bridge over HTTP on 127.0.0.1 only.
// The bridge's HTTP routes for its functions go (M3.1 of #567): what they did
// runs over the bridge's own node, by name (@le-space/bridge-protocol). So
// this device gets a second, small libp2p node for that one peer:
//
// - it dials 127.0.0.1 or ::1 and nothing else (the connection gater), over
//   the WebSocket the bridge's node listens on there – the same machine the
//   HTTP calls went to, no relay, no network beyond it;
// - it listens nowhere, has no pubsub, no discovery and holds no books;
// - its device gate offers the proof to, and admits, the books' bridge only,
//   with the bridge's own key; the bridge stays "limited" and reaches only
//   the Bitswap of its block answers (#578);
// - its peer key is this device's own (database-keys.js
//   deriveDevicePeerSeed), so the bridge knows it as the device the books
//   listed at its pairing. It is never written anywhere.

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { isLoopback } from '@libp2p/utils';
import { BLOCKS_PROTOCOL } from '@le-space/bridge-protocol/exchange';

import { createDeviceGate } from './device-gate.js';
import { NODE_INFO, gatedIdentify } from './quiet-identify.js';

/** A multiaddr on this machine: 127.0.0.0/8 or ::1. @param {any} addr */
export function onThisMachine(addr) {
	try {
		return isLoopback(addr);
	} catch {
		return false;
	}
}

/**
 * The bridge node's WebSocket on this machine, from what `/health` tells
 * (`node.addrs`): a `/ip4/127.0.0.1/tcp/<port>/ws` address, or null.
 *
 * @param {unknown} addrs
 * @returns {string | null}
 */
export function loopbackAddr(addrs) {
	if (!Array.isArray(addrs)) return null;
	const found = addrs.find(
		(a) =>
			typeof a === 'string' && /^\/(ip4\/127\.\d+\.\d+\.\d+|ip6\/::1)\/tcp\/\d+\/ws(\/|$)/.test(a)
	);
	return found ? found.replace(/\/p2p\/[^/]+$/, '') : null;
}

/**
 * The libp2p options of the node: exported so a test can read what it dials.
 *
 * @param {{ privateKey: any, gate: ReturnType<typeof createDeviceGate> }} p
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function loopbackConfig({ privateKey, gate }) {
	const whoAmI = gatedIdentify(gate);
	gate.onProved((peer) => {
		whoAmI.learn(peer).catch(() => {});
	});
	return {
		privateKey,
		nodeInfo: NODE_INFO,
		addresses: { listen: [] },
		transports: [webSockets()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [],
		connectionGater: {
			// This machine only; libp2p would refuse a private address and an
			// insecure WebSocket by default, which this one is.
			denyDialMultiaddr: (/** @type {any} */ addr) => !onThisMachine(addr),
			denyInboundConnection: () => true
		},
		services: {
			// First: it wraps the registrar before anything registers there.
			deviceGate: gate.service,
			...whoAmI.services
		}
	};
}

/**
 * Start the node. `bridge` is read on every proof: the peer the books name
 * as their bridge and its key of this generation (session.svelte.js), the
 * same object the session updates when the bridge is paired.
 *
 * @param {{ privateKey: any, bridge: { peerId: string | null, key: Uint8Array | null } }} p
 */
export async function startLoopbackNode({ privateKey, bridge }) {
	const isBridge = (/** @type {string} */ peer) => Boolean(bridge.peerId) && peer === bridge.peerId;
	const gate = createDeviceGate({
		// Nobody but the bridge is proved: any other peer is checked against a key nobody has.
		keyFor: (peer) =>
			isBridge(peer) && bridge.key ? bridge.key : crypto.getRandomValues(new Uint8Array(32)),
		offer: isBridge,
		admit: isBridge,
		limited: isBridge,
		reach: [BLOCKS_PROTOCOL]
	});
	const libp2p = await createLibp2p(loopbackConfig({ privateKey, gate }));
	return { libp2p, gate };
}

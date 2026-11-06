#!/usr/bin/env node
// Is the hosted bridge's node reachable over a stream (#583)? Dial each
// address given – the VM's own `/dns4/<name>/tcp/443/tls/ws/p2p/<id>` behind
// its Caddy, and a relay's `…/p2p-circuit/p2p/<id>` – as a stranger would,
// and wait for identify. A stranger is told identify and the relay protocols
// only (the device gate), which is enough to show the node answers.
//
//   node bridge/rootfs/test/dial.mjs <multiaddr> [<multiaddr> …]
//
// Prints one JSON line per address: { addr, ok, ms, protocols | error }.
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2p } from 'libp2p';

const addrs = process.argv.slice(2);
if (!addrs.length) {
	console.error('usage: dial.mjs <multiaddr> [<multiaddr> …]');
	process.exit(2);
}
let failed = 0;
for (const addr of addrs) {
	const node = await createLibp2p({
		transports: [webSockets(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: { identify: identify() }
	});
	const started = Date.now();
	try {
		const target = multiaddr(addr);
		const identified = new Promise((resolve) =>
			node.addEventListener('peer:identify', (event) => resolve(event.detail), { once: true })
		);
		const connection = await node.dial(target, { signal: AbortSignal.timeout(30_000) });
		const result = /** @type {any} */ (
			await Promise.race([identified, new Promise((r) => setTimeout(() => r(null), 15_000))])
		);
		console.log(
			JSON.stringify({
				addr,
				ok: true,
				ms: Date.now() - started,
				peer: connection.remotePeer.toString(),
				protocols: result?.protocols ?? null
			})
		);
	} catch (/** @type {any} */ error) {
		failed++;
		console.log(
			JSON.stringify({
				addr,
				ok: false,
				ms: Date.now() - started,
				error: String(error?.message ?? error)
			})
		);
	} finally {
		await node.stop();
	}
}
process.exit(failed ? 1 : 0);

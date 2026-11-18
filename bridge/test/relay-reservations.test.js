// A node that listens on two configured relays starts (#803). In
// @libp2p/circuit-relay-v2 4.2.9 the first reservation emptied the queue of
// reservations and dropped the second relay's without settling it; listening
// on that relay, and so the node's start, then waited forever. It needed the
// second relay to be connected before the first reservation was done – the
// usual case with two relays that answer. patches/ keeps configured relays in
// the queue; this test fails without the patch.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';

/** @type {import('libp2p').Libp2p[]} */
const nodes = [];
after(async () => {
	await Promise.all(nodes.map((n) => n.stop().catch(() => {})));
});

const base = () => ({
	connectionEncrypters: [noise()],
	streamMuxers: [yamux()]
});

async function relay() {
	const node = await createLibp2p({
		...base(),
		addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
		transports: [tcp()],
		services: { identify: identify(), relay: circuitRelayServer() }
	});
	nodes.push(node);
	return node.getMultiaddrs()[0].toString();
}

test('a node with two configured relays starts and holds a reservation on both', async () => {
	// The drop depended on timing: several rounds, each with relays of its own.
	for (let round = 0; round < 5; round++) {
		const relays = [await relay(), await relay()];
		const started = createLibp2p({
			...base(),
			addresses: { listen: relays.map((addr) => `${addr}/p2p-circuit`) },
			transports: [tcp(), circuitRelayTransport()],
			services: { identify: identify() }
		});
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		const node = await Promise.race([
			started,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`round ${round}: the node did not start in 20 s`)),
					20_000
				);
			})
		]).finally(() => clearTimeout(timer));
		nodes.push(node);
		const circuits = node
			.getMultiaddrs()
			.map(String)
			.filter((a) => a.includes('/p2p-circuit'));
		for (const addr of relays) {
			assert.ok(
				circuits.some((c) => c.startsWith(addr)),
				`round ${round}: no reservation on ${addr}`
			);
		}
	}
});

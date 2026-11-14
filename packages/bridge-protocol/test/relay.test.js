// SPDX-License-Identifier: AGPL-3.0-or-later
// A block answer through a relay (#578): the bridge and the device reach each
// other only through a circuit relay that grants 32 MiB, as the books' own do,
// and a 15 MB original arrives, checked. Without `notifyOnLimitedConnection`
// Bitswap would never learn of a relayed peer (exchange.js). Node only: the
// relay and TCP are Node's; the browser scenario covers the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { tcp } from '@libp2p/tcp';
import { createLibp2p } from 'libp2p';

import { createBlockExchange } from '../src/exchange.js';

test('15 MB through a relay that grants 32 MiB, on a relayed connection only', async () => {
	const relay = await createLibp2p({
		addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
		transports: [tcp()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			identify: identify(),
			relay: circuitRelayServer({
				reservations: { defaultDataLimit: BigInt(32 * 1024 * 1024), defaultDurationLimit: 600_000 }
			})
		}
	});
	// Reachable through the relay only: no address of their own.
	const peer = () =>
		createLibp2p({
			addresses: { listen: [`${relay.getMultiaddrs()[0]}/p2p-circuit`] },
			transports: [tcp(), circuitRelayTransport()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			connectionGater: { denyDialMultiaddr: () => false },
			services: { identify: identify() }
		});
	const bridge = await peer();
	const device = await peer();
	const offering = await createBlockExchange({ libp2p: bridge });
	const fetching = await createBlockExchange({ libp2p: device });
	try {
		let circuit;
		for (let i = 0; i < 100 && !circuit; i++) {
			circuit = bridge.getMultiaddrs().find((a) => a.toString().includes('/p2p-circuit'));
			if (!circuit) await new Promise((r) => setTimeout(r, 50));
		}
		assert.ok(circuit, 'the bridge has its relay reservation');
		await device.dial(circuit);
		const original = new Uint8Array(15_000_000).map((_, i) => (i * 7) & 0xff);
		const answer = await offering.offer(original);
		const got = await fetching.fetch(answer, { signal: AbortSignal.timeout(60_000) });
		assert.equal(got.length, original.length);
		assert.deepEqual(got.subarray(-1000), original.subarray(-1000));
		const connections = device.getConnections(bridge.peerId);
		assert.ok(connections.length > 0 && connections.every((c) => c.limits), 'relayed only');
		assert.equal(await offering.drop(answer.cid), true);
		assert.equal(offering.isEmpty(), true);
	} finally {
		await fetching.stop();
		await offering.stop();
		await Promise.all([device.stop(), bridge.stop(), relay.stop()]);
	}
});

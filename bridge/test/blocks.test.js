// Big answers as blocks (#578): a device that takes block answers gets a
// Paperless original as `block: { cid, size, key }`, fetches the sealed
// blocks over the bridge's own Bitswap on the proved connection, opens them,
// says `blob.done`, and the bridge holds nothing afterwards. A device that
// does not say it takes blocks gets TOO_LARGE as before, and a device that is
// not the answer's cannot drop it. Memory transport; made-up bytes only.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { memory } from '@libp2p/memory';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2p } from 'libp2p';
import { createDeviceGate, gatedIdentify } from '@belege/device-gate';
import { createConsumer } from '@le-space/ucep';
import { BLOCKS_PROTOCOL, createBlockExchange } from '@le-space/bridge-protocol/exchange';

import { startBridgeNode } from '../src/node.js';
import { emptyCommands } from './support/commands.js';

const AUTH_KEY = new Uint8Array(32).fill(7);
const ORIGINAL = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => (i * 13 + 5) & 0xff);

/** A device of the books, with the app's gate and its Bitswap for block answers. @param {string} name */
async function device(name) {
	const gate = createDeviceGate({ authKey: AUTH_KEY });
	const whoAmI = gatedIdentify(gate);
	gate.onProved((peer) => whoAmI.learn(peer).catch(() => {}));
	const libp2p = await createLibp2p({
		addresses: { listen: [`/memory/${name}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { deviceGate: gate.service, ...whoAmI.services }
	});
	const consumer = createConsumer({ libp2p, label: 'Belege, test device' });
	await consumer.start();
	const exchange = await createBlockExchange({ libp2p });
	return {
		libp2p,
		consumer,
		gate,
		exchange,
		peerId: libp2p.peerId.toString(),
		async stop() {
			await exchange.stop().catch(() => {});
			await consumer.stop().catch(() => {});
			await libp2p.stop();
		}
	};
}

/** @param {() => boolean} check */
async function waitFor(check, ms = 5000) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if (check()) return true;
		await new Promise((r) => setTimeout(r, 25));
	}
	return check();
}

/** @type {string} */ let dir;
/** @type {any} */ let node;
/** @type {any} */ let own;
/** @type {any} */ let other;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-bridge-blocks-'));
	own = await device('blocks-own');
	other = await device('blocks-other');
	const commands = emptyCommands().map((c) =>
		c.name === 'paperless.document'
			? {
					...c,
					run: async () => ({ status: 200, bytes: ORIGINAL, mime: 'application/pdf' })
				}
			: c
	);
	node = await startBridgeNode({
		dir,
		authKey: AUTH_KEY,
		relays: [],
		devices: [own.peerId, other.peerId],
		commands: /** @type {any} */ (commands),
		transports: [memory()],
		listen: ['/memory/blocks-bridge']
	});
	for (const d of [own, other]) {
		await d.libp2p.dial(multiaddr(`/memory/blocks-bridge/p2p/${node.peerId}`));
		assert.ok(await waitFor(() => d.gate.isProved(node.peerId)), 'proved');
	}
});

after(async () => {
	await own?.stop();
	await other?.stop();
	await node?.stop();
	await rm(dir, { recursive: true, force: true });
});

test('a device that takes blocks gets the original as blocks, and the bridge keeps nothing', async () => {
	const answer = await own.consumer.call(node.peerId, 'belege-bridge', 'paperless.document', {
		id: 7,
		$accept: ['blocks']
	});
	assert.equal(answer.status, 200);
	assert.equal(answer.contentType, 'application/pdf');
	assert.equal(answer.base64, undefined);
	assert.equal(answer.block.size, ORIGINAL.length);
	assert.equal(node.blocksEmpty(), false);
	// Another device of the books may not drop it.
	const notYours = await other.consumer.call(node.peerId, 'belege-bridge', 'blob.done', {
		cid: answer.block.cid
	});
	assert.equal(notYours.dropped, false);

	const bytes = await own.exchange.fetch(answer.block, { signal: AbortSignal.timeout(20_000) });
	assert.deepEqual(bytes, ORIGINAL);
	const done = await own.consumer.call(node.peerId, 'belege-bridge', 'blob.done', {
		cid: answer.block.cid
	});
	assert.equal(done.dropped, true);
	assert.equal(node.blocksEmpty(), true);
});

test('without `$accept`, the answer is too large for a stream, as before', async () => {
	await assert.rejects(
		own.consumer.call(node.peerId, 'belege-bridge', 'paperless.document', { id: 7 }),
		(/** @type {any} */ e) => e.code === 'TOO_LARGE'
	);
	assert.equal(node.blocksEmpty(), true);
});

test('the protocol is the bridge’s own, not the books’ Bitswap', () => {
	assert.equal(BLOCKS_PROTOCOL, '/le-space/bridge-blocks/1.0.0');
	assert.ok(
		node.libp2p.getProtocols().includes(BLOCKS_PROTOCOL),
		node.libp2p.getProtocols().join(' ')
	);
	assert.ok(!node.libp2p.getProtocols().some((p) => p.startsWith('/ipfs/bitswap/')));
});

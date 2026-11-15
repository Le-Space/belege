// SPDX-License-Identifier: AGPL-3.0-or-later
// The limits of a block answer (#578): a root that names more chunks than its
// size needs, or a chunk bigger than a block, is refused before it is all
// fetched; answers made side by side count together against what the bridge
// may hold. Made-up bytes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { memory } from '@libp2p/memory';
import { createLibp2p } from 'libp2p';

import { CHUNK_BYTES, openBlocks } from '../src/blocks.js';
import { createBlockExchange } from '../src/exchange.js';

/** @param {Uint8Array} bytes @param {number} code */
const cidOf = async (bytes, code) => CID.createV1(code, await sha256.digest(bytes));

/** A store from blocks. @param {Map<string, Uint8Array>} blocks */
const getter = (blocks) => async (/** @type {CID} */ cid) => {
	const got = blocks.get(cid.toString());
	if (!got) throw new Error('not here');
	return got;
};

test('a root that names more chunks than its size needs is refused before anything is fetched', async () => {
	const chunk = new Uint8Array(16).fill(1);
	const chunkCid = await cidOf(chunk, raw.code);
	const rootBytes = dagCbor.encode({ v: 1, size: 16, chunks: Array(5).fill(chunkCid) });
	const root = await cidOf(rootBytes, dagCbor.code);
	let asked = 0;
	const blocks = new Map([
		[root.toString(), rootBytes],
		[chunkCid.toString(), chunk]
	]);
	await assert.rejects(
		openBlocks(
			async (cid) => {
				asked++;
				return getter(blocks)(cid);
			},
			root,
			new Uint8Array(32)
		),
		/not a block answer/
	);
	assert.equal(asked, 1, 'only the root');
});

test('a chunk bigger than a block, or more bytes than the root said, is refused', async () => {
	const big = new Uint8Array(CHUNK_BYTES + 1);
	const bigCid = await cidOf(big, raw.code);
	const rootBytes = dagCbor.encode({ v: 1, size: CHUNK_BYTES + 1, chunks: [bigCid] });
	const root = await cidOf(rootBytes, dagCbor.code);
	const blocks = new Map([
		[root.toString(), rootBytes],
		[bigCid.toString(), big]
	]);
	await assert.rejects(openBlocks(getter(blocks), root, new Uint8Array(32)), /do not add up/);
});

test('answers made side by side count together against what the bridge may hold', async () => {
	const libp2p = await createLibp2p({
		addresses: { listen: [`/memory/bounds-${Math.random().toString(36).slice(2)}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()]
	});
	const exchange = await createBlockExchange({ libp2p, maxHeldBytes: 400 * 1024 });
	try {
		const results = await Promise.allSettled(
			[1, 2, 3].map(() => exchange.offer(new Uint8Array(200 * 1024)))
		);
		const kept = results.filter((r) => r.status === 'fulfilled').length;
		const refused = results.filter(
			(r) => r.status === 'rejected' && r.reason instanceof RangeError
		).length;
		assert.equal(kept, 1, 'one answer fits with its overhead');
		assert.equal(refused, 2);
	} finally {
		await exchange.stop();
		await libp2p.stop();
	}
});

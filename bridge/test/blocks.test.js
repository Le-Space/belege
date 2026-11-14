// The shelf of big answers (#578): sealed, held for one device and a while,
// and really gone from the store once released, swept or cleared.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MemoryBlockstore } from 'blockstore-core';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';

import { createBlockShelf } from '../src/blocks.js';

const KEY = new Uint8Array(32).fill(7);
const A = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
const B = '12D3KooWQYhTNQdmr3ArTeUHRYzFg94BKyTkoWBDWez9kSCVe2Xo';

/** A store's answer, whole: bytes, or (blockstore-core 6) an iterable of chunks. @param {any} got */
async function whole(got) {
	if (got instanceof Uint8Array) return got;
	const parts = [];
	for await (const part of got) parts.push(part);
	return Buffer.concat(parts);
}

/** @param {MemoryBlockstore} store @param {string} root */
async function cidsOf(store, root) {
	const rootCid = CID.parse(root);
	const decoded = /** @type {any} */ (dagCbor.decode(await whole(store.get(rootCid))));
	return [rootCid, ...decoded.chunks];
}

/** @param {MemoryBlockstore} store */
async function count(store) {
	let n = 0;
	for await (const pair of store.getAll()) if (pair) n++;
	return n;
}

describe('the shelf of big answers', () => {
	test('released by the device it is for, and then gone from the store', async () => {
		const store = new MemoryBlockstore();
		const shelf = await createBlockShelf({ blockstore: store, authKey: KEY });
		const bytes = new Uint8Array(2 * 1024 * 1024 + 5).fill(3);
		const { cid, size } = await shelf.put(bytes, A);
		assert.equal(size, bytes.length);
		const cids = await cidsOf(store, cid);
		assert.equal(cids.length, 4);
		for (const c of cids) assert.equal(await store.has(c), true);
		assert.equal(await shelf.release(cid, B), false, 'not the device it is for');
		assert.equal(await shelf.release('bafy-nothing', A), false);
		assert.equal(await shelf.release(cid, A), true);
		for (const c of cids) assert.equal(await store.has(c), false);
		assert.equal(await count(store), 0);
		assert.deepEqual(shelf.held(), { answers: 0, bytes: 0 });
	});

	test('swept after its time, cleared at stop, refused above the cap', async () => {
		let now = 0;
		const store = new MemoryBlockstore();
		const shelf = await createBlockShelf({
			blockstore: store,
			authKey: KEY,
			ttlMs: 1000,
			maxBytes: 3 * 1024 * 1024,
			now: () => now
		});
		await shelf.put(new Uint8Array(1024 * 1024), A);
		now = 999;
		await shelf.sweep();
		assert.equal(shelf.held().answers, 1);
		now = 1000;
		await shelf.sweep();
		assert.equal(await count(store), 0);
		await shelf.put(new Uint8Array(2 * 1024 * 1024), A);
		await assert.rejects(shelf.put(new Uint8Array(1024 * 1024), B), { code: 'UNAVAILABLE' });
		await shelf.clear();
		assert.equal(await count(store), 0);
		assert.deepEqual(shelf.held(), { answers: 0, bytes: 0 });
	});

	test('nothing in the clear in the store', async () => {
		const store = new MemoryBlockstore();
		const shelf = await createBlockShelf({ blockstore: store, authKey: KEY });
		const text = new TextEncoder().encode('Wolkenfabrik Hosting GmbH, Rechnung, Summe 12,34 EUR');
		await shelf.put(text, A);
		for await (const pair of store.getAll()) {
			const bytes = Buffer.from(await whole(pair.bytes));
			assert.equal(bytes.includes(Buffer.from('Wolkenfabrik')), false);
		}
	});
});

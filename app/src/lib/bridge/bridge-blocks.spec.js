import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core';
import * as dagCbor from '@ipld/dag-cbor';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { bridgeBlockKey } from '@le-space/bridge-protocol';

import { createBlobStore } from '../receipts/blob-store.js';
import { fetchBridgeBlock, isBlockAnswer } from './bridge-blocks.js';

const AUTH_KEY = new Uint8Array(32).fill(7);

/** @param {any} got */
async function whole(got) {
	const value = await got;
	if (value instanceof Uint8Array) return value;
	const parts = [];
	for await (const part of value) parts.push(part);
	return new Uint8Array(Buffer.concat(parts));
}

/**
 * The device's side: its own store, and Helia's blockstore over it, which
 * asks the bridge for what is not here and keeps it (as bitswap does).
 *
 * @param {MemoryBlockstore} bridge
 */
function deviceOf(bridge) {
	const store = new MemoryBlockstore();
	const blockstore = {
		put: (/** @type {CID} */ cid, /** @type {Uint8Array} */ b) => store.put(cid, b),
		async get(/** @type {CID} */ cid) {
			if (await store.has(cid)) return whole(store.get(cid));
			const bytes = await whole(bridge.get(cid));
			await store.put(cid, bytes);
			return bytes;
		}
	};
	return { store, blockstore };
}

/**
 * Blocks as the bridge's node shelves them (bridge/src/blocks.js): the receipt files' format, the bridge's block key.
 *
 * @param {Uint8Array} bytes
 */
async function shelved(bytes, authKey = AUTH_KEY) {
	const bridge = new MemoryBlockstore();
	const blobs = await createBlobStore({ blockstore: bridge, key: await bridgeBlockKey(authKey) });
	const cid = await blobs.put(bytes);
	return { bridge, cid };
}

/** @param {any} store */
async function count(store) {
	let n = 0;
	for await (const pair of store.getAll()) if (pair) n++;
	return n;
}

describe('a big answer of the bridge as blocks (#578)', () => {
	it('opens, checks the size, and keeps nothing here afterwards', async () => {
		const bytes = new Uint8Array(2 * 1024 * 1024 + 99);
		for (let i = 0; i < bytes.length; i += 101) bytes[i] = i & 0xff;
		const { bridge, cid } = await shelved(bytes);
		const { store, blockstore } = deviceOf(bridge);
		const got = await fetchBridgeBlock({
			blockstore,
			store,
			authKey: AUTH_KEY,
			block: { cid, size: bytes.length }
		});
		expect(got).toEqual(bytes);
		expect(await count(store)).toBe(0);
	});

	it('refuses a size other than the answer named before a chunk comes, and a wrong key', async () => {
		const bytes = new TextEncoder().encode('Wolkenfabrik Hosting GmbH, Rechnung');
		let { bridge, cid } = await shelved(bytes);
		let device = deviceOf(bridge);
		await expect(
			fetchBridgeBlock({ ...device, authKey: AUTH_KEY, block: { cid, size: bytes.length + 1 } })
		).rejects.toThrow('Not a bridge answer.');
		expect(await count(device.store)).toBe(0);

		({ bridge, cid } = await shelved(bytes, new Uint8Array(32).fill(9)));
		device = deviceOf(bridge);
		await expect(
			fetchBridgeBlock({ ...device, authKey: AUTH_KEY, block: { cid, size: bytes.length } })
		).rejects.toThrow();
		expect(await count(device.store)).toBe(0);
	});

	it('never touches what was here before: a receipt’s own file named as an answer stays', async () => {
		// The device's own receipt file, under its own key.
		const { bridge } = await shelved(new Uint8Array(1));
		const { store, blockstore } = deviceOf(bridge);
		const own = await createBlobStore({ blockstore: store, key: new Uint8Array(32).fill(3) });
		const file = await own.put(new Uint8Array(3 * 1024 * 1024).fill(5));
		const before = await count(store);
		await expect(
			fetchBridgeBlock({ blockstore, store, authKey: AUTH_KEY, block: { cid: file, size: 1 } })
		).rejects.toThrow('Not a bridge answer.');
		expect(await count(store)).toBe(before);
		expect((await own.get(file)).length).toBe(3 * 1024 * 1024);
	});

	it('refuses a root with more chunks than its size needs, and a chunk over 1 MiB', async () => {
		const bridge = new MemoryBlockstore();
		const chunk = new Uint8Array(1);
		const one = CID.createV1(raw.code, await sha256.digest(chunk));
		await bridge.put(one, chunk);
		const root = dagCbor.encode({ v: 1, size: 29, chunks: [one, one] });
		const rootCid = CID.createV1(dagCbor.code, await sha256.digest(root));
		await bridge.put(rootCid, root);
		let device = deviceOf(bridge);
		await expect(
			fetchBridgeBlock({
				...device,
				authKey: AUTH_KEY,
				block: { cid: rootCid.toString(), size: 1 }
			})
		).rejects.toThrow('Not a bridge answer.');

		const big = new Uint8Array(1024 * 1024 + 1);
		const bigCid = CID.createV1(raw.code, await sha256.digest(big));
		await bridge.put(bigCid, big);
		const root2 = dagCbor.encode({ v: 1, size: big.length, chunks: [bigCid, bigCid] });
		const root2Cid = CID.createV1(dagCbor.code, await sha256.digest(root2));
		await bridge.put(root2Cid, root2);
		device = deviceOf(bridge);
		await expect(
			fetchBridgeBlock({
				...device,
				authKey: AUTH_KEY,
				block: { cid: root2Cid.toString(), size: big.length - 28 }
			})
		).rejects.toThrow('Not a bridge answer.');
		expect(await count(device.store)).toBe(0);
	});

	it('knows an answer that names blocks', () => {
		expect(isBlockAnswer({ cid: 'bafy', size: 10 })).toBe(true);
		expect(isBlockAnswer({ cid: 'bafy', size: -1 })).toBe(false);
		expect(isBlockAnswer({ cid: 'bafy', size: 1e12 })).toBe(false);
		expect(isBlockAnswer({ cid: 7, size: 1 })).toBe(false);
		expect(isBlockAnswer(null)).toBe(false);
	});
});

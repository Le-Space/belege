// Receipt files sealed in a blockstore: the round trip, what lands on disk,
// and that a wrong key or a changed block fails loudly.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { CID } from 'multiformats/cid';

import { deriveBlobKey } from '../database-keys.js';
import { CHUNK_BYTES, createBlobStore, sha256Hex } from './blob-store.js';

const MARKER = 'Belegmarker-Wolkenfabrik-7f3a';
const prf = () => crypto.getRandomValues(new Uint8Array(32));

/** A fake PDF with a readable marker in it. */
function fakePdf(size = 2048) {
	const bytes = new Uint8Array(size).fill(0x20);
	bytes.set(new TextEncoder().encode(`%PDF-1.4\n${MARKER}\n`), 0);
	return bytes;
}

/** Every block's bytes, as text and hex. */
async function everything(/** @type {MemoryBlockstore} */ store) {
	let text = '';
	for await (const { bytes } of store.getAll()) {
		for await (const chunk of /** @type {any} */ (bytes)) {
			text += new TextDecoder('latin1').decode(chunk) + Buffer.from(chunk).toString('hex');
		}
	}
	return text;
}

describe('blob store', () => {
	it('round trip: the same bytes come back', async () => {
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: await deriveBlobKey(prf())
		});
		const file = fakePdf();
		const cid = await blobs.put(file);
		expect(CID.parse(cid).version).toBe(1);
		expect(await blobs.get(cid)).toEqual(file);
	});

	it('stores ciphertext only: neither the marker nor the file bytes are readable', async () => {
		const blockstore = new MemoryBlockstore();
		const blobs = await createBlobStore({ blockstore, key: await deriveBlobKey(prf()) });
		const file = fakePdf();
		await blobs.put(file);
		const stored = await everything(blockstore);
		expect(stored).not.toContain(MARKER);
		expect(stored).not.toContain('%PDF-');
		expect(stored).not.toContain(Buffer.from(file.subarray(0, 64)).toString('hex'));
	});

	it('the same file twice gives two different ciphertexts (a fresh nonce each time)', async () => {
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: await deriveBlobKey(prf())
		});
		const file = fakePdf();
		expect(await blobs.put(file)).not.toBe(await blobs.put(file));
	});

	it('a wrong key cannot open it', async () => {
		const blockstore = new MemoryBlockstore();
		const mine = await createBlobStore({ blockstore, key: await deriveBlobKey(prf()) });
		const theirs = await createBlobStore({ blockstore, key: await deriveBlobKey(prf()) });
		const cid = await mine.put(fakePdf());
		await expect(theirs.get(cid)).rejects.toThrow();
	});

	it('large files are cut into 1 MiB blocks and put together again', async () => {
		const blockstore = new MemoryBlockstore();
		const blobs = await createBlobStore({ blockstore, key: await deriveBlobKey(prf()) });
		const file = fakePdf(CHUNK_BYTES * 2 + 1234);
		const cid = await blobs.put(file);
		let blocks = 0;
		for await (const block of blockstore.getAll()) {
			blocks++;
			let size = 0;
			for await (const chunk of /** @type {any} */ (block.bytes)) size += chunk.length;
			expect(size).toBeLessThanOrEqual(CHUNK_BYTES);
		}
		expect(blocks).toBe(4); // three chunks and the root
		// Compared natively: toEqual walks 2 MiB byte by byte (7 s alone, past
		// the 30 s timeout under a full parallel run).
		const back = await blobs.get(cid);
		expect(back.length).toBe(file.length);
		expect(Buffer.compare(back, file)).toBe(0);
	});

	it('a changed block fails instead of returning something else', async () => {
		const blockstore = new MemoryBlockstore();
		const blobs = await createBlobStore({ blockstore, key: await deriveBlobKey(prf()) });
		const cid = await blobs.put(fakePdf());
		for await (const { cid: key, bytes } of blockstore.getAll()) {
			if (key.toString() === cid) continue;
			const parts = [];
			for await (const chunk of /** @type {any} */ (bytes)) parts.push(chunk);
			const tampered = Buffer.concat(parts);
			tampered[tampered.length - 1] ^= 1;
			await blockstore.put(key, tampered);
		}
		await expect(blobs.get(cid)).rejects.toThrow();
	});

	it('sha256Hex is the plain SHA-256 of the bytes', async () => {
		expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	describe('has and fetch: a file from another device, before it is opened', () => {
		/**
		 * Helia's blockstore in small: a block missing here is asked of `remote`
		 * (the own devices) unless `offline`, and kept here once it came. A
		 * block nobody has waits until the signal aborts.
		 *
		 * @param {MemoryBlockstore} local
		 * @param {MemoryBlockstore} remote
		 */
		function networked(local, remote) {
			let asked = 0;
			return {
				asked: () => asked,
				has: (/** @type {any} */ cid) => local.has(cid),
				put: (/** @type {any} */ cid, /** @type {Uint8Array} */ bytes) => local.put(cid, bytes),
				async get(/** @type {any} */ cid, /** @type {any} */ options = {}) {
					if (await local.has(cid)) return local.get(cid);
					if (options.offline) throw new Error('Not found');
					asked++;
					if (await remote.has(cid)) {
						const parts = [];
						for await (const part of /** @type {any} */ (remote.get(cid))) parts.push(part);
						const bytes = Buffer.concat(parts);
						await local.put(cid, bytes);
						return bytes;
					}
					return new Promise((_, reject) => {
						options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
					});
				}
			};
		}

		it('a file added on another device: not here, fetched sealed, then opened offline', async () => {
			const key = await deriveBlobKey(prf());
			const there = new MemoryBlockstore();
			const cid = await (
				await createBlobStore({ blockstore: there, key })
			).put(fakePdf(CHUNK_BYTES + 99));
			const local = new MemoryBlockstore();
			const blockstore = networked(local, there);
			const blobs = await createBlobStore({ blockstore, key, online: true });
			expect(await blobs.has(cid)).toBe(false);
			expect(await blobs.fetch(cid)).toBe('fetched');
			expect(await blobs.has(cid)).toBe(true);
			expect(await blobs.fetch(cid)).toBe('here');
			// What came is what was stored there: sealed, nothing readable.
			expect(await everything(local)).not.toContain(MARKER);
			// The other device gone: this one opens it from what it holds.
			const offline = await createBlobStore({ blockstore: local, key });
			expect((await offline.get(cid)).length).toBe(CHUNK_BYTES + 99);
		});

		it('half a file is not here: a missing chunk counts', async () => {
			const key = await deriveBlobKey(prf());
			const there = new MemoryBlockstore();
			const cid = await (
				await createBlobStore({ blockstore: there, key })
			).put(fakePdf(CHUNK_BYTES + 99));
			const local = new MemoryBlockstore();
			// Only the root came.
			const root = CID.parse(cid);
			const parts = [];
			for await (const part of /** @type {any} */ (there.get(root))) parts.push(part);
			await local.put(root, Buffer.concat(parts));
			const blobs = await createBlobStore({
				blockstore: networked(local, there),
				key,
				online: true
			});
			expect(await blobs.has(cid)).toBe(false);
			expect(await blobs.fetch(cid)).toBe('fetched');
			expect(await blobs.has(cid)).toBe(true);
		});

		it('a file larger than asked for is left for when it is opened', async () => {
			const key = await deriveBlobKey(prf());
			const there = new MemoryBlockstore();
			const cid = await (
				await createBlobStore({ blockstore: there, key })
			).put(fakePdf(CHUNK_BYTES * 2));
			const local = new MemoryBlockstore();
			const blockstore = networked(local, there);
			const blobs = await createBlobStore({ blockstore, key, online: true });
			expect(await blobs.fetch(cid, { maxBytes: CHUNK_BYTES })).toBe('too-large');
			expect(blockstore.asked()).toBe(1); // the root only
			expect(await blobs.has(cid)).toBe(false);
		});

		it('a block nobody has fails after its time, and offline nothing is asked', async () => {
			const key = await deriveBlobKey(prf());
			const cid = await (
				await createBlobStore({ blockstore: new MemoryBlockstore(), key })
			).put(fakePdf());
			const blockstore = networked(new MemoryBlockstore(), new MemoryBlockstore());
			const online = await createBlobStore({ blockstore, key, online: true });
			await expect(online.fetch(cid, { blockMs: 20 })).rejects.toThrow();
			const offline = await createBlobStore({ blockstore, key });
			const before = blockstore.asked();
			await expect(offline.fetch(cid)).rejects.toThrow(/not on this device/);
			expect(blockstore.asked()).toBe(before);
		});

		it('not a receipt file: has says no, fetch refuses', async () => {
			const blobs = await createBlobStore({
				blockstore: new MemoryBlockstore(),
				key: await deriveBlobKey(prf())
			});
			expect(await blobs.has('not a cid')).toBe(false);
			const rawCid = CID.createV1(0x55, CID.parse(await blobs.put(fakePdf())).multihash);
			await expect(blobs.fetch(rawCid.toString())).rejects.toThrow(/Not a receipt file/);
		});
	});
});

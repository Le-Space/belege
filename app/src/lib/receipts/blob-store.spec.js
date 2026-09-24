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
		expect(await blobs.get(cid)).toEqual(file);
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
});

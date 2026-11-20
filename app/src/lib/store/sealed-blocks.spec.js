// Every database goes through the sealed path, and every block the books
// write is sealed or public by design (audit plan #209; standing tests 2 and
// 3 of #537).
//
// The store is opened as the app opens it – every collection, settings and
// events included, with the books' own access list – on a real OrbitDB and
// Helia. A record goes into each collection and a file into the blob store;
// then every block of the block store is classified (block-classes.js). A
// database opened any other way writes blocks that are `neither`: the control
// at the end shows that. The last tests read the sources: a database is opened
// only where this spec knows of it, each time with the sealing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';

import { createOfflineLibp2p } from '../network.js';
import { deriveBlobKey, deriveDatabaseKey, deriveReplicationKey } from '../database-keys.js';
import { sealedEncryption } from '../entry-encryption.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { booksAccessController, sealAccessLists } from './books-access.js';
import { classifyBlocks } from './block-classes.js';
import { COLLECTIONS, openStore } from './repository.js';

const MARKER = 'Wolkenfabrik-Marker-51c7e2';
const prfOutput = crypto.getRandomValues(new Uint8Array(32));

/** @type {any} */ let helia;
/** @type {any} */ let orbitdb;
/** Where OrbitDB keeps what is not handed memory storages (the access lists): not in the checkout. */
/** @type {string} */ let directory;
/** @type {Awaited<ReturnType<typeof openStore>>} */ let store;
/** @type {{ replicationKey: Uint8Array, blobKey: Uint8Array }} */ let keys;

const memoryStorages = async () => ({
	headsStorage: await MemoryStorage(),
	indexStorage: await MemoryStorage()
});

/** Every block of Helia's block store. */
async function allBlocks() {
	/** @type {{ cid: any, bytes: Uint8Array }[]} */
	const blocks = [];
	for await (const { cid, bytes } of helia.blockstore.getAll()) {
		/** @type {Uint8Array[]} */
		const parts = [];
		for await (const chunk of bytes) parts.push(chunk);
		blocks.push({ cid, bytes: Buffer.concat(parts) });
	}
	return blocks;
}

beforeAll(async () => {
	helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const keystore = await KeyStore({ storage: await MemoryStorage() });
	const identities = await Identities({ ipfs: helia, keystore });
	directory = await mkdtemp(join(tmpdir(), 'belege-sealed-blocks-'));
	orbitdb = await createOrbitDB({
		ipfs: helia,
		// @ts-expect-error `identities` is a documented option the bundled types omit
		identities,
		id: 'sealed-blocks-spec',
		directory
	});
	const encryptionKey = await deriveDatabaseKey(prfOutput);
	const replicationKey = await deriveReplicationKey(prfOutput);
	keys = { replicationKey, blobKey: await deriveBlobKey(prfOutput) };
	sealAccessLists(await sealedEncryption(encryptionKey, replicationKey));
	store = await openStore({
		orbitdb,
		encryptionKey,
		replicationKey,
		prfOutput,
		// As the app does since the books have an identity of their own (#496).
		accessController: booksAccessController(orbitdb.identity.id),
		openOptions: memoryStorages
	});
});

afterAll(async () => {
	await store?.close();
	sealAccessLists(null);
	await orbitdb?.stop();
	await helia?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe('what the books write to the block store', () => {
	it('is sealed or public by design, in every collection and for a receipt file', async () => {
		for (const name of COLLECTIONS) {
			await /** @type {any} */ (store)[name].put({
				bookedOn: '2026-01-02',
				counterparty: MARKER,
				purpose: `${MARKER} in ${name}`,
				amountCents: -1234
			});
		}
		const blobs = await createBlobStore({ blockstore: helia.blockstore, key: keys.blobKey });
		await blobs.put(new TextEncoder().encode(`%PDF-1.7 ${MARKER} `.repeat(2000)));

		const blocks = await allBlocks();
		const classes = await classifyBlocks(blocks, keys);
		expect(classes.filter((c) => c.class === 'neither')).toEqual([]);

		/** @type {Record<string, number>} */
		const counts = {};
		for (const c of classes) counts[c.class] = (counts[c.class] ?? 0) + 1;
		// Each collection wrote an entry; each has a manifest, and so has its access list.
		expect(counts['sealed entry']).toBeGreaterThanOrEqual(COLLECTIONS.length);
		expect(counts.manifest).toBe(2 * COLLECTIONS.length);
		expect(counts['file root']).toBe(1);
		expect(counts['sealed file chunk']).toBeGreaterThanOrEqual(1);

		// No block says the marker, in whatever class it is.
		const decoder = new TextDecoder('utf-8', { fatal: false });
		expect(blocks.filter((b) => decoder.decode(b.bytes).includes(MARKER))).toEqual([]);

		// What the public blocks tell whoever holds them: nothing of the books.
		for (const c of classes.filter((c) => c.reveals)) {
			expect(JSON.stringify(c.reveals)).not.toContain(MARKER);
			for (const name of COLLECTIONS) expect(JSON.stringify(c.reveals)).not.toContain(name);
		}
	});

	it('the control: a database opened without the sealing writes blocks that are neither', async () => {
		const before = new Set((await allBlocks()).map((b) => b.cid.toString()));
		const plain = await orbitdb.open('control', { type: 'documents', ...(await memoryStorages()) });
		try {
			await plain.put({ _id: 'x', counterparty: MARKER });
			const added = (await allBlocks()).filter((b) => !before.has(b.cid.toString()));
			const classes = await classifyBlocks(added, keys);
			// Its manifest names it in the clear, its entry is readable: both are caught.
			expect(classes.filter((c) => c.class === 'neither').length).toBeGreaterThanOrEqual(2);
			expect(classes.some((c) => c.class === 'sealed entry')).toBe(false);
		} finally {
			await plain.drop();
			await plain.close();
		}
	});
});

describe('where a database is opened', () => {
	const LIB = fileURLToPath(new URL('..', import.meta.url));
	/** @param {string} dir @returns {string[]} */
	const filesIn = (dir) =>
		readdirSync(dir).flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? filesIn(path) : [path];
		});
	const sources = filesIn(join(LIB, '..'))
		.filter((file) => /\.(js|svelte)$/.test(file) && !/\.spec\.js$/.test(file))
		// Without comments: they speak of `orbitdb.open()` too.
		.map((file) => ({
			file: relative(LIB, file),
			text: readFileSync(file, 'utf8').replace(/^\s*(\/\/|\/?\*).*$/gm, '')
		}));

	/** The text of every `orbitdb.open(…)` call in `text`, to its closing bracket. */
	const openCalls = (/** @type {string} */ text) => {
		/** @type {string[]} */
		const calls = [];
		for (const match of text.matchAll(/\borbitdb\.open\s*\(/g)) {
			let depth = 1;
			let at = match.index + match[0].length;
			while (depth > 0 && at < text.length) {
				if (text[at] === '(') depth++;
				if (text[at] === ')') depth--;
				at++;
			}
			calls.push(text.slice(match.index, at));
		}
		return calls;
	};

	// The store itself; the access list of each database; the address lookups
	// of a restore (node.js) and the access lists of a backup (archive.js).
	const KNOWN = ['backup/archive.js', 'node.js', 'store/books-access.js', 'store/repository.js'];

	it('only in the files this spec knows of', () => {
		expect(
			sources
				.filter((s) => openCalls(s.text).length > 0)
				.map((s) => s.file)
				.sort()
		).toEqual(KNOWN);
		// … and OrbitDB itself is made in one place.
		expect(sources.filter((s) => /\bcreateOrbitDB\s*\(/.test(s.text)).map((s) => s.file)).toEqual([
			'node.js'
		]);
	});

	it('each time with the sealing: `encryption`, or the options of the older sealed books', () => {
		for (const { file, text } of sources) {
			for (const call of openCalls(text)) {
				// `options`, `oldOptions`, `passkeyOptions`: checked to be sealed ones below.
				expect(call, `${file}: ${call}`).toMatch(/\bencryption\b|\b(o|oldO|passkeyO)ptions\b/);
			}
			for (const [, name] of text.matchAll(/\b((?:o|oldO|passkeyO)ptions) = await (\w+)\(/g)) {
				if (!openCalls(text).some((call) => call.includes(name))) continue;
				expect(text, `${file}: ${name}`).toMatch(
					new RegExp(`\\b${name} = await (oldBooksOpenOptions|passkeyBooksOpenOptions)\\(`)
				);
			}
		}
	});

	it('the options of the older books carry the sealing, too', async () => {
		const { oldBooksOpenOptions, passkeyBooksOpenOptions } = await import('./repository.js');
		const key = await deriveDatabaseKey(prfOutput);
		const old = await oldBooksOpenOptions(key, 'did:key:zExample');
		expect(typeof old.encryption.data.encrypt).toBe('function');
		const passkey = await passkeyBooksOpenOptions(key, keys.replicationKey, 'did:key:zExample');
		expect(typeof passkey.encryption.data.encrypt).toBe('function');
		expect(typeof passkey.encryption.replication.encrypt).toBe('function');
	});
});

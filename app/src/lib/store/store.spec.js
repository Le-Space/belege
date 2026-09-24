// The store against a real OrbitDB and Helia, in Node, in memory.
//
// Proves that put/get/list/softDelete work with encryption switched on, and —
// because @orbitdb/core 4.0.0 silently drops `encryption` for documents
// databases (see sealed-documents.js) — that what lands in the blockstore is
// ciphertext, by reading the raw blocks back and looking for the plaintext.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { Documents, Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';

import { createOfflineLibp2p } from '../network.js';
import { deriveDatabaseKey } from '../database-keys.js';
import { payloadEncryption } from '../entry-encryption.js';
import { openStore } from './repository.js';
import { isUlid } from './ids.js';
import SealedDocuments from './sealed-documents.js';

const MARKER = 'Stadtwerke-Marker-7f3a9c';

/** @type {any} */ let helia;
/** @type {any} */ let orbitdb;
/** @type {Awaited<ReturnType<typeof openStore>>} */ let store;
const prfOutput = crypto.getRandomValues(new Uint8Array(32));

/** @type {Record<string, { headsStorage: any, indexStorage: any }>} */
const storagesByCollection = {};

// Heads and index in memory; entries go through the default IPFS block
// storage, so they land in Helia's (memory) blockstore exactly as in the app.
const memoryStorages = async () => ({
	headsStorage: await MemoryStorage(),
	indexStorage: await MemoryStorage()
});

/** Every block in Helia's blockstore, decoded as text. */
async function blockstoreText() {
	const decoder = new TextDecoder('utf-8', { fatal: false });
	let text = '';
	// interface-blockstore 7: `bytes` is an iterable of chunks.
	for await (const { bytes } of helia.blockstore.getAll()) {
		for await (const chunk of bytes) text += decoder.decode(chunk);
	}
	return text;
}

beforeAll(async () => {
	helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const keystore = await KeyStore({ storage: await MemoryStorage() });
	const identities = await Identities({ ipfs: helia, keystore });
	// @ts-expect-error `identities` is a documented option the bundled types omit
	orbitdb = await createOrbitDB({ ipfs: helia, identities, id: 'store-spec' });
	store = await openStore({
		orbitdb,
		encryptionKey: await deriveDatabaseKey(prfOutput),
		prfOutput,
		openOptions: async (/** @type {string} */ name) =>
			(storagesByCollection[name] = await memoryStorages())
	});
});

afterAll(async () => {
	await store?.close();
	await orbitdb?.stop();
	await helia?.stop();
});

describe('store (real OrbitDB + Helia, sealed)', () => {
	it('puts a transaction and fills the common fields', async () => {
		const tx = await store.transactions.put({
			bookedOn: '2026-08-22',
			counterparty: MARKER,
			purpose: 'Abschlag August',
			amountCents: -5259
		});

		expect(isUlid(tx.id)).toBe(true);
		expect(tx.author).toBe(orbitdb.identity.id);
		expect(tx.deleted).toBe(false);
		expect(tx.createdAt).toBe(tx.updatedAt);
		expect(await store.transactions.get(tx.id)).toEqual(tx);
	});

	it('updates a record in place, keeping createdAt', async () => {
		const tx = await store.transactions.put({ bookedOn: '2026-08-01', amountCents: 100 });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const updated = await store.transactions.put({ ...tx, amountCents: 250 });

		expect(updated.id).toBe(tx.id);
		expect(updated.createdAt).toBe(tx.createdAt);
		expect(updated.updatedAt > tx.updatedAt).toBe(true);
		expect((await store.transactions.list()).filter((r) => r.id === tx.id)).toHaveLength(1);
	});

	it('refuses money that is not integer cents', async () => {
		await expect(store.transactions.put({ amountCents: 52.59 })).rejects.toThrow(/cents/);
	});

	it('lists with a filter, newest first, and hides soft-deleted records', async () => {
		const a = await store.partners.put({ name: 'A GmbH' });
		const b = await store.partners.put({ name: 'B AG' });

		expect((await store.partners.list()).map((p) => p.id)).toEqual([b.id, a.id]);
		expect(await store.partners.list({ where: (p) => p.name === 'B AG' })).toHaveLength(1);

		const gone = await store.partners.softDelete(a.id);
		expect(gone.deleted).toBe(true);
		expect((await store.partners.list()).map((p) => p.id)).toEqual([b.id]);
		expect(await store.partners.list({ includeDeleted: true })).toHaveLength(2);
		expect((await store.partners.get(a.id))?.deleted).toBe(true);
	});

	it('tells subscribers about a write, and stops when unsubscribed', async () => {
		/** @type {string[]} */
		const seen = [];
		const off = store.receipts.onChange(({ collection }) => seen.push(collection));

		await store.receipts.put({ fileName: 'rechnung.pdf', amountCents: 1999 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		off();
		await store.receipts.put({ fileName: 'noch-eine.pdf' });
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(seen).toEqual(['receipts']);
	});

	it('names the databases without the DID in them', () => {
		for (const collection of [store.transactions, store.receipts, store.partners]) {
			expect(collection.address).toMatch(/^\/orbitdb\//);
		}
		expect(store.transactions.address).not.toBe(store.receipts.address);
	});

	it('writes ciphertext to the blockstore, never the counterparty', async () => {
		// The marker went in with the first test. If it is readable in any block,
		// the entries are not sealed — which is what stock `Documents` does.
		const text = await blockstoreText();

		expect(text.length).toBeGreaterThan(0);
		expect(text).not.toContain(MARKER);
		expect(text).not.toContain('Abschlag August');
	});

	it('guards the upstream bug: stock Documents leaves the same data readable', async () => {
		// When this starts failing, @orbitdb/core forwards `encryption` for
		// documents again and sealed-documents.js can go.
		const db = await orbitdb.open('upstream-documents-check', {
			type: 'documents',
			Database: Documents({ indexBy: 'id' }),
			encryption: await payloadEncryption(await deriveDatabaseKey(prfOutput)),
			...(await memoryStorages())
		});
		const marker = 'Upstream-Plaintext-Check-51c2';
		await db.put({ id: 'x', counterparty: marker });

		expect(await blockstoreText()).toContain(marker);
		await db.close();
	});

	it('cannot be read with another passkey’s key', async () => {
		const tx = await store.transactions.put({ bookedOn: '2026-09-01', amountCents: 1 });
		// A second OrbitDB on the same blocks and the same heads — everything a
		// device holding a copy of the data has — but another passkey's key.
		const otherPrf = crypto.getRandomValues(new Uint8Array(32));
		const intruderOrbit = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities: await Identities({
				ipfs: helia,
				keystore: await KeyStore({ storage: await MemoryStorage() })
			}),
			id: 'intruder'
		});
		const intruder = await intruderOrbit.open(store.transactions.address, {
			Database: SealedDocuments({ indexBy: 'id' }),
			encryption: await payloadEncryption(await deriveDatabaseKey(otherPrf)),
			headsStorage: storagesByCollection.transactions.headsStorage,
			indexStorage: await MemoryStorage(),
			// Same libp2p node as the real store, which already serves this
			// address's heads protocol.
			sync: false
		});

		await expect(intruder.all()).rejects.toThrow(/decrypt/i);
		await intruderOrbit.stop();
		expect((await store.transactions.get(tx.id))?.amountCents).toBe(1);
	});
});

// The books' own identity (#496), against a real OrbitDB and Helia in Node:
// the passkey's sealed databases move to databases rooted at the books'
// identity with every version and its author, a second move adds nothing,
// the books' identity writes and another identity does not, and the access
// list's own database is never opened unsealed. Made-up data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import {
	Identities,
	KeyStore,
	MemoryStorage,
	createOrbitDB,
	useIdentityProvider
} from '@orbitdb/core';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	createSecretSigner
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOfflineLibp2p } from '../network.js';
import { deriveBooksSecret, deriveDatabaseKey, deriveReplicationKey } from '../database-keys.js';
import { sealedEncryption } from '../entry-encryption.js';
import { BOOKS_IDENTITY_INFO, createBooksIdentities } from '../session-identities.js';
import { booksAccessController, sealAccessLists } from './books-access.js';
import { openStore } from './repository.js';

const MARKER = 'Wolkenfabrik-Identitaet-7c21';
const prfOutput = crypto.getRandomValues(new Uint8Array(32));

/** @param {any} log */
async function count(log) {
	let n = 0;
	for await (const entry of log.iterator()) if (entry) n += 1;
	return n;
}

describe('the books’ own identity', () => {
	/** @type {any} */ let helia;
	/** @type {string} */ let directory;
	/** @type {any} */ let passkeyDb;
	/** @type {any} */ let booksDb;
	/** @type {string} */ let passkeyDid;
	/** @type {Record<string, any>} */ let before;
	/** @type {{ encryptionKey: Uint8Array, replicationKey: Uint8Array }} */
	const keys = { encryptionKey: new Uint8Array(32), replicationKey: new Uint8Array(32) };

	beforeAll(async () => {
		helia = await withBitswap(
			withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
		).start();
		directory = await mkdtemp(join(tmpdir(), 'belege-books-identity-spec-'));
		keys.encryptionKey = await deriveDatabaseKey(prfOutput);
		keys.replicationKey = await deriveReplicationKey(prfOutput);

		// The books as a passkey wrote them: OrbitDB's default access controller.
		const keystore = await KeyStore({ storage: await MemoryStorage() });
		passkeyDb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities: await Identities({ ipfs: helia, keystore }),
			id: 'passkey',
			directory
		});
		passkeyDid = passkeyDb.identity.id;
		const store = await openStore({ orbitdb: passkeyDb, ...keys, prfOutput });
		const x = await store.transactions.put({
			bookedOn: '2026-09-01',
			counterparty: MARKER,
			amountCents: -1234
		});
		await store.transactions.put({ ...x, amountCents: -1200 });
		const y = await store.transactions.put({
			bookedOn: '2026-09-02',
			counterparty: 'Stromwerk Test AG',
			amountCents: 500
		});
		await store.transactions.softDelete(y.id);
		await store.settings.put({ key: 'device:made-up', value: { label: 'Konto A' } });
		before = {
			transactions: await store.transactions.list({ includeDeleted: true }),
			settings: await store.settings.list({ includeDeleted: true }),
			addresses: Object.fromEntries(
				Object.entries(store.databases()).map(([name, db]) => [name, String(db.address)])
			)
		};
		await store.close();
		await passkeyDb.stop();

		// The books' identity, from the books' secret, as node.js makes it.
		try {
			useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
		} catch {
			// Already registered.
		}
		const books = await createSecretSigner(await deriveBooksSecret(prfOutput), {
			info: BOOKS_IDENTITY_INFO
		});
		const identities = await createBooksIdentities(helia, books);
		booksDb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities,
			identity: await identities.createIdentity({
				provider: OrbitDBWebAuthnIdentityProviderFunction({ signer: books })
			}),
			directory
		});
	}, 60_000);

	afterAll(async () => {
		sealAccessLists(null);
		await booksDb?.stop();
		await helia?.stop();
		if (directory) await rm(directory, { recursive: true, force: true });
	});

	const open = (/** @type {boolean} */ moveFromPasskey) =>
		openStore({
			orbitdb: booksDb,
			...keys,
			prfOutput,
			accessController: booksAccessController(booksDb.identity.id),
			author: passkeyDid,
			formerWriter: passkeyDid,
			moveFromPasskey
		});

	it('does not open the access list unsealed', async () => {
		sealAccessLists(null);
		await expect(open(false)).rejects.toThrow(/not open/);
	});

	it('moves every version to databases rooted at the books, records and authors unchanged', async () => {
		sealAccessLists(await sealedEncryption(keys.encryptionKey, keys.replicationKey));
		const store = await open(true);
		try {
			expect(store.movedFromPasskey.transactions).toEqual({ total: 4, moved: 4 });
			expect(store.movedFromPasskey.settings).toEqual({ total: 1, moved: 1 });
			expect(await store.transactions.list({ includeDeleted: true })).toEqual(before.transactions);
			expect(await store.settings.list({ includeDeleted: true })).toEqual(before.settings);
			const db = store.databases().transactions;
			expect(await count(db.log)).toBe(4);
			// Other databases: the access controller is part of the address.
			expect(String(db.address)).not.toBe(before.addresses.transactions);
			expect(db.access.type).toBe('orbitdb');
			expect([...(await db.access.get('admin'))]).toEqual([booksDb.identity.id]);
			// Every entry is the books' now.
			for await (const entry of db.log.iterator()) {
				expect(entry.identity).toBe(booksDb.identity.hash);
			}
			// The books write; a record says the passkey wrote it.
			const z = await store.transactions.put({
				bookedOn: '2026-09-03',
				counterparty: 'Papierladen Test GmbH',
				amountCents: -999
			});
			expect(z.author).toBe(passkeyDid);
		} finally {
			await store.close();
		}
	});

	it('a second move adds nothing; what was written since stays', async () => {
		const store = await open(true);
		try {
			expect(store.movedFromPasskey.transactions).toEqual({ total: 4, moved: 0 });
			expect(await store.transactions.list({ includeDeleted: true })).toHaveLength(3);
		} finally {
			await store.close();
		}
	});

	it('another identity does not write to the books', async () => {
		const store = await open(false);
		const address = String(store.databases().transactions.address);
		await store.close();
		const keystore = await KeyStore({ storage: await MemoryStorage() });
		const stranger = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities: await Identities({ ipfs: helia, keystore }),
			id: 'stranger',
			directory: `${directory}-stranger`
		});
		try {
			const db = await stranger.open(address, {
				encryption: await sealedEncryption(keys.encryptionKey, keys.replicationKey)
			});
			await expect(db.put({ _id: 'x', id: 'x' })).rejects.toThrow(/not allowed/i);
			await db.close();
		} finally {
			await stranger.stop();
			await rm(`${directory}-stranger`, { recursive: true, force: true });
		}
	});
});

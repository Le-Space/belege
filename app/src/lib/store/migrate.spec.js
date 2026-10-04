// Moving the books into the sealed databases (store/migrate.js), against a
// real OrbitDB and Helia in Node: every version moves with its clock, a
// second move adds nothing, a later move from an older state cannot undo an
// edit made after the move, and a backup of the old books comes back and
// moves in. Made-up data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { Entry, Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOfflineLibp2p } from '../network.js';
import { deriveBackupKey, deriveDatabaseKey, deriveReplicationKey } from '../database-keys.js';
import { sealedEncryption } from '../entry-encryption.js';
import {
	COLLECTIONS,
	createCollection,
	oldBooksNames,
	oldBooksOpenOptions,
	openStore
} from './repository.js';
import { moveLog } from './migrate.js';
import SealedDocuments from './sealed-documents.js';
import { buildBackup, restoreBackup } from '../backup/archive.js';

const MARKER = 'Wolkenfabrik-Umzug-3f8a';
const prfOutput = crypto.getRandomValues(new Uint8Array(32));

/** @param {any} keystore */
async function node(keystore) {
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const directory = await mkdtemp(join(tmpdir(), 'belege-migrate-spec-'));
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		// @ts-expect-error `identities` is a documented option the bundled types omit
		identities: await Identities({ ipfs: helia, keystore }),
		id: 'migrate-spec',
		directory
	});
	const keys = {
		encryptionKey: await deriveDatabaseKey(prfOutput),
		replicationKey: await deriveReplicationKey(prfOutput)
	};
	return {
		helia,
		orbitdb,
		...keys,
		/** The books before the replication layer, as the app opened them. */
		async openOld() {
			const names = await oldBooksNames(prfOutput);
			const options = await oldBooksOpenOptions(keys.encryptionKey);
			/** @type {Record<string, any>} */
			const dbs = {};
			for (const name of COLLECTIONS) dbs[name] = await orbitdb.open(names[name], options);
			return dbs;
		},
		/** @param {boolean} move */
		open: (move) => openStore({ orbitdb, ...keys, prfOutput, move }),
		async stop() {
			await orbitdb.stop();
			await helia.stop();
			await rm(directory, { recursive: true, force: true });
		}
	};
}

/** @param {any} log */
async function count(log) {
	let n = 0;
	for await (const entry of log.iterator()) if (entry) n += 1;
	return n;
}

describe('moving the books into the sealed databases', () => {
	/** @type {any} */ let keystore;
	/** @type {Awaited<ReturnType<typeof node>>} */ let a;
	/** @type {Record<string, any>} */ let before;

	beforeAll(async () => {
		keystore = await KeyStore({ storage: await MemoryStorage() });
		a = await node(keystore);
		const old = await a.openOld();
		const author = a.orbitdb.identity.id;
		const tx = createCollection(old.transactions, 'transactions', { author });
		const x = await tx.put({ bookedOn: '2026-09-01', counterparty: MARKER, amountCents: -1234 });
		const y = await tx.put({
			bookedOn: '2026-09-02',
			counterparty: 'Stromwerk Test AG',
			amountCents: 500
		});
		await tx.put({ ...x, amountCents: -1200 });
		await tx.softDelete(y.id);
		const settings = createCollection(old.settings, 'settings', { author });
		await settings.put({ key: 'device:made-up', value: { label: 'Konto A' } });
		before = {
			transactions: await tx.list({ includeDeleted: true }),
			settings: await settings.list({ includeDeleted: true })
		};
		for (const db of Object.values(old)) await db.close();
	}, 60_000);

	afterAll(async () => {
		await a?.stop();
	});

	it('moves every version with its record unchanged, and the new log is sealed', async () => {
		const store = await a.open(true);
		try {
			expect(store.moved.transactions).toEqual({ total: 4, moved: 4 });
			expect(store.moved.settings).toEqual({ total: 1, moved: 1 });
			expect(await store.transactions.list({ includeDeleted: true })).toEqual(before.transactions);
			expect(await store.settings.list({ includeDeleted: true })).toEqual(before.settings);
			const db = store.databases().transactions;
			expect(await count(db.log)).toBe(4);

			// A database name says nothing; an entry decodes only with the replication key.
			expect(String(db.address)).not.toMatch(/transactions/);
			const [head] = await db.log.heads();
			const bytes = await db.log.storage.get(head.hash);
			expect(new TextDecoder('utf-8', { fatal: false }).decode(bytes)).not.toContain(MARKER);
			const withoutReplicationKey = await sealedEncryption(
				a.encryptionKey,
				crypto.getRandomValues(new Uint8Array(32))
			);
			await expect(
				Entry.decode(
					bytes,
					withoutReplicationKey.replication.decrypt,
					withoutReplicationKey.data.decrypt
				)
			).rejects.toThrow();
		} finally {
			await store.close();
		}
	}, 60_000);

	it('adds nothing when it moves again', async () => {
		const store = await a.open(true);
		try {
			expect(store.moved.transactions).toEqual({ total: 4, moved: 0 });
			expect(await count(store.databases().transactions.log)).toBe(4);
		} finally {
			await store.close();
		}
	}, 60_000);

	it('lets no later move from an older state undo an edit made after the move', async () => {
		const store = await a.open(false);
		try {
			const [x] = (await store.transactions.list()).filter((t) => t.counterparty === MARKER);
			await store.transactions.put({ ...x, amountCents: -999 });

			// Another device's old books, with an edit it made offline before it
			// moved: an early clock, as every entry of the old books has.
			const stale = await a.orbitdb.open(
				'another-device-old-books',
				await oldBooksOpenOptions(a.encryptionKey)
			);
			await stale.put({ ...x, amountCents: -1 });
			const result = await moveLog({
				from: stale,
				to: store.databases().transactions,
				identity: a.orbitdb.identity
			});
			await stale.close();
			expect(result.moved).toBe(1);

			expect((await store.transactions.get(x.id))?.amountCents).toBe(-999);
		} finally {
			await store.close();
		}
	}, 60_000);

	it('puts a backup of the old books back into them, and they move in', async () => {
		// The backup, made by a device before the replication layer.
		const backupKey = await deriveBackupKey(prfOutput);
		const old = await a.openOld();
		const backup = await buildBackup({
			databases: old,
			blockstore: a.helia.blockstore,
			receipts: createCollection(old.receipts, 'receipts', { author: a.orbitdb.identity.id }),
			key: backupKey,
			appVersion: 'test'
		});
		for (const db of Object.values(old)) await db.close();

		// An empty browser of the same passkey, already on the sealed databases.
		const b = await node(keystore);
		try {
			const empty = await b.open(true);
			const sealedAddresses = Object.fromEntries(
				Object.entries(empty.databases()).map(([n, db]) => [n, String(db.address)])
			);
			await empty.close();
			const oldOptions = await oldBooksOpenOptions(b.encryptionKey);
			/** @type {Record<string, string>} */
			const oldAddresses = {};
			for (const [n, dbName] of Object.entries(await oldBooksNames(prfOutput))) {
				const db = await b.orbitdb.open(dbName, oldOptions);
				oldAddresses[n] = String(db.address);
				await db.close();
			}
			const result = await restoreBackup({
				orbitdb: b.orbitdb,
				sealed: backup.sealed,
				key: backupKey,
				targets: [
					{
						name: 'sealed',
						addresses: sealedAddresses,
						open: {
							type: SealedDocuments.type,
							Database: SealedDocuments({ indexBy: 'id' }),
							encryption: await sealedEncryption(b.encryptionKey, b.replicationKey)
						}
					},
					{ name: 'old', addresses: oldAddresses, open: oldOptions }
				]
			});
			expect(result.target).toBe('old');

			const store = await b.open(true);
			try {
				expect(store.moved.transactions).toEqual({ total: 4, moved: 4 });
				expect(await store.transactions.list({ includeDeleted: true })).toEqual(
					before.transactions
				);
			} finally {
				await store.close();
			}
		} finally {
			await b.stop();
		}
	}, 90_000);
});

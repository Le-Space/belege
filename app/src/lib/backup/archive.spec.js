// A backup against a real OrbitDB and Helia, in Node, in memory: what goes in,
// that nothing of it is readable without the backup key, and that it brings the
// books back – into a second, empty Helia, under the same writer, through the
// storage bridge's restoreFromBlocks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOfflineLibp2p } from '../network.js';
import { sealedEncryption } from '../entry-encryption.js';
import SealedDocuments from '../store/sealed-documents.js';
import {
	deriveBackupKey,
	deriveBlobKey,
	deriveDatabaseKey,
	deriveReplicationKey
} from '../database-keys.js';
import { openStore, COLLECTIONS } from '../store/repository.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { MAGIC, WrongPasskeyError, buildBackup, openBackup, restoreBackup } from './archive.js';

const MARKER = 'Backupmarker-Kieselweg-4e1b';
const prfOutput = crypto.getRandomValues(new Uint8Array(32));
const memory = async () => ({
	headsStorage: await MemoryStorage(),
	indexStorage: await MemoryStorage()
});

/**
 * A node with the books, as the app opens them; `keystore` shared, so the
 * writer is the same. With `restore`, the backup goes in first – through the
 * storage bridge's `restoreFromBlocks`, before the store opens the databases –
 * and the logs keep their heads where the app keeps them (on disk, here a
 * temporary directory), not in memory.
 *
 * @param {any} keystore
 * @param {{ blocks: Map<string, { bytes: Uint8Array }>, metadata: any }} [restore]
 */
async function node(keystore, restore) {
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const identities = await Identities({ ipfs: helia, keystore });
	const directory = restore ? await mkdtemp(join(tmpdir(), 'belege-backup-spec-')) : undefined;
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		// @ts-expect-error `identities` is a documented option the bundled types omit
		identities,
		id: 'backup-spec',
		...(directory ? { directory } : {})
	});
	const encryptionKey = await deriveDatabaseKey(prfOutput);
	const replicationKey = await deriveReplicationKey(prfOutput);
	if (restore) {
		const { restoreFromBlocks } = await import('@le-space/orbitdb-storage-bridge/restore-cid');
		await restoreFromBlocks(orbitdb, restore.blocks, restore.metadata, {
			open: {
				type: SealedDocuments.type,
				Database: SealedDocuments({ indexBy: 'id' }),
				encryption: await sealedEncryption(encryptionKey, replicationKey)
			}
		});
	}
	const store = await openStore({
		orbitdb,
		encryptionKey,
		replicationKey,
		prfOutput,
		...(restore ? {} : { openOptions: memory })
	});
	const blobs = await createBlobStore({
		blockstore: helia.blockstore,
		key: await deriveBlobKey(prfOutput)
	});
	return {
		helia,
		orbitdb,
		store,
		blobs,
		async stop() {
			await store.close();
			await orbitdb.stop();
			await helia.stop();
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	};
}

/** @type {any} */ let keystore;
/** @type {Awaited<ReturnType<typeof node>>} */ let a;
/** @type {Uint8Array} */ let file;
/** @type {Awaited<ReturnType<typeof buildBackup>>} */ let backup;
/** @type {Uint8Array} */ let backupKey;

beforeAll(async () => {
	keystore = await KeyStore({ storage: await MemoryStorage() });
	a = await node(keystore);
	backupKey = await deriveBackupKey(prfOutput);
	await a.store.transactions.put({
		bookedOn: '2026-08-22',
		counterparty: MARKER,
		purpose: 'Abschlag August',
		amountCents: -5259
	});
	const changed = await a.store.partners.put({ name: 'Wolkenfabrik GmbH' });
	await a.store.partners.put({ ...changed, name: 'Wolkenfabrik AG' });
	// A receipt file over two chunks, and its record.
	file = new Uint8Array(1024 * 1024 + 5000).fill(0x41);
	file.set(new TextEncoder().encode(`%PDF-1.4\n${MARKER}\n`), 0);
	await a.store.receipts.put({ fileName: 'beleg.pdf', fileCid: await a.blobs.put(file) });

	backup = await buildBackup({
		databases: a.store.databases(),
		blockstore: a.helia.blockstore,
		receipts: a.store.receipts,
		key: backupKey,
		appVersion: '0.0.0-test',
		now: () => new Date('2026-10-02T08:00:00Z')
	});
}, 60_000);

afterAll(async () => {
	await a?.stop();
});

describe('backup archive (real OrbitDB + Helia)', () => {
	it('lists all eight databases, their heads and the receipt file, and misses nothing', () => {
		const { manifest } = backup;
		expect(manifest.kind).toBe('belege-backup');
		expect(manifest.createdAt).toBe('2026-10-02T08:00:00.000Z');
		const dbs = manifest.metadata.databases;
		expect(manifest.metadata.databaseCount).toBe(8);
		expect(dbs.map((/** @type {any} */ d) => d.collection).sort()).toEqual([...COLLECTIONS].sort());
		const partners = dbs.find((/** @type {any} */ d) => d.collection === 'partners');
		expect(partners?.entryCount).toBe(2);
		expect(partners?.heads).toHaveLength(1);
		expect(manifest.files).toHaveLength(1);
		expect(manifest.fileBlocks).toBe(3); // the root and two chunks
		expect(manifest.missing).toBe(0);
	});

	it('reports each database, the receipt files and the sealing as it goes', async () => {
		/** @type {any[]} */
		const seen = [];
		await buildBackup({
			databases: a.store.databases(),
			blockstore: a.helia.blockstore,
			receipts: a.store.receipts,
			key: backupKey,
			appVersion: '0.0.0-test',
			onProgress: (p) => seen.push(p)
		});
		const databases = seen.filter((p) => p.stage === 'database');
		expect(databases.map((p) => p.name)).toEqual([...COLLECTIONS]);
		expect(databases.find((p) => p.name === 'partners')?.entries).toBe(2);
		expect(seen.filter((p) => p.stage === 'files').map((p) => p.done)).toEqual([0, 1]);
		expect(seen.at(-1)).toMatchObject({ stage: 'sealing' });
	});

	it('is one opaque file: the magic, then nothing readable', () => {
		const { sealed } = backup;
		expect([...sealed.subarray(0, MAGIC.length)]).toEqual([...MAGIC]);
		const text = new TextDecoder('latin1').decode(sealed);
		expect(text).not.toContain(MARKER);
		expect(text).not.toContain('Wolkenfabrik');
		expect(text).not.toContain('belege-backup');
		expect(text).not.toContain('%PDF');
	});

	it('opens only with the backup key, every block checked against its CID', async () => {
		const opened = await openBackup(backup.sealed, backupKey);
		expect(opened.manifest).toEqual(backup.manifest);
		expect(opened.blocks.size).toBe(backup.blocks);
		await expect(
			openBackup(backup.sealed, await deriveBackupKey(new Uint8Array(32).fill(7)))
		).rejects.toThrow();
		const changed = backup.sealed.slice();
		changed[changed.length - 1] ^= 1;
		await expect(openBackup(changed, backupKey)).rejects.toThrow();
		await expect(openBackup(new Uint8Array(40), backupKey)).rejects.toThrow(/Not a belege backup/);
	});

	it('brings the books and the file back into an empty node, under the same writer', async () => {
		const { manifest, blocks } = await openBackup(backup.sealed, backupKey);
		const b = await node(keystore, { blocks, metadata: manifest.metadata });
		try {
			const dbs = b.store.databases();
			for (const d of manifest.metadata.databases) {
				expect(String(dbs[d.collection].address)).toBe(d.address);
			}
			const [tx] = await b.store.transactions.list();
			expect(tx.counterparty).toBe(MARKER);
			expect(tx.amountCents).toBe(-5259);
			expect((await b.store.partners.list()).map((p) => p.name)).toEqual(['Wolkenfabrik AG']);
			const [receipt] = await b.store.receipts.list();
			expect(await b.blobs.get(receipt.fileCid)).toEqual(file);
			expect(tx.author).toBe(a.orbitdb.identity.id);
			// And the books go on: a new entry under the same writer.
			await b.store.transactions.put({
				bookedOn: '2026-10-02',
				counterparty: 'Neu',
				amountCents: 1
			});
			expect(await b.store.transactions.list()).toHaveLength(2);
		} finally {
			await b.stop();
		}
	}, 60_000);

	/** A node whose books are on disk, as in the app, with the store's open options. */
	async function diskNode() {
		const helia = await withBitswap(
			withLibp2p(createHeliaLight({ codecs: [dagCbor] }), await createOfflineLibp2p())
		).start();
		const identities = await Identities({ ipfs: helia, keystore });
		const directory = await mkdtemp(join(tmpdir(), 'belege-backup-merge-'));
		const orbitdb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities,
			id: 'backup-spec',
			directory
		});
		const encryptionKey = await deriveDatabaseKey(prfOutput);
		const replicationKey = await deriveReplicationKey(prfOutput);
		const open = () => openStore({ orbitdb, encryptionKey, replicationKey, prfOutput });
		return {
			helia,
			orbitdb,
			open,
			options: async () => ({
				type: SealedDocuments.type,
				Database: SealedDocuments({ indexBy: 'id' }),
				encryption: await sealedEncryption(encryptionKey, replicationKey)
			}),
			async stop() {
				await orbitdb.stop();
				await helia.stop();
				await rm(directory, { recursive: true, force: true });
			}
		};
	}

	/** @param {Awaited<ReturnType<typeof openStore>>} store */
	const addressesOf = (store) =>
		Object.fromEntries(
			Object.entries(store.databases()).map(([name, db]) => [name, String(db.address)])
		);

	it('restoreBackup merges into books that are already there: nothing is lost', async () => {
		const b = await diskNode();
		try {
			const before = await b.open();
			await before.transactions.put({
				bookedOn: '2026-10-01',
				counterparty: 'Schon hier',
				amountCents: 7
			});
			const addresses = addressesOf(before);
			await before.close();

			/** @type {any[]} */
			const seen = [];
			const result = await restoreBackup({
				orbitdb: b.orbitdb,
				sealed: backup.sealed,
				key: backupKey,
				targets: [{ name: 'sealed', addresses, open: await b.options() }],
				onProgress: (p) => seen.push(p)
			});
			expect(result.target).toBe('sealed');
			expect(result.databases.find((d) => d.collection === 'partners')?.joined).toBe(1);
			expect(seen[0]).toEqual({ stage: 'opening' });
			expect(seen.filter((p) => p.stage === 'database').map((p) => p.name)).toEqual([
				...COLLECTIONS
			]);

			const after = await b.open();
			const names = (await after.transactions.list()).map((t) => t.counterparty).sort();
			expect(names).toEqual([MARKER, 'Schon hier'].sort());
			await after.close();
		} finally {
			await b.stop();
		}
	}, 60_000);

	it('restoreBackup refuses another passkey’s backup, and books it does not belong to', async () => {
		const b = await diskNode();
		try {
			const store = await b.open();
			const addresses = addressesOf(store);
			await store.close();
			const other = await deriveBackupKey(new Uint8Array(32).fill(3));
			await expect(
				restoreBackup({
					orbitdb: b.orbitdb,
					sealed: backup.sealed,
					key: other,
					targets: [{ name: 'sealed', addresses, open: await b.options() }]
				})
			).rejects.toBeInstanceOf(WrongPasskeyError);
			const elsewhere = Object.fromEntries(
				Object.keys(addresses).map((k) => [k, `/orbitdb/zdpuElsewhere${k}`])
			);
			await expect(
				restoreBackup({
					orbitdb: b.orbitdb,
					sealed: backup.sealed,
					key: backupKey,
					targets: [{ name: 'sealed', addresses: elsewhere, open: await b.options() }]
				})
			).rejects.toThrow(/do not have/);
		} finally {
			await b.stop();
		}
	}, 60_000);
});

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
import {
	ChainGapError,
	IncrementWithoutBaseError,
	MAGIC,
	WrongPasskeyError,
	buildBackup,
	buildIncrement,
	openBackup,
	restoreBackup
} from './archive.js';
import { chainAfter, chainFromBase } from './chain.js';
import { setSetting } from '../store/settings.js';

const MARKER = 'Backupmarker-Kieselweg-4e1b';
/** A made-up mail as received. */
const EML = new TextEncoder().encode('Subject: Quittung\r\n\r\nSumme: 23,80 EUR\r\n');
/** A made-up e-invoice XML. */
const XML = new TextEncoder().encode('<rsm:CrossIndustryInvoice/>');
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
	// A mail receipt without an attachment, kept as received (#288).
	await a.store.receipts.put({ source: 'mail', fileCid: null, emlCid: await a.blobs.put(EML) });
	// A ZUGFeRD invoice's embedded XML, kept beside its PDF (#160).
	await a.store.receipts.put({ source: 'upload', fileCid: null, xmlCid: await a.blobs.put(XML) });

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
	it('lists every database, their heads and the receipt file, and misses nothing', () => {
		const { manifest } = backup;
		expect(manifest.kind).toBe('belege-backup');
		expect(manifest.createdAt).toBe('2026-10-02T08:00:00.000Z');
		const dbs = manifest.metadata.databases;
		expect(manifest.metadata.databaseCount).toBe(COLLECTIONS.length);
		expect(dbs.map((/** @type {any} */ d) => d.collection).sort()).toEqual([...COLLECTIONS].sort());
		const partners = dbs.find((/** @type {any} */ d) => d.collection === 'partners');
		expect(partners?.entryCount).toBe(2);
		expect(partners?.heads).toHaveLength(1);
		expect(manifest.files).toHaveLength(3);
		expect(manifest.fileBlocks).toBe(7); // the PDF's root and two chunks, the mail's and the XML's root and one each
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
		expect(seen.filter((p) => p.stage === 'files').map((p) => p.done)).toEqual([0, 1, 2, 3]);
		expect(seen.at(-1)).toMatchObject({ stage: 'sealing' });
	});

	it('is one opaque file: the magic, then nothing readable', () => {
		const { sealed } = backup;
		expect([...sealed.subarray(0, MAGIC.length)]).toEqual([...MAGIC]);
		const text = new TextDecoder('latin1').decode(sealed);
		expect(text).not.toContain(MARKER);
		expect(text).not.toContain('Wolkenfabrik');
		expect(text).not.toContain('belege-backup');
		// The whole PDF header, not just '%PDF': four given bytes turn up by
		// chance about once in 4,000 runs of a megabyte of ciphertext.
		expect(text).not.toContain('%PDF-1.4\n');
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
			const restored = await b.store.receipts.list();
			const receipt = /** @type {any} */ (restored.find((r) => r.fileCid));
			// Compared natively: toEqual walks the 1 MiB file byte by byte.
			const back = await b.blobs.get(receipt.fileCid);
			expect(back.length).toBe(file.length);
			expect(Buffer.compare(back, file)).toBe(0);
			const mail = /** @type {any} */ (restored.find((r) => r.emlCid));
			expect(await b.blobs.get(mail.emlCid)).toEqual(EML);
			const xml = /** @type {any} */ (restored.find((r) => r.xmlCid));
			expect(await b.blobs.get(xml.xmlCid)).toEqual(XML);
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
			let closes = 0;
			const result = await restoreBackup({
				orbitdb: b.orbitdb,
				sealed: backup.sealed,
				key: backupKey,
				targets: [{ name: 'sealed', addresses, open: await b.options() }],
				onProgress: (p) => seen.push(p),
				beforeRestore: async () => {
					closes++;
				}
			});
			// Once, when the backup opened and fitted: where the caller closes its books.
			expect(closes).toBe(1);
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
			// Refused before the books would be closed: they stay open.
			let closes = 0;
			const beforeRestore = async () => {
				closes++;
			};
			await expect(
				restoreBackup({
					orbitdb: b.orbitdb,
					sealed: backup.sealed,
					key: other,
					targets: [{ name: 'sealed', addresses, open: await b.options() }],
					beforeRestore
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
					targets: [{ name: 'sealed', addresses: elsewhere, open: await b.options() }],
					beforeRestore
				})
			).rejects.toThrow(/do not have/);
			expect(closes).toBe(0);
		} finally {
			await b.stop();
		}
	}, 60_000);

	describe('increments (#454)', () => {
		const BASE = 'bafkreibasebasebasebasebasebasebasebasebasebasebasebaseb';
		/** @param {import('./archive.js').BackupChain} chain */
		const increment = (chain) =>
			buildIncrement({
				databases: a.store.databases(),
				blockstore: a.helia.blockstore,
				receipts: a.store.receipts,
				key: backupKey,
				chain,
				appVersion: '0.0.0-test',
				now: () => new Date('2026-10-23T08:00:00Z')
			});

		it('nothing new since the full backup: no increment', async () => {
			expect(await increment(chainFromBase(backup.manifest, BASE))).toBeNull();
		}, 60_000);

		it('holds only what is new, and the base with its increments brings all of it back', async () => {
			const chain = chainFromBase(backup.manifest, BASE);
			await a.store.transactions.put({
				bookedOn: '2026-10-22',
				counterparty: 'Zuwachs-Probe-Lindenhof',
				amountCents: -1999
			});
			const second = new Uint8Array(4096).fill(0x42);
			await a.store.receipts.put({ fileName: 'zweiter.pdf', fileCid: await a.blobs.put(second) });
			const one = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
				await increment(chain)
			);
			expect(one).not.toBeNull();
			expect(one.manifest).toMatchObject({ kind: 'increment', sequence: 1, base: BASE });
			// One new payment and one new receipt: two entries, one new file.
			expect(one.entries).toBe(2);
			expect(one.files).toHaveLength(1);
			expect(one.databases.map((d) => d.collection).sort()).toEqual(['receipts', 'transactions']);
			// Far smaller than the full backup, and as opaque.
			expect(one.sealed.length).toBeLessThan(backup.sealed.length / 10);
			expect(one.sealed.subarray(0, MAGIC.length)).toEqual(MAGIC);
			expect(new TextDecoder('latin1').decode(one.sealed)).not.toContain('Zuwachs-Probe');

			// A second one after it: only what came since. Settings alone – every
			// backup writes its history there – make none.
			const after = chainAfter(
				chain,
				one,
				'bafkreioneoneoneoneoneoneoneoneoneoneoneoneoneoneoneoneon'
			);
			expect(await increment(after)).toBeNull();
			await setSetting(a.store.settings, 'backups', []);
			expect(await increment(after)).toBeNull();
			await a.store.partners.put({ name: 'Zuwachs Zwei GmbH' });
			const two = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
				await increment(after)
			);
			expect(two.manifest).toMatchObject({ sequence: 2, previous: after.previous });
			// The partner, and the setting that waited for it.
			expect(two.entries).toBe(2);
			expect(two.files).toHaveLength(0);

			// Into empty books: the base, then both increments, in any order.
			const b = await diskNode();
			try {
				const empty = await b.open();
				const addresses = addressesOf(empty);
				await empty.close();
				const restore = async (/** @type {Uint8Array[]} */ increments) =>
					restoreBackup({
						orbitdb: b.orbitdb,
						sealed: backup.sealed,
						increments,
						base: BASE,
						key: backupKey,
						targets: [{ name: 'sealed', addresses, open: await b.options() }]
					});
				// Without the first increment, the chain has a hole: refused.
				await expect(restore([two.sealed])).rejects.toBeInstanceOf(ChainGapError);
				// An increment alone is not a backup to restore.
				await expect(
					restoreBackup({
						orbitdb: b.orbitdb,
						sealed: one.sealed,
						key: backupKey,
						targets: [{ name: 'sealed', addresses, open: await b.options() }]
					})
				).rejects.toBeInstanceOf(IncrementWithoutBaseError);

				const result = await restoreBackup({
					orbitdb: b.orbitdb,
					sealed: backup.sealed,
					increments: [two.sealed, one.sealed],
					base: BASE,
					key: backupKey,
					targets: [{ name: 'sealed', addresses, open: await b.options() }]
				});
				expect(result.increments).toBe(2);
				const books = await b.open();
				const names = (await books.transactions.list()).map((t) => t.counterparty).sort();
				expect(names).toEqual([MARKER, 'Zuwachs-Probe-Lindenhof'].sort());
				expect((await books.partners.list()).map((p) => p.name).sort()).toEqual(
					['Wolkenfabrik AG', 'Zuwachs Zwei GmbH'].sort()
				);
				const blobs = await createBlobStore({
					blockstore: b.helia.blockstore,
					key: await deriveBlobKey(prfOutput)
				});
				const receipt = /** @type {any} */ (
					(await books.receipts.list()).find((r) => r.fileName === 'zweiter.pdf')
				);
				expect(await blobs.get(receipt.fileCid)).toEqual(second);
				await books.close();
			} finally {
				await b.stop();
			}
		}, 120_000);
	});
});

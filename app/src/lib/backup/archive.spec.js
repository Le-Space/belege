// A backup against a real OrbitDB and Helia, in Node, in memory: what goes in,
// that nothing of it is readable without the backup key, and that it brings the
// books back – into a second, empty Helia, under the same writer, through the
// storage bridge's restoreFromBlocks. And as a restore takes it (#512): the
// sealed file in pieces, as a gateway sends it, opened frame by frame and
// stored block by block – with what is refused, and when, counted at the
// blockstore; and the backup of before, sealed in one piece, still restoring.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import {
	IPFSAccessController,
	Identities,
	KeyStore,
	MemoryStorage,
	createOrbitDB
} from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
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
	MAGIC_FRAMED,
	WrongPasskeyError,
	buildBackup,
	buildIncrement,
	openBackup,
	readEarlierBackup,
	restoreBackup,
	writerOf
} from './archive.js';
import { chainAfter, chainFromBase } from './chain.js';
import { setSetting } from '../store/settings.js';
import { sealer } from '../db-encryption.js';

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
		identities,
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
	// A receipt file over four chunks, and its record: with it the backup is
	// several frames long, as a restore that opens it in pieces needs (#512).
	file = new Uint8Array(3 * 1024 * 1024 + 5000).fill(0x41);
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
		expect(manifest.fileBlocks).toBe(9); // the PDF's root and four chunks, the mail's and the XML's root and one each
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
		expect([...sealed.subarray(0, MAGIC_FRAMED.length)]).toEqual([...MAGIC_FRAMED]);
		expect(new TextDecoder().decode(MAGIC_FRAMED)).toBe('belegeB2');
		// Behind it the storage bridge's envelope in frames: OSBE, version 2,
		// frames of a megabyte.
		expect(new TextDecoder().decode(sealed.subarray(8, 12))).toBe('OSBE');
		expect(sealed[12]).toBe(2);
		expect(new DataView(sealed.buffer, sealed.byteOffset).getUint32(13)).toBe(1024 * 1024);
		// The receipt file alone is more than a frame: this backup has several.
		expect(sealed.length).toBeGreaterThan(2 * 1024 * 1024);
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
			// Compared natively: toEqual walks the file byte by byte.
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

	it('restoreBackup reads the writer from the backup when another passkey wrote it (#555)', async () => {
		const b = await diskNode();
		try {
			const { manifest } = await openBackup(backup.sealed, backupKey);
			const named = manifest.metadata.databases.filter(
				(/** @type {any} */ d) => !String(d.collection).startsWith('_')
			);
			/** @type {Record<string, string>} */
			const names = Object.fromEntries(
				named.map((/** @type {any} */ d) => [d.collection, String(d.name)])
			);
			// As this passkey would open them: another DID, so other addresses.
			const elsewhere = Object.fromEntries(
				Object.keys(names).map((k) => [k, `/orbitdb/zdpuElsewhere${k}`])
			);
			/** @type {string[]} */
			const asked = [];
			/** @param {string} writer */
			const forWriter = async (writer) => {
				const open = {
					...(await b.options()),
					AccessController: IPFSAccessController({ write: [writer] })
				};
				/** @type {Record<string, string>} */
				const addresses = {};
				for (const [collection, name] of Object.entries(names)) {
					const db = await b.orbitdb.open(name, open);
					addresses[collection] = String(db.address);
					await db.close();
				}
				return { open, addresses };
			};
			const target = {
				name: 'passkey',
				addresses: elsewhere,
				open: await b.options(),
				names
			};
			// A resolver that names other addresses than the backup's: refused.
			await expect(
				restoreBackup({
					orbitdb: b.orbitdb,
					sealed: backup.sealed,
					key: backupKey,
					targets: [
						{
							...target,
							resolve: async (writer) => {
								asked.push(writer);
								return forWriter('did:key:zOtherWriter');
							}
						}
					]
				})
			).rejects.toThrow(/do not have/);
			expect(asked).toEqual([a.orbitdb.identity.id]);

			const result = await restoreBackup({
				orbitdb: b.orbitdb,
				sealed: backup.sealed,
				key: backupKey,
				targets: [{ ...target, resolve: forWriter }]
			});
			expect(result.target).toBe('passkey');
			expect(result.writer).toBe(a.orbitdb.identity.id);
			const store = await b.open();
			expect((await store.transactions.list()).map((t) => t.counterparty)).toContain(MARKER);
			await store.close();
		} finally {
			await b.stop();
		}
	}, 60_000);

	it('writerOf reads the one writer a database’s access controller names, else null', async () => {
		const [d] = backup.manifest.metadata.databases;
		const read = async (/** @type {CID} */ cid) => {
			try {
				/** @type {any} */
				const got = await a.helia.blockstore.get(cid, { offline: true });
				if (got instanceof Uint8Array) return got;
				/** @type {Uint8Array[]} */
				const parts = [];
				for await (const part of got) parts.push(part);
				return Uint8Array.from(parts.flatMap((p) => [...p]));
			} catch {
				return undefined;
			}
		};
		expect(await writerOf(String(d.address), read)).toBe(a.orbitdb.identity.id);
		expect(await writerOf('/orbitdb/zdpuNotACid', read)).toBeNull();
		expect(await writerOf(String(d.address), async () => undefined)).toBeNull();
	});

	/** The sealed file as a gateway sends it: in pieces, never whole. */
	async function* pieces(/** @type {Uint8Array} */ bytes, size = 64 * 1024) {
		for (let at = 0; at < bytes.length; at += size)
			yield bytes.subarray(at, Math.min(bytes.length, at + size));
	}

	/**
	 * The same backup as it was sealed before #512: in one piece,
	 * "belegeB1" ‖ nonce ‖ AES-GCM(CAR).
	 *
	 * @param {Uint8Array} sealed a backup in frames
	 */
	async function inOnePiece(sealed) {
		const { blocks } = await openBackup(sealed, backupKey);
		const { createCARFromBlocks } = await import('@le-space/orbitdb-storage-bridge/backup-car');
		const [root] = blocks.keys();
		const car = await createCARFromBlocks(blocks, root);
		const body = await (await sealer(backupKey)).seal(car);
		const out = new Uint8Array(MAGIC.length + body.length);
		out.set(MAGIC, 0);
		out.set(body, MAGIC.length);
		return out;
	}

	/** An OrbitDB whose blockstore counts what it is given. @param {any} orbitdb */
	function counting(orbitdb) {
		/** @type {string[]} */
		const puts = [];
		const blockstore = new Proxy(orbitdb.ipfs.blockstore, {
			get: (target, name) =>
				name === 'put'
					? async (/** @type {any} */ cid, /** @type {any[]} */ ...rest) => {
							puts.push(String(cid));
							return target.put(cid, ...rest);
						}
					: typeof target[name] === 'function'
						? target[name].bind(target)
						: target[name]
		});
		const watched = new Proxy(orbitdb, {
			get: (target, name) =>
				name === 'ipfs'
					? new Proxy(target.ipfs, { get: (t, n) => (n === 'blockstore' ? blockstore : t[n]) })
					: typeof target[name] === 'function'
						? target[name].bind(target)
						: target[name]
		});
		return { orbitdb: watched, puts };
	}

	describe('as it arrives (#512)', () => {
		it('carries its manifest first, so a restore knows whose it is before the rest', async () => {
			const { blocks, manifest } = await openBackup(backup.sealed, backupKey);
			const [first] = blocks.keys();
			expect(dagCbor.decode(/** @type {any} */ (blocks.get(first)).bytes)).toEqual(manifest);
		});

		it('restores from a stream: frames opened and blocks stored while it comes, the books joined after', async () => {
			const b = await diskNode();
			try {
				const store = await b.open();
				const addresses = addressesOf(store);
				await store.close();
				const { orbitdb, puts } = counting(b.orbitdb);
				/** @type {any[]} */
				const seen = [];
				let pulled = 0;
				/** How many pieces had been asked for when the first block was stored. */
				let pulledAtFirstBlock = -1;
				const source = async function* () {
					for await (const piece of pieces(backup.sealed)) {
						pulled++;
						yield piece;
					}
				};
				const total = Math.ceil(backup.sealed.length / (64 * 1024));
				const result = await restoreBackup({
					orbitdb,
					// A function: the file is asked for when the restore gets to it.
					sealed: source,
					key: backupKey,
					targets: [{ name: 'sealed', addresses, open: await b.options() }],
					onProgress: (p) => {
						if (p.stage === 'stored' && pulledAtFirstBlock < 0) pulledAtFirstBlock = pulled;
						seen.push(p);
					}
				});
				expect(result.streamed).toBe(true);
				expect(result.blocks).toBe(backup.blocks);
				expect(puts.length).toBe(backup.blocks);
				// Not fetched and then opened: the first block was in the blockstore
				// when most of the file had not been asked for yet.
				expect(pulledAtFirstBlock).toBeGreaterThan(0);
				expect(pulledAtFirstBlock).toBeLessThan(total / 2);
				expect(pulled).toBe(total);

				const stages = seen.map((p) => p.stage);
				expect(stages[0]).toBe('opening');
				expect(new Set(stages)).toEqual(
					new Set(['opening', 'opened', 'stored', 'joining', 'database'])
				);
				// Every frame and every block before the books are touched.
				const joining = stages.indexOf('joining');
				expect(stages.lastIndexOf('opened')).toBeLessThan(joining);
				expect(stages.lastIndexOf('stored')).toBeLessThan(joining);
				expect(stages.indexOf('database')).toBeGreaterThan(joining);
				const opened = seen.filter((p) => p.stage === 'opened');
				expect(opened.at(-1).frames).toBe(Math.ceil(backup.carBytes / (1024 * 1024)));
				expect(opened.at(-1).bytes).toBe(backup.carBytes);
				expect(seen.filter((p) => p.stage === 'stored').at(-1).blocks).toBe(backup.blocks);

				const after = await b.open();
				expect((await after.transactions.list()).map((t) => t.counterparty)).toEqual([MARKER]);
				expect((await after.partners.list()).map((p) => p.name)).toEqual(['Wolkenfabrik AG']);
				await after.close();
			} finally {
				await b.stop();
			}
		}, 60_000);

		it('a wrong key, or books it does not belong to: refused before a block is stored', async () => {
			const b = await diskNode();
			try {
				const store = await b.open();
				const addresses = addressesOf(store);
				await store.close();
				const { orbitdb, puts } = counting(b.orbitdb);
				let closes = 0;
				const common = {
					orbitdb,
					sealed: () => pieces(backup.sealed),
					beforeRestore: async () => {
						closes++;
					}
				};
				await expect(
					restoreBackup({
						...common,
						key: await deriveBackupKey(new Uint8Array(32).fill(3)),
						targets: [{ name: 'sealed', addresses, open: await b.options() }]
					})
				).rejects.toBeInstanceOf(WrongPasskeyError);
				const elsewhere = Object.fromEntries(
					Object.keys(addresses).map((k) => [k, `/orbitdb/zdpuElsewhere${k}`])
				);
				await expect(
					restoreBackup({
						...common,
						key: backupKey,
						targets: [{ name: 'sealed', addresses: elsewhere, open: await b.options() }]
					})
				).rejects.toThrow(/do not have/);
				expect(puts).toEqual([]);
				expect(closes).toBe(0);
			} finally {
				await b.stop();
			}
		}, 60_000);

		it('a file cut short, damaged or missing a frame: refused at that frame, the books never closed', async () => {
			const b = await diskNode();
			try {
				const store = await b.open();
				await store.transactions.put({
					bookedOn: '2026-10-01',
					counterparty: 'Schon hier',
					amountCents: 7
				});
				const addresses = addressesOf(store);
				await store.close();
				const frame = 1024 * 1024 + 16;
				// "belegeB2", then the envelope's 57 bytes in front of its first frame.
				const firstFrame = MAGIC_FRAMED.length + 57;
				const damaged = backup.sealed.slice();
				damaged[firstFrame + frame + 1000] ^= 1;
				const without = new Uint8Array(backup.sealed.length - frame);
				without.set(backup.sealed.subarray(0, firstFrame), 0);
				without.set(backup.sealed.subarray(firstFrame + frame), firstFrame);
				const last = Math.ceil(backup.carBytes / (1024 * 1024)) - 1;
				expect(last).toBeGreaterThanOrEqual(3);
				const cases = [
					{ file: backup.sealed.subarray(0, backup.sealed.length - 5000), frame: last },
					{ file: damaged, frame: 1 },
					{ file: without, frame: 0 }
				];
				for (const { file, frame: index } of cases) {
					let closes = 0;
					const error = await restoreBackup({
						orbitdb: b.orbitdb,
						sealed: () => pieces(file),
						key: backupKey,
						targets: [{ name: 'sealed', addresses, open: await b.options() }],
						beforeRestore: async () => {
							closes++;
						}
					}).catch((e) => e);
					expect(error.name).toBe('FrameError');
					expect(error.reason).toBe('frame');
					expect(error.frame).toBe(index);
					expect(error.message).toContain(`Frame ${index} `);
					// Not a wrong passkey, and nothing was joined.
					expect(error).not.toBeInstanceOf(WrongPasskeyError);
					expect(closes).toBe(0);
				}
				const after = await b.open();
				expect((await after.transactions.list()).map((t) => t.counterparty)).toEqual([
					'Schon hier'
				]);
				await after.close();
			} finally {
				await b.stop();
			}
		}, 60_000);

		it('a backup sealed in one piece, as before #512, still opens and restores', async () => {
			const old = await inOnePiece(backup.sealed);
			expect(old.subarray(0, MAGIC.length)).toEqual(MAGIC);
			expect(new TextDecoder().decode(MAGIC)).toBe('belegeB1');
			const opened = await openBackup(old, backupKey);
			expect(opened.manifest).toEqual(backup.manifest);
			expect(opened.blocks.size).toBe(backup.blocks);

			const b = await diskNode();
			try {
				const store = await b.open();
				const addresses = addressesOf(store);
				await store.close();
				/** @type {string[]} */
				const stages = [];
				const result = await restoreBackup({
					orbitdb: b.orbitdb,
					sealed: () => pieces(old),
					key: backupKey,
					targets: [{ name: 'sealed', addresses, open: await b.options() }],
					onProgress: (p) => stages.push(p.stage)
				});
				// Held whole, because one tag at its end vouches for all of it.
				expect(result.streamed).toBe(false);
				expect(result.blocks).toBe(backup.blocks);
				expect(stages).not.toContain('opened');
				expect(stages).toContain('stored');
				const after = await b.open();
				expect((await after.transactions.list()).map((t) => t.counterparty)).toEqual([MARKER]);
				await after.close();

				await expect(
					restoreBackup({
						orbitdb: b.orbitdb,
						sealed: () => pieces(old),
						key: await deriveBackupKey(new Uint8Array(32).fill(3)),
						targets: [{ name: 'sealed', addresses, open: await b.options() }]
					})
				).rejects.toBeInstanceOf(WrongPasskeyError);
			} finally {
				await b.stop();
			}
		}, 60_000);
	});

	describe('increments (#454)', () => {
		const BASE = 'bafkreibasebasebasebasebasebasebasebasebasebasebasebaseb';
		/** @param {import('./archive.js').BackupChain} chain */
		const increment = (chain) =>
			buildIncrement({
				databases: a.store.databases(),
				blockstore,
				receipts: a.store.receipts,
				key: backupKey,
				chain,
				appVersion: '0.0.0-test',
				now: () => new Date('2026-10-23T08:00:00Z')
			});

		/** Blocks this device does not have yet, as one that got a receipt by sync before its file. */
		const hidden = new Set();
		const blockstore = {
			/** @param {CID} cid @param {any} [options] */
			get: (cid, options) =>
				hidden.has(cid.toV1().toString())
					? {
							[Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('not here')) })
						}
					: a.helia.blockstore.get(cid, options)
		};
		/** A block's bytes from the blockstore. @param {CID} cid */
		const blockOf = async (cid) => {
			const got = /** @type {any} */ (await a.helia.blockstore.get(cid, { offline: true }));
			if (got instanceof Uint8Array) return got;
			const parts = [];
			for await (const p of got) parts.push(p);
			return new Uint8Array(parts.flatMap((p) => [...p]));
		};

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
			expect(one.sealed.subarray(0, MAGIC_FRAMED.length)).toEqual(MAGIC_FRAMED);
			expect(new TextDecoder('latin1').decode(one.sealed)).not.toContain('Zuwachs-Probe');

			// A second one after it: only what came since. Settings alone – every
			// backup writes its history there – make none.
			const after = await chainAfter(
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

				// As a restore fetches them (#512): each file a stream, asked for only
				// when the one before is stored – and one of them sealed in one piece,
				// as an increment made before #512 is.
				/** @type {string[]} */
				const asked = [];
				/** @type {string[]} */
				const order = [];
				const oneBefore = await inOnePiece(one.sealed);
				const file = (/** @type {string} */ name, /** @type {Uint8Array} */ bytes) => () => {
					asked.push(name);
					order.push(`asked ${name}`);
					return pieces(bytes);
				};
				const result = await restoreBackup({
					orbitdb: b.orbitdb,
					sealed: file('base', backup.sealed),
					increments: [file('two', two.sealed), file('one', oneBefore)],
					base: BASE,
					key: backupKey,
					targets: [{ name: 'sealed', addresses, open: await b.options() }],
					onProgress: (p) => {
						if (p.stage === 'stored' && order.at(-1) !== 'stored') order.push('stored');
					}
				});
				expect(result.increments).toBe(2);
				expect(asked).toEqual(['base', 'two', 'one']);
				expect(order).toEqual([
					'asked base',
					'stored',
					'asked two',
					'stored',
					'asked one',
					'stored'
				]);
				// One file had to be held whole.
				expect(result.streamed).toBe(false);
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

		it('a receipt file whose blocks are not all here: not counted as shipped, and sent once they are (#558)', async () => {
			// As a device that has the receipt by sync before its file's blocks arrived.
			const bytes = new Uint8Array(1024 * 1024 + 2000).fill(0x43);
			const cid = await a.blobs.put(bytes);
			const root = /** @type {any} */ (dagCbor.decode(await blockOf(CID.parse(cid))));
			const chunk = CID.asCID(root.chunks[1]) ?? CID.parse(String(root.chunks[1]));
			hidden.add(chunk.toV1().toString());
			await a.store.receipts.put({ fileName: 'halb.pdf', fileCid: cid });
			try {
				// A full backup now carries the record, not the file, and does not name it.
				const full = await buildBackup({
					databases: a.store.databases(),
					blockstore,
					receipts: a.store.receipts,
					key: backupKey,
					appVersion: '0.0.0-test'
				});
				expect(full.manifest.files).not.toContain(cid);
				expect(full.manifest.missing).toBe(1);
				expect(chainFromBase(full.manifest, BASE).files).not.toContain(cid);

				// An increment likewise: the record goes, the file waits.
				const chain = chainFromBase(backup.manifest, BASE);
				const one = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
					await increment(chain)
				);
				expect(one.files).not.toContain(cid);
				expect(one.missing).toBe(1);
				const after = await chainAfter(
					chain,
					one,
					'bafkreihalfhalfhalfhalfhalfhalfhalfhalfhalfhalfhalfhalf'
				);
				expect(after.files).not.toContain(cid);
				// Still not all here: nothing new – no increment every few minutes for it.
				expect(await increment(after)).toBeNull();

				// The blocks arrive: the next increment carries the file.
				hidden.clear();
				const two = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
					await increment(after)
				);
				expect(two.files).toEqual([cid]);
				expect(two.missing).toBe(0);
				expect(two.entries).toBe(0);
			} finally {
				hidden.clear();
			}
		}, 120_000);

		it('a second increment in a session does not walk the logs again (#558)', async () => {
			const databases = Object.values(a.store.databases());
			let reads = 0;
			const originals = databases.map((db) => db.log.get);
			databases.forEach((db, i) => {
				db.log.get = (/** @type {any[]} */ ...args) => {
					reads++;
					return originals[i].apply(db.log, args);
				};
			});
			try {
				await a.store.transactions.put({
					bookedOn: '2026-10-24',
					counterparty: 'Lauf-Probe-Eins',
					amountCents: -100
				});
				const chain = chainFromBase(
					(
						await buildBackup({
							databases: a.store.databases(),
							blockstore: a.helia.blockstore,
							receipts: a.store.receipts,
							key: backupKey,
							appVersion: '0.0.0-test'
						})
					).manifest,
					BASE
				);
				await a.store.transactions.put({
					bookedOn: '2026-10-25',
					counterparty: 'Lauf-Probe-Zwei',
					amountCents: -200
				});
				reads = 0;
				const one = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
					await increment(chain)
				);
				// Heads this session has not shipped from: their log is walked.
				expect(reads).toBeGreaterThan(0);
				const after = await chainAfter(
					chain,
					one,
					'bafkreiwalkwalkwalkwalkwalkwalkwalkwalkwalkwalkwalkwal'
				);
				await a.store.transactions.put({
					bookedOn: '2026-10-26',
					counterparty: 'Lauf-Probe-Drei',
					amountCents: -300
				});
				reads = 0;
				const two = /** @type {NonNullable<Awaited<ReturnType<typeof increment>>>} */ (
					await increment(after)
				);
				expect(two.entries).toBe(1);
				// The next one starts from what the last one shipped: no walk.
				expect(reads).toBe(0);
				// The same chain again – the increment was not kept – is known too.
				reads = 0;
				expect((await increment(after))?.entries).toBe(1);
				expect(reads).toBe(0);
			} finally {
				databases.forEach((db, i) => (db.log.get = originals[i]));
			}
		}, 120_000);
	});
});

describe('a backup made before new keys (#628)', () => {
	it('reads its records – the newest version of each – and its files with that root’s keys', async () => {
		const earlier = await readEarlierBackup({
			sealed: backup.sealed,
			key: backupKey,
			dataKey: await deriveDatabaseKey(prfOutput),
			replicationKey: await deriveReplicationKey(prfOutput),
			blobKey: await deriveBlobKey(prfOutput)
		});
		expect(earlier.records.transactions.map((t) => t.counterparty)).toEqual([MARKER]);
		// The partner was renamed: the newer name is the one that counts.
		expect(earlier.records.partners.map((p) => p.name)).toEqual(['Wolkenfabrik AG']);
		expect(earlier.records.receipts).toHaveLength(3);
		const pdf = earlier.records.receipts.find((r) => r.fileName === 'beleg.pdf');
		// Compared natively: toEqual walks the file byte by byte.
		const back = /** @type {Uint8Array} */ (earlier.files.get(pdf?.fileCid));
		expect(back.length).toBe(file.length);
		expect(Buffer.compare(back, file)).toBe(0);
		const mail = earlier.records.receipts.find((r) => r.source === 'mail');
		expect(earlier.files.get(mail?.emlCid)).toEqual(EML);
	});

	it('passes over every entry the given check refuses – a writer not the books’', async () => {
		const { Entry } = await import('@orbitdb/core');
		const keys = {
			key: backupKey,
			dataKey: await deriveDatabaseKey(prfOutput),
			replicationKey: await deriveReplicationKey(prfOutput),
			blobKey: await deriveBlobKey(prfOutput)
		};
		const books = a.orbitdb.identity.id;
		/** @param {string} writer */
		const only = (writer) => async (/** @type {any} */ entry, /** @type {any} */ identity) =>
			identity.id === writer &&
			identity.hash === entry.identity &&
			identity.publicKey === entry.key &&
			(await a.identities.verifyIdentity(identity)) &&
			(await Entry.verify(a.identities, entry));
		const signed = await readEarlierBackup({ sealed: backup.sealed, ...keys, accept: only(books) });
		expect(signed.records.transactions.map((t) => t.counterparty)).toEqual([MARKER]);
		const none = await readEarlierBackup({
			sealed: backup.sealed,
			...keys,
			accept: only('did:key:z6MkSomebodyElse')
		});
		expect(none.records.transactions).toEqual([]);
		expect(none.files.size).toBe(0);
	});

	it('another root’s keys do not open it', async () => {
		const other = crypto.getRandomValues(new Uint8Array(32));
		await expect(
			readEarlierBackup({
				sealed: backup.sealed,
				key: await deriveBackupKey(other),
				dataKey: await deriveDatabaseKey(other),
				replicationKey: await deriveReplicationKey(other),
				blobKey: await deriveBlobKey(other)
			})
		).rejects.toBeInstanceOf(WrongPasskeyError);
	});
});

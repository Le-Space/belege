// A backup carries the books' access lists (store/books-access.js): a member's
// grant lives there, and a restore into a browser that never saw the list
// would refuse every entry the member wrote – "not allowed to write to the
// log". Against a real OrbitDB and Helia in Node; names and values made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { Entry, Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';

import { createOfflineLibp2p } from '../network.js';
import { sealedEncryption } from '../entry-encryption.js';
import { booksAccessController, sealAccessLists } from '../store/books-access.js';
import { ACCESS_LIST, buildBackup, restoreBackup } from './archive.js';

const key = crypto.getRandomValues(new Uint8Array(32));
/** @type {any} */ let encryption;
/** @type {(() => Promise<void>)[]} */ const cleanups = [];

/** A browser: Helia offline, OrbitDB on disk in a temporary directory. @param {string} id */
async function browser(id) {
	const helia = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor] }),
		await createOfflineLibp2p()
	).start();
	const keystore = await KeyStore({ storage: await MemoryStorage() });
	const identities = await Identities({ ipfs: helia, keystore });
	const directory = await mkdtemp(join(tmpdir(), `belege-access-lists-${id}-`));
	// @ts-expect-error `identities` is a documented option the bundled types omit
	const orbitdb = await createOrbitDB({ ipfs: helia, identities, id, directory });
	cleanups.push(async () => {
		await orbitdb.stop();
		await helia.stop();
		await rm(directory, { recursive: true, force: true });
	});
	return { helia, identities, orbitdb };
}

/** @type {any} */ let books;
/** @type {any} */ let db;
/** @type {string} */ let memberValue;

beforeAll(async () => {
	encryption = await sealedEncryption(
		crypto.getRandomValues(new Uint8Array(32)),
		crypto.getRandomValues(new Uint8Array(32))
	);
	sealAccessLists(encryption);
	books = await browser('books');
	db = await books.orbitdb.open('access-lists-spec', {
		type: 'keyvalue',
		AccessController: booksAccessController(books.orbitdb.identity.id)
	});
	await db.put('owner', 'Wolkenfabrik Hosting GmbH');
	// A member admitted (#611): their own write identity, granted by the books.
	const member = await books.identities.createIdentity({ id: 'member' });
	await db.access.grant('write', member.id);
	// …who writes into the books, after what the books wrote.
	memberValue = 'Stromwerk Test AG';
	const heads = (await db.log.heads()).map((/** @type {any} */ e) => e.hash);
	const created = await Entry.create(
		member,
		db.log.id,
		{ op: 'PUT', key: 'member', value: memberValue },
		null,
		null,
		heads
	);
	const encoded = await Entry.encode(created, undefined, undefined);
	// As it would arrive from the member's device: its block in the blockstore first.
	await books.helia.blockstore.put(CID.parse(encoded.hash), encoded.bytes);
	expect(await db.log.joinEntry({ ...created, ...encoded })).toBe(true);
}, 60_000);

afterAll(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
	sealAccessLists(null);
});

/** No receipt files: only the databases matter here. */
const receipts = /** @type {any} */ ({ list: async () => [] });

/** @param {Record<string, any>} databases */
const backupOf = (databases) =>
	buildBackup({
		databases,
		blockstore: books.helia.blockstore,
		receipts,
		key,
		appVersion: '0.0.0-test'
	});

/** Into a browser that never saw these books. @param {Uint8Array} sealed */
async function restoreElsewhere(sealed) {
	const fresh = await browser(`fresh-${Math.random().toString(36).slice(2, 8)}`);
	const result = await restoreBackup({
		orbitdb: fresh.orbitdb,
		sealed,
		key,
		targets: [
			{ name: 'sealed', addresses: { things: String(db.address) }, open: { type: 'keyvalue' } }
		],
		listEncryption: encryption
	});
	return { fresh, result };
}

describe('a backup with the books’ access lists', () => {
	it('carries each collection’s list, in front of the collections', async () => {
		const { manifest } = await backupOf({ things: db });
		const names = manifest.metadata.databases.map((/** @type {any} */ d) => d.collection);
		expect(names).toEqual([`${ACCESS_LIST}things`, 'things']);
	}, 60_000);

	it('restores what a member wrote into a browser that never saw the list', async () => {
		const { sealed } = await backupOf({ things: db });
		const { fresh, result } = await restoreElsewhere(sealed);
		expect(result.databases.map((d) => d.collection)).toEqual(['things']);
		const back = await fresh.orbitdb.open(String(db.address), { type: 'keyvalue' });
		const values = (await back.log.values()).map((/** @type {any} */ e) => e.payload.value);
		expect(values).toContain('Wolkenfabrik Hosting GmbH');
		expect(values).toContain(memberValue);
	}, 60_000);

	it('without the list – a backup made before – the restore does not come back', async () => {
		// The collection as an earlier build backed it up: its controller offers no list.
		const without = new Proxy(db, {
			get: (target, prop) => (prop === 'access' ? {} : target[prop])
		});
		const { sealed } = await backupOf({ things: without });
		// In a browser the list opens empty and the member's entry is refused ("not
		// allowed to write to the log"); offline here, not even the list's own
		// manifest is to be had. Either way, what the member wrote stays out.
		await expect(restoreElsewhere(sealed)).rejects.toThrow();
	}, 60_000);
});

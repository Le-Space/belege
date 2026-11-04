// Taking a member out (#614), against a real OrbitDB and Helia in memory: the
// member's entries from before still count, anything after does not – by
// hash, so a backdated entry does not either – and the owner's are untouched.
// Identities and payloads are made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { Entry, Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';

import { createOfflineLibp2p } from '../network.js';
import { sealedEncryption } from '../entry-encryption.js';
import { booksAccessController, sealAccessLists } from './books-access.js';

/** @type {any} */ let helia;
/** @type {any} */ let orbitdb;
/** @type {any} */ let identities;
/** @type {any} */ let member;
/** @type {any} */ let db;
/** OrbitDB's own files, outside the repository. @type {string} */ let directory;

/** An entry as the log would hand it over: encoded, with its hash. @param {any} identity @param {number} [time] */
async function entryBy(identity, time) {
	const created = await Entry.create(
		identity,
		db.log.id,
		{ op: 'PUT', key: `k${Math.random()}`, value: 'Wolkenfabrik Hosting GmbH' },
		null,
		time === undefined ? null : { id: identity.publicKey, time }
	);
	const { hash } = await Entry.encode(created, undefined, undefined);
	return { ...created, hash };
}

beforeAll(async () => {
	helia = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor] }),
		await createOfflineLibp2p()
	).start();
	const keystore = await KeyStore({ storage: await MemoryStorage() });
	identities = await Identities({ ipfs: helia, keystore });
	directory = await mkdtemp(join(tmpdir(), 'belege-books-access-'));
	// @ts-expect-error `identities` is a documented option the bundled types omit
	orbitdb = await createOrbitDB({ ipfs: helia, identities, id: 'books-access-spec', directory });
	member = await identities.createIdentity({ id: 'member' });
	const key = crypto.getRandomValues(new Uint8Array(32));
	const encryption = await sealedEncryption(key, crypto.getRandomValues(new Uint8Array(32)));
	sealAccessLists(encryption);
	db = await orbitdb.open('books-access-spec', {
		type: 'keyvalue',
		AccessController: booksAccessController(orbitdb.identity.id)
	});
	await db.access.grant('write', member.id);
});

afterAll(async () => {
	await orbitdb?.stop();
	await helia?.stop();
	sealAccessLists(null);
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe('a member taken out', () => {
	it('keeps what they wrote before, and nothing after – not even backdated', async () => {
		const before = await entryBy(member);
		expect(await db.access.canAppend(before)).toBe(true);
		const owners = await entryBy(orbitdb.identity);

		await db.access.removeWriter(member.id, [before.hash]);
		expect(await db.access.removedWriters()).toEqual([member.id]);

		expect(await db.access.canAppend(before)).toBe(true);
		expect(await db.access.canAppend(await entryBy(member))).toBe(false);
		expect(await db.access.canAppend(await entryBy(member, 0))).toBe(false);
		expect(await db.access.admits(await entryBy(member))).toBe(false);
		// The owner writes on as before.
		expect(await db.access.canAppend(owners)).toBe(true);
		expect(await db.access.canAppend(await entryBy(orbitdb.identity))).toBe(true);
		// The grant itself stays, so the member's old entries replicate everywhere.
		expect([...(await db.access.get('write'))]).toContain(member.id);
	});

	it('is kept in the books’ access list: opened again, the removal still holds', async () => {
		const later = await entryBy(member);
		const address = db.address;
		await db.close();
		db = await orbitdb.open(address, {
			type: 'keyvalue',
			AccessController: booksAccessController(orbitdb.identity.id)
		});
		expect(await db.access.removedWriters()).toEqual([member.id]);
		expect(await db.access.canAppend(later)).toBe(false);
	});
});

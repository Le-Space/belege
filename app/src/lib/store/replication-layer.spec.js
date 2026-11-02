// OrbitDB's `replication` layer between two real nodes (two own devices: one
// keystore, so one writer), over libp2p's memory transport: the books sync
// with the deterministic seal, and a node without the replication key cannot
// read a single entry it is handed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { withBitswap } from '@helia/bitswap';
import { Identities, KeyStore, MemoryStorage, createOrbitDB } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sealedEncryption } from '../entry-encryption.js';
import SealedDocuments from './sealed-documents.js';

const MARKER = 'Wolkenfabrik-Replikation-7c2d';
const dataKey = crypto.getRandomValues(new Uint8Array(32));
const replicationKey = crypto.getRandomValues(new Uint8Array(32));

/** @param {string} name @param {any} keystore */
async function node(name, keystore) {
	const libp2p = await createLibp2p({
		addresses: { listen: [`/memory/${name}-${Math.random().toString(36).slice(2)}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			identify: identify(),
			pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true })
		}
	});
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor] }), libp2p)
	).start();
	const identities = await Identities({ ipfs: helia, keystore });
	const directory = await mkdtemp(join(tmpdir(), `belege-replication-${name}-`));
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		// @ts-expect-error `identities` is a documented option the bundled types omit
		identities,
		// One id and one keystore: one writer, as two devices of one passkey.
		id: 'replication-spec',
		directory
	});
	return { libp2p, helia, orbitdb, directory };
}

/** @param {any} orbitdb @param {string} address @param {any} encryption */
const open = (orbitdb, address, encryption) =>
	orbitdb.open(address, {
		type: SealedDocuments.type,
		Database: SealedDocuments({ indexBy: 'id' }),
		encryption
	});

/** @param {() => Promise<boolean>} ok */
async function until(ok, ms = 15000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 100));
	}
}

describe('the replication layer', () => {
	/** @type {any} */ let a;
	/** @type {any} */ let b;

	beforeAll(async () => {
		const keystore = await KeyStore({ storage: await MemoryStorage() });
		a = await node('a', keystore);
		b = await node('b', keystore);
		await b.libp2p.dial(a.libp2p.getMultiaddrs()[0]);
	});

	afterAll(async () => {
		for (const n of [a, b]) {
			await n?.orbitdb.stop();
			await n?.helia.stop();
			if (n?.directory) await rm(n.directory, { recursive: true, force: true });
		}
	});

	it('syncs the books between two devices of one passkey', async () => {
		const encryption = await sealedEncryption(dataKey, replicationKey);
		const dbA = await open(a.orbitdb, 'books-sync', encryption);
		await dbA.put({ id: '01A', partner: MARKER, amountCents: -1234 });
		await dbA.put({ id: '01B', partner: 'Stromwerk Test AG', amountCents: 500 });
		await dbA.put({ id: '01A', partner: MARKER, amountCents: -1200 });

		const dbB = await open(
			b.orbitdb,
			dbA.address.toString(),
			await sealedEncryption(dataKey, replicationKey)
		);
		await until(async () => (await dbB.all()).length === 2);
		const byId = Object.fromEntries(
			(await dbB.all()).map((/** @type {any} */ e) => [e.key, e.value])
		);
		expect(byId['01A'].amountCents).toBe(-1200);
		expect(byId['01B'].partner).toBe('Stromwerk Test AG');

		// And back: a write on B arrives on A, under the same hash on both.
		const written = await dbB.put({ id: '01C', partner: 'Konto B', amountCents: 1 });
		await until(async () => Boolean(await dbA.get('01C')));
		expect(await dbA.log.has(written)).toBe(true);
	});

	it('stores nothing a reader without the replication key could decode', async () => {
		const dbA = await open(
			a.orbitdb,
			'books-opaque',
			await sealedEncryption(dataKey, replicationKey)
		);
		const hash = await dbA.put({ id: '01D', partner: MARKER });
		const bytes = await dbA.log.storage.get(hash);
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		expect(text).not.toContain(MARKER);
		expect(text).not.toContain(a.orbitdb.identity.publicKey);
		expect(text).not.toContain('01D');

		// The data key alone opens nothing: the entry itself is sealed.
		const { decode } = (await import('@orbitdb/core/src/oplog/entry.js')).default;
		await expect(decode(bytes, undefined, undefined)).resolves.not.toHaveProperty('clock');
		const wrong = await sealedEncryption(dataKey, crypto.getRandomValues(new Uint8Array(32)));
		await expect(decode(bytes, wrong.replication.decrypt, wrong.data.decrypt)).rejects.toThrow();
	});
});

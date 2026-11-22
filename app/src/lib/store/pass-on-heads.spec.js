// Three own devices in a row – the phone and the office laptop each connected
// to the laptop only, as after joining by QR (#979): what the office laptop
// wrote before it was connected reaches the laptop by the heads exchange, and
// from there the phone. OrbitDB 4.0.0 alone does not pass it on. Over
// libp2p's memory transport; made-up bookings.
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
import { passOnHeads } from './pass-on-heads.js';

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
	const directory = await mkdtemp(join(tmpdir(), `belege-pass-on-${name}-`));
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		// @ts-expect-error `identities` is a documented option the bundled types omit
		identities,
		id: 'pass-on-spec',
		directory
	});
	return { libp2p, helia, orbitdb, directory };
}

/** @param {any} orbitdb @param {string} address */
async function open(orbitdb, address) {
	const db = await orbitdb.open(address, {
		type: SealedDocuments.type,
		Database: SealedDocuments({ indexBy: 'id' }),
		encryption: await sealedEncryption(dataKey, replicationKey)
	});
	passOnHeads(db);
	return db;
}

/** @param {() => Promise<boolean>} ok @param {string} what */
async function until(ok, what, ms = 15000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

describe('what came by the heads exchange is passed on (#979)', () => {
	/** @type {any} */ let laptop;
	/** @type {any} */ let phone;
	/** @type {any} */ let office;

	beforeAll(async () => {
		const keystore = await KeyStore({ storage: await MemoryStorage() });
		laptop = await node('laptop', keystore);
		phone = await node('phone', keystore);
		office = await node('office', keystore);
	});

	afterAll(async () => {
		for (const n of [laptop, phone, office]) {
			await n?.orbitdb.stop();
			await n?.helia.stop();
			if (n?.directory) await rm(n.directory, { recursive: true, force: true });
		}
	});

	it('reaches a device connected only to the one that got it', async () => {
		const onLaptop = await open(laptop.orbitdb, 'pass-on-books');
		await onLaptop.put({ id: '01A', partner: 'Wolkenfabrik Hosting GmbH', amountCents: -1234 });

		await phone.libp2p.dial(laptop.libp2p.getMultiaddrs()[0]);
		const onPhone = await open(phone.orbitdb, onLaptop.address.toString());
		await until(async () => Boolean(await onPhone.get('01A')), 'the phone has the first');

		// Written before the office laptop is connected: nobody hears it.
		// Opened by its name, as the books are: the same address, with nobody to ask.
		const onOffice = await open(office.orbitdb, 'pass-on-books');
		expect(String(onOffice.address)).toBe(String(onLaptop.address));
		await onOffice.put({ id: '01B', partner: 'Stromwerk Test AG', amountCents: 500 });
		await office.libp2p.dial(laptop.libp2p.getMultiaddrs()[0]);
		await until(async () => Boolean(await onLaptop.get('01B')), 'the laptop has the office’s');

		// The phone, never connected to the office laptop, gets it by the laptop.
		await until(
			async () => Boolean(await onPhone.get('01B')),
			'the phone has the office’s',
			10_000
		);
		expect(phone.libp2p.getConnections(office.libp2p.peerId)).toHaveLength(0);
	}, 60_000);
});

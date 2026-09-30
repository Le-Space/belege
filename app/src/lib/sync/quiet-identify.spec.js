// What identify says (quiet-identify.js), on real libp2p nodes over the
// in-memory transport: a stranger and a relay never learn a database's
// address, not at first and not when a database is opened later; the handler
// is still there for a device that proved the passkey.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { lpStream } from '@libp2p/utils';
import { multiaddr } from '@multiformats/multiaddr';

import { deriveDeviceAuthKey } from '../database-keys.js';
import { PROOF_PROTOCOL, createDeviceGate } from './device-gate.js';
import { isAnnounced, quietIdentify, quietIdentifyPush } from './quiet-identify.js';

// Made-up addresses in the shape OrbitDB registers.
const FIRST = '/orbitdb/heads/orbitdb/zdpuExampleAddressOne';
const LATER = '/orbitdb/heads/orbitdb/zdpuExampleAddressTwo';
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {() => boolean | Promise<boolean>} ok */
async function until(ok, ms = 4000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error('timed out');
		await wait(25);
	}
}

/** A node like the one that syncs the books. @param {string} name @param {Uint8Array} prf @param {boolean} quiet */
async function booksNode(name, prf, quiet = true) {
	const gate = createDeviceGate({ authKey: await deriveDeviceAuthKey(prf) });
	const node = await createLibp2p({
		addresses: { listen: [`/memory/${name}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			deviceGate: gate.service,
			identify: quiet ? quietIdentify() : identify(),
			identifyPush: quiet ? quietIdentifyPush() : identifyPush(),
			pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true })
		}
	});
	await node.handle(FIRST, async (stream) => {
		const lp = lpStream(stream);
		await lp.write(new TextEncoder().encode('heads'));
		await stream.close();
	});
	return node;
}

/** A relay or a stranger: identify, and it listens to pushes. */
async function outsider() {
	/** @type {string[][]} */
	const told = [];
	const node = await createLibp2p({
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify(), identifyPush: identifyPush() }
	});
	node.addEventListener('peer:identify', (e) => told.push([...e.detail.protocols]));
	node.addEventListener('peer:update', (e) => told.push([...e.detail.peer.protocols]));
	return { node, told };
}

const PRF = new Uint8Array(32).fill(7);
const heads = (/** @type {string[]} */ list) => list.filter((p) => p.startsWith('/orbitdb/heads/'));

describe('what identify says about the books (#209)', () => {
	/** @type {any} */ let books;
	/** @type {any} */ let other;
	/** @type {Awaited<ReturnType<typeof outsider>>} */ let stranger;

	beforeAll(async () => {
		books = await booksNode('quiet-a', PRF);
		other = await booksNode('quiet-b', PRF);
		stranger = await outsider();
	});
	afterAll(async () => {
		await Promise.all([books, other, stranger.node].map((n) => n?.stop()));
	});

	it('names no database to a peer that asks, at first or when one is opened later', async () => {
		await stranger.node.dial(multiaddr('/memory/quiet-a'));
		await until(() => stranger.told.length > 0);
		// Opened after the stranger connected: identify-push tells every connected peer.
		await books.handle(LATER, () => {});
		await books.handle('/test/later/1.0.0', () => {});
		await until(async () =>
			(await stranger.node.peerStore.get(books.peerId)).protocols.includes('/test/later/1.0.0')
		);
		const known = (await stranger.node.peerStore.get(books.peerId)).protocols;
		expect(heads(known)).toEqual([]);
		// Nor the device proof's name, which would say which app this is.
		expect(known.filter((/** @type {string} */ p) => p.startsWith('/belege/'))).toEqual([]);
		expect(stranger.told.flatMap(heads)).toEqual([]);
		// The rest is announced as before: libp2p needs it to set up gossipsub.
		expect(known).toEqual(expect.arrayContaining(['/ipfs/id/1.0.0', '/meshsub/1.2.0']));
	});

	it('the control: libp2p’s own identify does name them', async () => {
		const loud = await booksNode('quiet-loud', PRF, false);
		const o = await outsider();
		try {
			await o.node.dial(multiaddr('/memory/quiet-loud'));
			await until(() => heads(o.told.flat()).length > 0);
			expect(heads(o.told.flat())).toContain(FIRST);
		} finally {
			await Promise.all([loud.stop(), o.node.stop()]);
		}
	});

	it('the node itself still has the handlers, and a device that proved the passkey reaches them', async () => {
		expect(heads(books.getProtocols())).toEqual([FIRST, LATER]);
		await other.dial(multiaddr('/memory/quiet-a'));
		const stream = await other.dialProtocol(books.peerId, FIRST, {
			signal: AbortSignal.timeout(5000)
		});
		const answer = new TextDecoder().decode((await lpStream(stream).read()).subarray());
		expect(answer).toBe('heads');
		// The stranger, who was told nothing, gets nothing there either.
		const s = await stranger.node.dialProtocol(books.peerId, FIRST, {
			signal: AbortSignal.timeout(5000)
		});
		await expect(lpStream(s).read({ signal: AbortSignal.timeout(15_000) })).rejects.toThrow();
	}, 30_000);

	it('only the database protocols and the app’s own are private', () => {
		expect(isAnnounced(FIRST)).toBe(false);
		expect(isAnnounced(PROOF_PROTOCOL)).toBe(false);
		for (const p of ['/ipfs/id/1.0.0', '/meshsub/1.2.0', '/ipfs/bitswap/1.2.0']) {
			expect(isAnnounced(p), p).toBe(true);
		}
	});
});

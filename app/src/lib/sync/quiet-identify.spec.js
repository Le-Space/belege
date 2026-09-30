// What identify says (quiet-identify.js), on real libp2p nodes over the
// in-memory transport. A relay or a stranger is told only what it needs to
// connect – never a database's address, the app's name, or that the node
// speaks gossipsub and Bitswap; a device that proved the passkey is told the
// rest, at once and when it changes, and the sync between two devices runs.
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
import { gatedIdentify, isAnnounced, isPublic } from './quiet-identify.js';

// Made-up addresses in the shape OrbitDB registers.
const FIRST = '/orbitdb/heads/orbitdb/zdpuExampleAddressOne';
const LATER = '/orbitdb/heads/orbitdb/zdpuExampleAddressTwo';
// An extension a desktop serves its own devices, registered later.
const EXTENSION = '/uc/extension/example/0.1.0';
// A public name registered later: when it has arrived, the push that carried it is through.
const MARK = '/ipfs/id/mark/1.0.0';
const TOPIC = 'books';
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {() => boolean | Promise<boolean>} ok */
async function until(ok, ms = 6000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error('timed out');
		await wait(25);
	}
}

/**
 * A node like the one that syncs the books (device-sync.js): the gate, the
 * two lists, gossipsub, and a database's protocol.
 *
 * @param {string} name
 * @param {Uint8Array} prf
 */
async function booksNode(name, prf) {
	const gate = createDeviceGate({ authKey: await deriveDeviceAuthKey(prf), waitMs: 1500 });
	const whoAmI = gatedIdentify(gate);
	gate.onProved((peer) => {
		whoAmI.learn(peer).catch(() => {});
	});
	const node = await createLibp2p({
		addresses: { listen: [`/memory/${name}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			deviceGate: gate.service,
			...whoAmI.services,
			pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true })
		}
	});
	await node.handle(FIRST, async (stream) => {
		const lp = lpStream(stream);
		await lp.write(new TextEncoder().encode('heads'));
		await stream.close();
	});
	/** @type {any} */ (node.services.pubsub).subscribe(TOPIC);
	return { node, gate };
}

/** A relay or a stranger: libp2p's own identify, and it keeps what it is told. */
async function outsider() {
	/** @type {string[]} */
	const told = [];
	const node = await createLibp2p({
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify(), identifyPush: identifyPush() }
	});
	node.addEventListener('peer:identify', (e) => told.push(...e.detail.protocols));
	node.addEventListener('peer:update', (e) => told.push(...e.detail.peer.protocols));
	return { node, told };
}

const PRF = new Uint8Array(32).fill(7);
/** What another node knows of a node's protocols. @param {any} from @param {any} of */
const known = async (from, of) => (await from.peerStore.get(of.peerId)).protocols;

describe('what identify says, and to whom (#209)', () => {
	/** @type {Awaited<ReturnType<typeof booksNode>>} */ let books;
	/** @type {Awaited<ReturnType<typeof booksNode>>} */ let device;
	/** @type {Awaited<ReturnType<typeof outsider>>} */ let stranger;

	beforeAll(async () => {
		books = await booksNode('quiet-a', PRF);
		device = await booksNode('quiet-b', PRF);
		stranger = await outsider();
		await stranger.node.dial(multiaddr('/memory/quiet-a'));
		await device.node.dial(multiaddr('/memory/quiet-a'));
		await until(() => books.gate.isProved(device.node.peerId.toString()));
		await until(() => device.gate.isProved(books.node.peerId.toString()));
	});
	afterAll(async () => {
		await Promise.all([books.node, device.node, stranger.node].map((n) => n?.stop()));
	});

	it('a stranger is told identify and the relay protocols, and nothing else', async () => {
		await until(() => stranger.told.length > 0);
		const list = await known(stranger.node, books.node);
		expect(list).toContain('/ipfs/id/1.0.0');
		expect(list.filter((/** @type {string} */ p) => !isPublic(p))).toEqual([]);
	});

	it('a device that proved the passkey is told the rest – but no database and not the app', async () => {
		await until(async () => (await known(device.node, books.node)).includes('/meshsub/1.2.0'));
		const list = await known(device.node, books.node);
		expect(list).toEqual(expect.arrayContaining(['/ipfs/id/1.0.0', '/meshsub/1.2.0']));
		expect(list.filter((/** @type {string} */ p) => !isAnnounced(p))).toEqual([]);
		// And the other way round.
		await until(async () => (await known(books.node, device.node)).includes('/meshsub/1.2.0'));
	});

	it('so the sync starts between the devices: each sees the other’s subscription', async () => {
		const subscribers = (/** @type {any} */ n) =>
			/** @type {any} */ (n.services.pubsub).getSubscribers(TOPIC).map(String);
		await until(() => subscribers(device.node).includes(books.node.peerId.toString()));
		await until(() => subscribers(books.node).includes(device.node.peerId.toString()));
		expect(subscribers(books.node)).not.toContain(stranger.node.peerId.toString());
	});

	it('a later change goes to each with its own list, and never shortens a device’s', async () => {
		await books.node.handle(LATER, () => {});
		await books.node.handle(EXTENSION, () => {});
		await books.node.handle(MARK, () => {});
		// The device learns the extension …
		await until(async () => (await known(device.node, books.node)).includes(EXTENSION));
		// … the stranger only the public name, which shows that its push arrived.
		await until(async () => (await known(stranger.node, books.node)).includes(MARK));
		const forStranger = await known(stranger.node, books.node);
		expect(forStranger.filter((/** @type {string} */ p) => !isPublic(p))).toEqual([]);
		expect(stranger.told.filter((p) => !isPublic(p))).toEqual([]);
		// The public push did not reach the device: it still knows gossipsub.
		await wait(400);
		const forDevice = await known(device.node, books.node);
		expect(forDevice).toEqual(expect.arrayContaining(['/meshsub/1.2.0', EXTENSION, MARK]));
		expect(forDevice.filter((/** @type {string} */ p) => !isAnnounced(p))).toEqual([]);
	});

	it('the handlers are all still there: a device reaches a database, the stranger does not', async () => {
		expect(books.node.getProtocols()).toEqual(
			expect.arrayContaining([FIRST, LATER, PROOF_PROTOCOL])
		);
		const stream = await device.node.dialProtocol(books.node.peerId, FIRST, {
			signal: AbortSignal.timeout(5000)
		});
		expect(new TextDecoder().decode((await lpStream(stream).read()).subarray())).toBe('heads');
		const s = await stranger.node.dialProtocol(books.node.peerId, FIRST, {
			signal: AbortSignal.timeout(5000)
		});
		await expect(lpStream(s).read({ signal: AbortSignal.timeout(15_000) })).rejects.toThrow();
	}, 30_000);

	it('a peer that proves nothing and asks again still gets the public list', async () => {
		const asked = await /** @type {any} */ (stranger.node.services.identify).identify(
			stranger.node.getConnections(books.node.peerId)[0]
		);
		expect(asked.protocols.filter((/** @type {string} */ p) => !isPublic(p))).toEqual([]);
	});

	it('what is private and what is public', () => {
		expect(isAnnounced(FIRST)).toBe(false);
		expect(isAnnounced(PROOF_PROTOCOL)).toBe(false);
		expect(isAnnounced('/meshsub/1.2.0')).toBe(true);
		for (const p of ['/ipfs/id/1.0.0', '/ipfs/id/push/1.0.0', '/libp2p/circuit/relay/0.2.0/stop']) {
			expect(isPublic(p), p).toBe(true);
		}
		for (const p of [
			'/meshsub/1.2.0',
			'/ipfs/bitswap/1.2.0',
			'/webrtc-signaling/0.0.1',
			EXTENSION
		]) {
			expect(isPublic(p), p).toBe(false);
		}
	});
});

describe('the control: libp2p’s own identify', () => {
	it('names the database, the app and the sync protocols to a stranger', async () => {
		const gate = createDeviceGate({ authKey: await deriveDeviceAuthKey(PRF) });
		const loud = await createLibp2p({
			addresses: { listen: ['/memory/quiet-loud'] },
			transports: [memory()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			services: {
				deviceGate: gate.service,
				identify: identify(),
				identifyPush: identifyPush(),
				pubsub: gossipsub({ emitSelf: false })
			}
		});
		await loud.handle(FIRST, () => {});
		const o = await outsider();
		try {
			await o.node.dial(multiaddr('/memory/quiet-loud'));
			await until(() => o.told.includes(FIRST));
			expect(o.told).toEqual(expect.arrayContaining([FIRST, PROOF_PROTOCOL, '/meshsub/1.2.0']));
		} finally {
			await Promise.all([loud.stop(), o.node.stop()]);
		}
	});
});

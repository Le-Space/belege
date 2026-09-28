// The device gate (device-gate.js) on real libp2p nodes over the in-memory
// transport: own devices of one passkey, a stranger without the gate, and one
// with a gate but another passkey.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { memory } from '@libp2p/memory';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { lpStream } from '@libp2p/utils';
import { multiaddr } from '@multiformats/multiaddr';

import { deriveDeviceAuthKey } from '../database-keys.js';
import { checkDeviceProof, createDeviceGate, deviceProof, isOpenProtocol } from './device-gate.js';

const SECRET = '/test/books/1.0.0';
const TOPIC = 'books';
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {() => boolean} ok */
async function until(ok, ms = 3000) {
	const end = Date.now() + ms;
	while (!ok()) {
		if (Date.now() > end) throw new Error('timed out');
		await wait(20);
	}
}

/**
 * A node like the device-sync one: gossipsub, and a protocol that hands out
 * the books.
 *
 * @param {string} name
 * @param {ReturnType<typeof createDeviceGate> | null} gate
 */
async function node(name, gate) {
	const libp2p = await createLibp2p({
		addresses: { listen: [`/memory/${name}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			...(gate ? { deviceGate: gate.service } : {}),
			identify: identify(),
			pubsub: gossipsub({ emitSelf: false, allowPublishToZeroTopicPeers: true })
		}
	});
	await libp2p.handle(SECRET, async (stream) => {
		const lp = lpStream(stream);
		await lp.write(new TextEncoder().encode('Wolkenfabrik Hosting GmbH −12,34 €'));
		await stream.close();
	});
	/** @type {any} */ (libp2p.services.pubsub).subscribe(TOPIC);
	return libp2p;
}

/** Ask a node for the books. @param {any} from @param {any} to */
async function askBooks(from, to) {
	const stream = await from.dialProtocol(to.peerId, SECRET, { signal: AbortSignal.timeout(3000) });
	const answer = await lpStream(stream).read({ signal: AbortSignal.timeout(3000) });
	return new TextDecoder().decode(answer.subarray());
}

describe('deviceProof', () => {
	it('binds both peer ids and the key', async () => {
		const key = await deriveDeviceAuthKey(new Uint8Array(32).fill(1));
		const other = await deriveDeviceAuthKey(new Uint8Array(32).fill(2));
		const proof = await deviceProof(key, 'A', 'B');
		expect(await checkDeviceProof(key, proof, 'A', 'B')).toBe(true);
		expect(await checkDeviceProof(key, proof, 'B', 'A')).toBe(false);
		expect(await checkDeviceProof(key, proof, 'A', 'C')).toBe(false);
		expect(await checkDeviceProof(other, proof, 'A', 'B')).toBe(false);
		expect(await checkDeviceProof(key, proof.subarray(1), 'A', 'B')).toBe(false);
	});

	it('leaves only identify, the relay and the proof open', () => {
		expect(isOpenProtocol('/ipfs/id/1.0.0')).toBe(true);
		expect(isOpenProtocol('/ipfs/id/push/1.0.0')).toBe(true);
		expect(isOpenProtocol('/libp2p/circuit/relay/0.2.0/stop')).toBe(true);
		expect(isOpenProtocol('/belege/device-proof/1.0.0')).toBe(true);
		for (const p of [
			'/meshsub/1.1.0',
			'/ipfs/bitswap/1.2.0',
			'/orbitdb/heads/x',
			'/webrtc-signaling/0.0.1',
			'/uc/extension/belege-bridge/0.1.0'
		])
			expect(isOpenProtocol(p)).toBe(false);
	});
});

describe('device gate', () => {
	/** @type {any} */ let a;
	/** @type {any} */ let b;
	/** @type {any} */ let stranger;
	/** @type {any} */ let otherPasskey;
	/** @type {ReturnType<typeof createDeviceGate>} */ let gateA;
	/** @type {ReturnType<typeof createDeviceGate>} */ let gateB;

	beforeAll(async () => {
		const key = await deriveDeviceAuthKey(new Uint8Array(32).fill(7));
		gateA = createDeviceGate({ authKey: key, waitMs: 800 });
		gateB = createDeviceGate({ authKey: key, waitMs: 800 });
		const gateOther = createDeviceGate({
			authKey: await deriveDeviceAuthKey(new Uint8Array(32).fill(8)),
			waitMs: 800
		});
		a = await node('gate-a', gateA);
		b = await node('gate-b', gateB);
		stranger = await node('gate-stranger', null);
		otherPasskey = await node('gate-other', gateOther);
	});

	afterAll(async () => {
		await Promise.all([a, b, stranger, otherPasskey].map((n) => n?.stop()));
	});

	it('lets a device of the same passkey in: the books and gossipsub', async () => {
		await b.dial(multiaddr('/memory/gate-a'));
		await until(() => gateA.isProved(b.peerId.toString()) && gateB.isProved(a.peerId.toString()));
		expect(await askBooks(b, a)).toContain('Wolkenfabrik');
		expect(await askBooks(a, b)).toContain('Wolkenfabrik');
		await until(() =>
			b.services.pubsub.getSubscribers(TOPIC).some((/** @type {any} */ p) => p.equals(a.peerId))
		);
	});

	it('gives a stranger nothing: no books, no gossipsub, not even which topics', async () => {
		await stranger.dial(multiaddr('/memory/gate-a'));
		await expect(askBooks(stranger, a)).rejects.toThrow();
		await wait(1000);
		expect(gateA.isProved(stranger.peerId.toString())).toBe(false);
		expect(
			a.services.pubsub.getPeers().some((/** @type {any} */ p) => p.equals(stranger.peerId))
		).toBe(false);
		expect(stranger.services.pubsub.getSubscribers(TOPIC)).toHaveLength(0);
	});

	it('gives a device of another passkey nothing, dialling or dialled', async () => {
		await otherPasskey.dial(multiaddr('/memory/gate-a'));
		await expect(askBooks(otherPasskey, a)).rejects.toThrow();
		await a.dial(multiaddr('/memory/gate-other'));
		await expect(askBooks(otherPasskey, a)).rejects.toThrow();
		await wait(1000);
		expect(gateA.isProved(otherPasskey.peerId.toString())).toBe(false);
		expect(otherPasskey.services.pubsub.getSubscribers(TOPIC)).toHaveLength(0);
	});

	it('forgets a device, and proves again when asked (a first exchange that failed)', async () => {
		const peer = b.peerId.toString();
		gateA.forget(peer);
		expect(gateA.isProved(peer)).toBe(false);
		await gateA.proveTo(peer);
		expect(gateA.isProved(peer)).toBe(true);
		// A stranger is asked too, and stays one.
		await gateA.proveTo(stranger.peerId.toString());
		expect(gateA.isProved(stranger.peerId.toString())).toBe(false);
	});
});

// The bridge's own libp2p node (node.js, #573), on the memory transport:
// pairing by invitation and the handover of the books' device key, the gate
// once armed, the device list, `request` onto the command table, and the peer
// key across restarts. Made-up keys; nothing is real.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { memory } from '@libp2p/memory';
import { createLibp2p } from 'libp2p';
import { createDeviceGate, gatedIdentify } from '@belege/device-gate';
import { createConsumer } from '@le-space/ucep';

import { PAIR_SCOPE, fileStore, parseHandover, startBridgeNode } from '../src/node.js';
import { emptyCommands } from './support/commands.js';

const AUTH_KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);
let seq = 0;

/**
 * A device of the books: a libp2p node with the gate (when it has the key) and
 * a UCEP consumer, on the memory transport.
 *
 * @param {Uint8Array | null} authKey
 */
async function device(authKey) {
	const gate = authKey ? createDeviceGate({ authKey }) : null;
	// As the app's sync node: after the proof each side asks the other again,
	// and only then learns the extension (quiet identify's two lists).
	const whoAmI = gate ? gatedIdentify(gate) : null;
	if (gate && whoAmI) gate.onProved((peer) => whoAmI.learn(peer).catch(() => {}));
	const libp2p = await createLibp2p({
		addresses: { listen: [`/memory/device-${++seq}`] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: whoAmI
			? { deviceGate: /** @type {any} */ (gate).service, ...whoAmI.services }
			: { identify: identify() }
	});
	const consumer = createConsumer({ libp2p, label: 'Belege, test device' });
	await consumer.start();
	return {
		libp2p,
		consumer,
		gate,
		peerId: libp2p.peerId.toString(),
		async stop() {
			await consumer.stop().catch(() => {});
			await libp2p.stop();
		}
	};
}

describe('the bridge’s node', () => {
	/** @type {string} */ let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-node-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('parseHandover: the key as 32 bytes, relays with a peer id, devices as peer ids', () => {
		const relay =
			'/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
		const peer = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
		const ok = parseHandover({
			bridgeAuth: Buffer.from(AUTH_KEY).toString('base64'),
			relays: [relay, relay],
			devices: [peer]
		});
		assert.deepEqual([...ok.authKey], [...AUTH_KEY]);
		assert.deepEqual(ok.relays, [relay]);
		assert.deepEqual(ok.devices, [peer]);
		assert.throws(() => parseHandover({ bridgeAuth: 'AAAA' }), /32 bytes/);
		assert.throws(
			() => parseHandover({ bridgeAuth: Buffer.alloc(32).toString('base64') }),
			/32 bytes/
		);
		assert.throws(
			() =>
				parseHandover({
					bridgeAuth: Buffer.from(AUTH_KEY).toString('base64'),
					relays: ['/ip4/1.2.3.4/tcp/1']
				}),
			/relays/
		);
		assert.throws(
			() =>
				parseHandover({ bridgeAuth: Buffer.from(AUTH_KEY).toString('base64'), devices: ['nope'] }),
			/devices/
		);
	});

	test('fileStore keeps values in one file, and an absent file is empty', async () => {
		const store = fileStore(join(dir, 'store', 'grants.json'));
		assert.deepEqual(await store.values(), []);
		await store.set('a', { grantId: 'a', scopes: [PAIR_SCOPE] });
		await store.set('b', { grantId: 'b', scopes: [] });
		assert.deepEqual((await store.get('a'))?.scopes, [PAIR_SCOPE]);
		assert.equal((await store.values()).length, 2);
		await store.delete('a');
		assert.equal(await store.get('a'), undefined);
		assert.match(await readFile(join(dir, 'store', 'grants.json'), 'utf8'), /"b"/);
	});

	test('unarmed: a device pairs by invitation and hands the key over; the peer key survives a restart', async () => {
		const nodeDir = join(dir, 'one');
		/** @type {any[]} */
		const handovers = [];
		const node = await startBridgeNode({
			dir: nodeDir,
			authKey: null,
			relays: [],
			devices: [],
			commands: emptyCommands(),
			transports: [memory()],
			listen: ['/memory/bridge-one'],
			onHandover: async (h) => void handovers.push(h)
		});
		assert.equal(node.armed, false);
		const uri = await node.invite();
		assert.match(uri, /^web\+ucep:pair\?/);

		const phone = await device(null);
		try {
			await phone.consumer.pairWithInvitation(uri);
			// Unarmed, the bridge's functions are not offered: no books yet.
			await assert.rejects(
				phone.consumer.call(node.peerId, 'belege-bridge', 'request', {
					method: 'GET',
					path: '/health'
				}),
				(/** @type {any} */ e) => e.code === 'PAIRING_REQUIRED'
			);
			const answer = await phone.consumer.call(node.peerId, 'belege-bridge', 'handover', {
				bridgeAuth: Buffer.from(AUTH_KEY).toString('base64'),
				relays: [],
				devices: []
			});
			assert.equal(answer.peerId, node.peerId);
			await new Promise((r) => setTimeout(r, 1200));
			assert.equal(handovers.length, 1);
			assert.deepEqual([...handovers[0].authKey], [...AUTH_KEY]);
			// The device that handed over is a device of the books.
			assert.deepEqual(handovers[0].devices, [phone.peerId]);
		} finally {
			await phone.stop();
		}
		const peerId = node.peerId;
		await node.stop();

		// Armed now, from the same directory: the same peer id.
		const armed = await startBridgeNode({
			dir: nodeDir,
			authKey: AUTH_KEY,
			relays: [],
			devices: handovers[0].devices,
			transports: [memory()],
			listen: ['/memory/bridge-one']
		});
		try {
			assert.equal(armed.peerId, peerId);
			assert.equal(armed.armed, true);
			await assert.rejects(armed.invite(), /unpair first/);
		} finally {
			await armed.stop();
		}
	});

	test('armed: a listed device with the key gets in, a stranger and an unlisted device do not', async () => {
		const nodeDir = join(dir, 'two');
		const own = await device(AUTH_KEY);
		const unlisted = await device(AUTH_KEY);
		const stranger = await device(OTHER_KEY);
		/** @type {Awaited<ReturnType<typeof startBridgeNode>> | null} */
		let node = null;
		let unpaired = 0;
		try {
			node = await startBridgeNode({
				dir: nodeDir,
				authKey: AUTH_KEY,
				relays: [],
				devices: [own.peerId],
				commands: emptyCommands(),
				transports: [memory()],
				listen: ['/memory/bridge-two'],
				onUnpair: async () => void unpaired++
			});
			const addr = `/memory/bridge-two/p2p/${node.peerId}`;
			// The own device: proved, and told the extension.
			await own.libp2p.dial(
				/** @type {any} */ (await import('@multiformats/multiaddr')).multiaddr(addr)
			);
			const provedHere = await waitFor(() => own.gate?.isProved(node.peerId) === true);
			assert.equal(provedHere, true, 'the device proved the bridge and the bridge proved back');
			const answer = await own.consumer.call(node.peerId, 'belege-bridge', 'help', {});
			assert.deepEqual(answer.commands, ['help', 'handover', 'devices', 'unpair', 'request']);
			assert.ok(answer.requests.some((/** @type {any} */ r) => r.name === 'mail.search'));
			assert.ok(!answer.requests.some((/** @type {any} */ r) => r.name === 'session.pair'));

			// The bridge's functions over the stream: the same table as HTTP (stream.js).
			const health = await own.consumer.call(node.peerId, 'belege-bridge', 'request', {
				method: 'GET',
				path: '/health'
			});
			assert.equal(health.status, 200);
			assert.equal(health.json.service, 'belege-bridge');
			const missing = await own.consumer.call(node.peerId, 'belege-bridge', 'request', {
				method: 'GET',
				path: '/paperless/documents?since=2026-01-01T00:00:00Z'
			});
			assert.equal(missing.status, 503);
			assert.equal(missing.json.code, 'PAPERLESS_NOT_SET_UP');
			await assert.rejects(
				own.consumer.call(node.peerId, 'belege-bridge', 'request', {
					method: 'POST',
					path: '/pair',
					body: { code: '000000' }
				}),
				(/** @type {any} */ e) => e.code === 'INVALID_ARGUMENTS'
			);

			// A stranger with another key: never proved, and the extension refuses it.
			await stranger.libp2p.dial(
				/** @type {any} */ (await import('@multiformats/multiaddr')).multiaddr(addr)
			);
			await new Promise((r) => setTimeout(r, 200));
			assert.equal(stranger.gate?.isProved(node.peerId), false);
			await assert.rejects(stranger.consumer.call(node.peerId, 'belege-bridge', 'help', {}));

			// The right key, but not on the books' device list: refused by `admit`.
			await unlisted.libp2p.dial(
				/** @type {any} */ (await import('@multiformats/multiaddr')).multiaddr(addr)
			);
			await new Promise((r) => setTimeout(r, 200));
			await assert.rejects(unlisted.consumer.call(node.peerId, 'belege-bridge', 'help', {}));
			// The own device keeps the list current, with no UCEP grant: the gate is the check.
			const kept = await own.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [own.peerId, unlisted.peerId]
			});
			assert.equal(kept.devices, 2);
			assert.equal(node.devices().size, 2);

			// "Kopplung lösen" on a device: the bridge is told to forget its key, a moment later.
			const gone = await own.consumer.call(node.peerId, 'belege-bridge', 'unpair', {});
			assert.equal(gone.unpaired, true);
			assert.equal(unpaired, 0, 'the answer goes out before the restart');
			assert.equal(await waitFor(() => unpaired === 1), true);
		} finally {
			await node?.stop();
			await own.stop();
			await unlisted.stop();
			await stranger.stop();
		}
	});
});

/** @param {() => boolean} check */
async function waitFor(check, ms = 3000) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if (check()) return true;
		await new Promise((r) => setTimeout(r, 25));
	}
	return check();
}

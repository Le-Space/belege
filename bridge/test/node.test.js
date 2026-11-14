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
		const other = await device(AUTH_KEY);
		const unlisted = await device(AUTH_KEY);
		const stranger = await device(OTHER_KEY);
		/** @type {Awaited<ReturnType<typeof startBridgeNode>> | null} */
		let node = null;
		let unpaired = 0;
		try {
			// The own device paired the bridge by invitation: it holds the pairing grant.
			await fileStore(join(nodeDir, 'grants.json')).set('paired', {
				grantId: 'paired',
				extensionId: 'belege-bridge',
				consumerPeerId: own.peerId,
				scopes: [PAIR_SCOPE],
				label: 'test',
				did: '',
				createdAt: Date.now(),
				expiresAt: 0,
				lastUsedAt: Date.now()
			});
			node = await startBridgeNode({
				dir: nodeDir,
				authKey: AUTH_KEY,
				relays: [],
				devices: [own.peerId, other.peerId],
				// As index.js: `device.scopes` reaches the node through its handle.
				commands: emptyCommands({
					node: {
						status: () => ({}),
						disarm: async () => {},
						setScopes: (/** @type {unknown} */ p, /** @type {unknown} */ s) =>
							/** @type {any} */ (node).setScopes(p, s)
					}
				}),
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
			assert.deepEqual(answer.commands.slice(0, 7), [
				'help',
				'handover',
				'devices',
				'grants',
				'renew',
				'unpair',
				'request'
			]);
			// From protocol 2 on, every command offered by its own name (#577).
			assert.equal(answer.protocol, 2);
			assert.ok(answer.commands.includes('mail.search'));
			assert.ok(answer.commands.includes('bridge.health'));
			assert.ok(!answer.commands.includes('session.pair'), 'pairing stays on HTTP');
			assert.ok(!answer.commands.includes('backup.put'), 'bytes stay on HTTP until #578');
			assert.ok(answer.scopes.includes('bridge:llm'));
			assert.ok(!answer.scopes.includes('bridge:share'), 'shares stay on HTTP');
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
			// The same by name: arguments checked against the catalogue's schema.
			const named = await own.consumer.call(node.peerId, 'belege-bridge', 'paperless.documents', {
				since: '2026-01-01T00:00:00Z'
			});
			assert.equal(named.status, 503);
			assert.equal(named.json.code, 'PAPERLESS_NOT_SET_UP');
			await assert.rejects(
				own.consumer.call(node.peerId, 'belege-bridge', 'paperless.documents', { nope: 1 }),
				(/** @type {any} */ e) => e.code === 'INVALID_ARGUMENTS'
			);
			await assert.rejects(
				own.consumer.call(node.peerId, 'belege-bridge', 'paperless.everything', {}),
				(/** @type {any} */ e) => e.code === 'UNKNOWN_COMMAND'
			);
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
			// The device that paired the bridge keeps the list current.
			const kept = await own.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [own.peerId, other.peerId, unlisted.peerId]
			});
			assert.equal(kept.devices, 3);
			assert.equal(node.devices().size, 3);

			// Another device of the books, proved too, only takes devices off –
			// and never the one that paired the bridge.
			await other.libp2p.dial(
				/** @type {any} */ (await import('@multiformats/multiaddr')).multiaddr(addr)
			);
			assert.equal(await waitFor(() => other.gate?.isProved(node.peerId) === true), true);
			const fewer = await other.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [other.peerId]
			});
			assert.equal(fewer.devices, 2);
			assert.deepEqual([...node.devices()].sort(), [own.peerId, other.peerId].sort());
			const more = await other.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [own.peerId, other.peerId, stranger.peerId]
			});
			assert.equal(more.devices, 2, 'adding is for the device that paired the bridge');

			// Scopes (#579): listed by its peer id alone, a device holds them all …
			const before = await other.consumer.call(node.peerId, 'belege-bridge', 'request', {
				method: 'GET',
				path: '/paperless/documents?since=2026-01-01T00:00:00Z'
			});
			assert.equal(before.status, 503, 'let through to the command');
			// … and the device that paired the bridge can narrow them.
			await own.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [own.peerId, { peerId: other.peerId, scopes: ['bridge:bank:read', 'bridge:nope'] }]
			});
			await assert.rejects(
				other.consumer.call(node.peerId, 'belege-bridge', 'request', {
					method: 'GET',
					path: '/paperless/documents?since=2026-01-01T00:00:00Z'
				}),
				(/** @type {any} */ e) => e.code === 'SCOPE_MISSING'
			);
			const open = await other.consumer.call(node.peerId, 'belege-bridge', 'request', {
				method: 'GET',
				path: '/health'
			});
			assert.equal(open.status, 200, 'a command without a scope needs none');
			// Each device sees its own scopes; the one that paired the bridge sees all.
			const mine = await other.consumer.call(node.peerId, 'belege-bridge', 'grants', {});
			assert.equal(mine.holder, false);
			assert.deepEqual(
				mine.devices.map((/** @type {any} */ g) => [g.peerId, g.scopes]),
				[[other.peerId, ['bridge:bank:read']]]
			);
			assert.equal(typeof mine.devices[0].expiresAt, 'number');
			const all = await own.consumer.call(node.peerId, 'belege-bridge', 'grants', {});
			assert.equal(all.holder, true);
			assert.equal(all.devices.length, 2);
			assert.equal(
				all.devices.find((/** @type {any} */ g) => g.peerId === own.peerId).expiresAt,
				null,
				'the device that paired the bridge does not lapse'
			);
			// One device's scopes, set by name (`device.scopes`): only the device that paired the bridge.
			await assert.rejects(
				other.consumer.call(node.peerId, 'belege-bridge', 'device.scopes', {
					peerId: other.peerId,
					scopes: ['bridge:paperless:read', 'bridge:bank:read']
				}),
				(/** @type {any} */ e) => e.code === 'SCOPE_MISSING'
			);
			const set = await own.consumer.call(node.peerId, 'belege-bridge', 'device.scopes', {
				peerId: other.peerId,
				scopes: ['bridge:paperless:read', 'bridge:bank:read']
			});
			assert.equal(set.status, 200);
			assert.deepEqual(set.json.scopes, ['bridge:bank:read', 'bridge:paperless:read']);
			const now = await other.consumer.call(node.peerId, 'belege-bridge', 'request', {
				method: 'GET',
				path: '/paperless/documents?since=2026-01-01T00:00:00Z'
			});
			assert.equal(now.status, 503, 'ticked again: let through to the command');
			// The device list told again by peer ids keeps the set.
			await own.consumer.call(node.peerId, 'belege-bridge', 'devices', {
				devices: [own.peerId, other.peerId]
			});
			const kept2 = await other.consumer.call(node.peerId, 'belege-bridge', 'grants', {});
			assert.deepEqual(kept2.devices[0].scopes, ['bridge:bank:read', 'bridge:paperless:read']);
			// An unknown scope, or the holder's own, is refused; so is a stranger's peer id.
			for (const scopes of [['bridge:nope'], ['bridge:grants:manage']]) {
				const bad = await own.consumer.call(node.peerId, 'belege-bridge', 'device.scopes', {
					peerId: other.peerId,
					scopes
				});
				assert.equal(bad.status, 400);
				assert.equal(bad.json.code, 'INVALID_ARGUMENTS');
			}
			const strangerSet = await own.consumer.call(node.peerId, 'belege-bridge', 'device.scopes', {
				peerId: stranger.peerId,
				scopes: []
			});
			assert.equal(strangerSet.status, 400);
			// The schema refuses more than peerId and scopes before anything runs.
			await assert.rejects(
				own.consumer.call(node.peerId, 'belege-bridge', 'device.scopes', {
					peerId: other.peerId,
					scopes: [],
					holder: true
				}),
				(/** @type {any} */ e) => e.code === 'INVALID_ARGUMENTS'
			);
			const settable = await own.consumer.call(node.peerId, 'belege-bridge', 'grants', {});
			assert.ok(settable.settable.includes('bridge:mail:read'));
			assert.ok(!settable.settable.includes('bridge:grants:manage'));

			// Renewing is for the device that paired the bridge.
			await assert.rejects(
				other.consumer.call(node.peerId, 'belege-bridge', 'renew', { peerId: other.peerId }),
				(/** @type {any} */ e) => ['PAIRING_REQUIRED', 'SCOPE_MISSING'].includes(e.code)
			);
			const renewed = await own.consumer.call(node.peerId, 'belege-bridge', 'renew', {
				peerId: other.peerId
			});
			assert.equal(renewed.renewed, true);
			// … and cannot unpair it.
			await assert.rejects(
				other.consumer.call(node.peerId, 'belege-bridge', 'unpair', {}),
				(/** @type {any} */ e) => ['PAIRING_REQUIRED', 'SCOPE_MISSING'].includes(e.code)
			);
			assert.equal(unpaired, 0);

			// "Kopplung lösen" on the device that paired it: the bridge forgets its key, a moment later.
			const gone = await own.consumer.call(node.peerId, 'belege-bridge', 'unpair', {});
			assert.equal(gone.unpaired, true);
			assert.equal(unpaired, 0, 'the answer goes out before the restart');
			assert.equal(await waitFor(() => unpaired === 1), true);
		} finally {
			await node?.stop();
			await own.stop();
			await other.stop();
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

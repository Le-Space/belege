// How long a call to the bridge may take is the caller's to say. UCEP's own
// limit for an answer is a minute; a mailbox listed over IMAP or a wallet
// with a long history takes longer, and the app then called the bridge
// unreachable while the bridge finished and nobody took the answer.
// patches/ lets `consumer.call` take a signal; the app gives its calls ten
// minutes (app/src/lib/sync/remote-bridge.js CALL_WAIT_MS). This test fails
// without the patch: the signal is ignored and the slow call resolves.
// Memory transport; made-up data only.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { memory } from '@libp2p/memory';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2p } from 'libp2p';
import { createDeviceGate, gatedIdentify } from '@belege/device-gate';
import { createConsumer } from '@le-space/ucep';

import { startBridgeNode } from '../src/node.js';
import { emptyCommands } from './support/commands.js';

const AUTH_KEY = new Uint8Array(32).fill(9);
const SLOW_MS = 1200;

/** @type {string} */ let dir;
/** @type {any} */ let node;
/** @type {any} */ let libp2p;
/** @type {any} */ let consumer;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-bridge-call-time-'));
	const gate = createDeviceGate({ authKey: AUTH_KEY });
	const whoAmI = gatedIdentify(gate);
	gate.onProved((peer) => whoAmI.learn(peer).catch(() => {}));
	libp2p = await createLibp2p({
		addresses: { listen: ['/memory/call-time-device'] },
		transports: [memory()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { deviceGate: gate.service, ...whoAmI.services }
	});
	consumer = createConsumer({ libp2p, label: 'Belege, test device' });
	await consumer.start();
	const commands = emptyCommands().map((c) =>
		c.name === 'mail.messages'
			? {
					...c,
					run: async () => {
						await new Promise((r) => setTimeout(r, SLOW_MS));
						return { status: 200, json: { messages: [] } };
					}
				}
			: c
	);
	node = await startBridgeNode({
		dir,
		authKey: AUTH_KEY,
		relays: [],
		devices: [libp2p.peerId.toString()],
		commands: /** @type {any} */ (commands),
		transports: [memory()],
		listen: ['/memory/call-time-bridge']
	});
	await libp2p.dial(multiaddr(`/memory/call-time-bridge/p2p/${node.peerId}`));
	const until = Date.now() + 10_000;
	while (!gate.isProved(node.peerId) && Date.now() < until) {
		await new Promise((r) => setTimeout(r, 25));
	}
	assert.ok(gate.isProved(node.peerId), 'proved');
});

after(async () => {
	await consumer?.stop().catch(() => {});
	await libp2p?.stop();
	await node?.stop();
	await rm(dir, { recursive: true, force: true });
});

const ask = (/** @type {AbortSignal | undefined} */ signal) =>
	consumer.call(
		node.peerId,
		'belege-bridge',
		'mail.messages',
		{ since: '2026-01-01' },
		signal ? { signal } : {}
	);

test('a call ends when the caller’s time is up, not when UCEP’s is', async () => {
	const started = Date.now();
	await assert.rejects(ask(AbortSignal.timeout(200)));
	assert.ok(Date.now() - started < SLOW_MS, 'ended by the signal, before the answer');
});

test('a slow answer is taken when the caller waits for it', async () => {
	const answer = await ask(AbortSignal.timeout(SLOW_MS * 5));
	assert.equal(answer.status, 200);
});

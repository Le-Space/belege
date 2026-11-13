// The hosted bridge's unlock from the browser (#585), against a stand-in for
// the VM's attestation agent (@belege/bridge/testing/attest-agent): the real
// WASM handshake, the owner's signature with the books' Aleph key, and what
// reaches the VM. Then the bridge itself, started with what arrived as the
// image starts it: armed, with the peer id the browser made, knowing this
// device.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import * as wasm from '@le-space/attest-wasm/pkg/relay_button_attest.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeVerify, FAKE_POLICY, startFakeAttestAgent } from '@belege/bridge/testing/attest-agent';

import { alephAddressOf, alephSign } from '../backup/aleph-signer.js';
import { newAlephKey } from '../backup/aleph-key.js';
import {
	attestUrlOf,
	fetchInstance,
	HOSTED_IMAGE,
	hostedSecrets,
	releaseCheck,
	unlockHosted
} from './hosted-bridge.js';

const require = createRequire(import.meta.url);
const PUBLISHED = '11'.repeat(48);
const CHANGED = '22'.repeat(48);
const VM = 'a'.repeat(64);
const CRN = 'e'.repeat(64);
const RELAY =
	'/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWQu5E1ZkGC5x2dSVTEWxYvsssWjXgk2Mzc8GZHN26cYzS';

const ownerKey = newAlephKey();
const owner = alephAddressOf(ownerKey);
const published = {
	policy: FAKE_POLICY,
	measurements: [{ platform: 'sev_snp', registers: { launch: PUBLISHED } }]
};
const instance = (/** @type {Record<string, any>} */ over = {}) => ({
	address: owner,
	rootfs: { parent: { ref: HOSTED_IMAGE, use_latest: true } },
	environment: { trusted_execution: published },
	requirements: { node: { node_hash: CRN } },
	resources: { vcpus: 2 },
	...over
});

/** @type {any[]} */
const agents = [];
beforeAll(async () => {
	const path = require.resolve('@le-space/attest-wasm/pkg/relay_button_attest_bg.wasm');
	wasm.initSync({ module: await readFile(path) });
});
afterAll(() => Promise.all(agents.map((a) => a.close())));

/** The browser's unlock of `vm` for the INSTANCE `content`. */
const unlock = (/** @type {any} */ vm, /** @type {any} */ content, secrets = {}) =>
	unlockHosted({
		instance: content,
		published,
		image: HOSTED_IMAGE,
		owner,
		wasm,
		relayUrl: 'wss://relay.example/attest',
		crnHash: CRN,
		instanceItemHash: VM,
		passphrase: 'not-the-real-passphrase',
		secrets,
		sign: async (/** @type {string} */ payload) => alephSign(ownerKey, payload),
		verify: fakeVerify,
		transport: vm.transport,
		sleep: async () => {
			throw new Error('a verdict is not retried');
		},
		attempts: 1
	});

describe('the hosted bridge, unlocked from the browser', () => {
	it('the published image gets the passphrase and what the bridge starts with', async () => {
		const vm = await startFakeAttestAgent({ measurement: PUBLISHED, owner });
		agents.push(vm);
		const peer = await generateKeyPair('Ed25519');
		const secrets = hostedSecrets({
			host: 'four-words-of-it.2n6.me',
			authKey: new Uint8Array(32).fill(7),
			peerKey: privateKeyToProtobuf(peer),
			relays: [RELAY],
			devices: ['12D3KooWThisDevice', '12D3KooWThisDevice']
		});
		const result = await unlock(vm, instance(), secrets);
		expect(result.measurement).toBe(PUBLISHED);
		expect(Object.keys(vm.received).sort()).toEqual([
			'bridge_auth',
			'bridge_config',
			'bridge_peer_key',
			'https_hostname',
			'luks_passphrase'
		]);
		expect(vm.received.bridge_auth).toBe('07'.repeat(32));
		expect(JSON.parse(vm.received.bridge_config)).toEqual({
			node: { relays: [RELAY], devices: ['12D3KooWThisDevice'] }
		});
	});

	it('a changed runtime, another image, other pins or another owner: nothing arrives', async () => {
		const changed = await startFakeAttestAgent({ measurement: CHANGED, owner });
		agents.push(changed);
		await expect(unlock(changed, instance(), { x: 'y' })).rejects.toThrow(/measurement/);
		expect(changed.received).toEqual({});

		const vm = await startFakeAttestAgent({ measurement: PUBLISHED, owner });
		agents.push(vm);
		const other = { platform: 'sev_snp', registers: { launch: CHANGED } };
		for (const [content, why] of /** @type {const} */ ([
			[
				instance({ rootfs: { parent: { ref: 'd'.repeat(64) } } }),
				/another image than the published one/
			],
			[
				instance({ environment: { trusted_execution: { ...published, measurements: [other] } } }),
				/a measurement other than the published one/
			],
			[instance({ address: alephAddressOf(newAlephKey()) }), /not paid by the owner or its payer/]
		])) {
			await expect(unlock(vm, content, { x: 'y' })).rejects.toThrow(why);
		}
		expect(vm.connections()).toBe(0);
		expect(vm.received).toEqual({});
		expect(() => releaseCheck({ instance: instance(), published, image: 'x', owner })).toThrow(
			/not a STORE hash/
		);
	});

	it('takes the INSTANCE when the owner’s payer pays, and only that payer', () => {
		const sub = alephAddressOf(newAlephKey());
		const paid = instance({ address: sub });
		expect(() => releaseCheck({ instance: paid, published, image: HOSTED_IMAGE, owner })).toThrow(
			/not paid by the owner or its payer/
		);
		expect(
			releaseCheck({ instance: paid, published, image: HOSTED_IMAGE, owner, payers: [owner, sub] })
		).toEqual(releaseCheck({ instance: instance(), published, image: HOSTED_IMAGE, owner }));
	});

	it('the INSTANCE as Aleph holds it, and the node it runs on', async () => {
		const answers = /** @type {Record<string, any>} */ ({
			[VM]: { status: 'processed', message: { type: 'INSTANCE', content: instance() } },
			['b'.repeat(64)]: { status: 'pending', message: { type: 'INSTANCE', content: instance() } }
		});
		const f = /** @type {any} */ (
			async (/** @type {string} */ url) => {
				const hash = url.split('/').pop() ?? '';
				return answers[hash]
					? { ok: true, json: async () => answers[hash] }
					: { ok: false, status: 404 };
			}
		);
		const { crn, vcpus, content } = await fetchInstance(VM, { apiHost: 'https://aleph', fetch: f });
		expect([crn, vcpus, content.address]).toEqual([CRN, 2, owner]);
		await expect(fetchInstance('b'.repeat(64), { apiHost: 'x', fetch: f })).rejects.toThrow(
			/no running INSTANCE/
		);
		await expect(fetchInstance('c'.repeat(64), { apiHost: 'x', fetch: f })).rejects.toThrow(/404/);
		await expect(fetchInstance('not a hash', { apiHost: 'x', fetch: f })).rejects.toThrow();
	});

	it('attests through a relay of the books: its /attest by name', () => {
		expect(attestUrlOf(['/ip4/127.0.0.1/tcp/1/ws', RELAY])).toBe('wss://relay.example/attest');
		expect(attestUrlOf(['/ip4/127.0.0.1/tcp/1/ws'])).toBeNull();
	});
});

describe('the bridge, started with what arrived', () => {
	/** @type {string} */
	let dir;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-hosted-pair-'));
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	it('is armed, with the peer id the browser made, and knows this device', async () => {
		const peer = await generateKeyPair('Ed25519');
		const self = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
		const secrets = hostedSecrets({
			host: 'four-words-of-it.2n6.me',
			authKey: new Uint8Array(32).fill(9),
			peerKey: privateKeyToProtobuf(peer),
			relays: [],
			devices: [self]
		});
		// As belege-bridge-run sorts them (bridge/rootfs/files): the keychain's
		// account, the peer key into the node's directory, the config with the
		// hosted settings on top.
		const secretsDir = join(dir, 'secrets');
		await mkdir(join(dir, 'node'), { recursive: true });
		await mkdir(secretsDir, { recursive: true });
		await writeFile(join(secretsDir, 'bridge_auth'), secrets.bridge_auth);
		await writeFile(join(dir, 'node', 'peer-key'), Buffer.from(secrets.bridge_peer_key, 'base64'));
		const config = JSON.parse(secrets.bridge_config);
		await writeFile(
			join(dir, 'bridge.json'),
			JSON.stringify({
				bridge: { port: 0 },
				node: { ...config.node, enabled: true, wsPort: 0 }
			})
		);
		const cli = join(dirname(require.resolve('@belege/bridge')), 'cli.js');
		const child = spawn(process.execPath, [cli, '--hosted', '--config', join(dir, 'bridge.json')], {
			env: { ...process.env, BELEGE_BRIDGE_SECRETS_DIR: secretsDir, PATH: '/nonexistent' }
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		try {
			const until = Date.now() + 15_000;
			while (!/listening on http:\/\/127\.0\.0\.1:\d+/.test(out) && Date.now() < until) {
				await new Promise((r) => setTimeout(r, 50));
			}
			const port = Number(/listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
			/** @type {any} */
			let health = null;
			while (!health?.node?.peerId && Date.now() < until) {
				health = await (await fetch(`http://127.0.0.1:${port}/health`)).json().catch(() => null);
				if (!health?.node?.peerId) await new Promise((r) => setTimeout(r, 50));
			}
			expect(health.node.armed).toBe(true);
			expect(health.node.peerId).toBe(peerIdFromPrivateKey(peer).toString());
			const saved = JSON.parse(await readFile(join(dir, 'bridge.json'), 'utf8'));
			expect(saved.node.devices).toEqual([self]);
			expect(out).not.toMatch(/web\+ucep:pair\?|Pairing code/);
		} finally {
			child.kill();
		}
	}, 30_000);
});

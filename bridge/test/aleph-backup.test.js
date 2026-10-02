// The backup's copy on Aleph (issue #77): the key and its signature, setup:aleph,
// and /backup end to end against a fake Aleph on 127.0.0.1. All keys, addresses
// and bytes made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAlephPin } from '@le-space/orbitdb-storage-bridge/backends/aleph-pin';
import { createAlephBackend } from '@le-space/orbitdb-storage-bridge/backends/aleph';

import {
	BACKUP_CHANNEL,
	addressOf,
	createAlephBackup,
	isBackupKey,
	personalSign
} from '../src/aleph-backup.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { runAlephSetup } from '../src/setup-aleph.js';
import { startFakeAleph } from './support/fake-aleph.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
/** A made-up key, and another. */
const KEY = createHash('sha256').update('belege backup test key').digest('hex');
const OTHER = createHash('sha256').update('somebody else').digest('hex');

/** @type {string} */ let dir;
/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-aleph-backup-'));
	aleph = await startFakeAleph({
		accounts: { [addressOf(KEY)]: { balance: 1_500_000, rows: [] } }
	});
});
after(async () => {
	await aleph?.close();
	await rm(dir, { recursive: true, force: true });
});

test('the key: its address and personal_sign as an Ethereum wallet has them', () => {
	// The example from the web3.js documentation (eth.accounts.sign), a public test key.
	const doc = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
	assert.equal(addressOf(doc), '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
	assert.equal(
		personalSign(doc, 'Some data'),
		'0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c'
	);
	assert.equal(isBackupKey(KEY), true);
	assert.equal(isBackupKey(`0x${KEY}`), true);
	assert.equal(isBackupKey('0'.repeat(64)), false, 'zero is no key');
	assert.equal(isBackupKey('xyz'), false);
});

test('the fake takes a STORE only signed by its sender, as Aleph does: else pending', async () => {
	const backend = createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` });
	const { id } = await backend.putBlob(new Uint8Array([1, 2, 3]), { name: 'x.bin' });
	const pin = createAlephPin({
		sender: addressOf(KEY),
		sign: async (_a, message) => personalSign(OTHER, message),
		apiHost: aleph.url
	});
	assert.equal((await pin(id)).status, 'pending');
	const good = createAlephPin({
		sender: addressOf(KEY),
		sign: async (_a, message) => personalSign(KEY, message),
		apiHost: aleph.url
	});
	assert.equal((await good(id)).status, 'processed');
	await assert.rejects(good('QmNichtHochgeladen'), /422/, 'a CID nobody uploaded');
});

describe('setup:aleph', () => {
	/** @param {string[]} answers */
	const io = (answers = []) => {
		/** @type {string[]} */ const out = [];
		return {
			out,
			io: {
				ask: async () => answers.shift() ?? '',
				print: (/** @type {string} */ l) => out.push(l)
			}
		};
	};

	test('makes a key into the keychain, the flag into the config, and prints the address, never the key', async () => {
		const configPath = join(dir, 'setup.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(null, 'aleph-backup');
		const first = io();
		assert.equal(
			await runAlephSetup({ io: first.io, keychain, configPath, makeKey: () => KEY }),
			true
		);
		assert.equal(await keychain.read(), KEY);
		assert.equal((await loadConfig(configPath)).alephBackup.configured, true);
		assert.doesNotMatch(await readFile(configPath, 'utf8'), new RegExp(KEY));
		assert.ok(first.out.some((l) => l.includes(addressOf(KEY))));
		assert.ok(first.out.every((l) => !l.includes(KEY)));

		const again = io();
		await runAlephSetup({ io: again.io, keychain, configPath, makeKey: () => OTHER });
		assert.equal(await keychain.read(), KEY, 'a second run keeps the key');
		assert.ok(again.out.some((l) => l.includes(addressOf(KEY))));
	});

	test('--new replaces it only on yes, and says the old backups stay with the old account', async () => {
		const configPath = join(dir, 'new.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(KEY, 'aleph-backup');
		const no = io(['']);
		await runAlephSetup({ io: no.io, keychain, configPath, replace: true, makeKey: () => OTHER });
		assert.equal(await keychain.read(), KEY);
		assert.ok(no.out.some((l) => /stay with the old one/.test(l)));
		await runAlephSetup({
			io: io(['y']).io,
			keychain,
			configPath,
			replace: true,
			makeKey: () => OTHER
		});
		assert.equal(await keychain.read(), OTHER);
	});
});

describe('/backup', () => {
	/**
	 * @param {{ configured: boolean, key?: string | null }} options
	 */
	async function bridgeWith({ configured, key = KEY }) {
		const configPath = join(dir, `bridge-${configured}-${Math.random()}.json`);
		await saveConfig({ ...defaultConfig(), alephBackup: { configured } }, configPath);
		/** @type {string[]} */ const printed = [];
		/** @type {string[]} */ const logged = [];
		const bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			alephBackupKeychain: memoryKeychain(key, 'aleph-backup'),
			alephApi: aleph.url,
			alephIngestUrl: `${aleph.url}/api/v0/add`,
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logged.push(l)
		});
		const port = bridge.address.port;
		const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
		const paired = await request(port, '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code }
		});
		const auth = { origin: APP, authorization: `Bearer ${paired.json.token}` };
		return { bridge, port, auth, logged };
	}

	test('uploads the sealed bytes, has them kept by the own key, and logs no CID or address', async () => {
		const { bridge, port, auth, logged } = await bridgeWith({ configured: true });
		try {
			const health = await request(port, '/health', { headers: { origin: APP } });
			assert.deepEqual(health.json.backup, { aleph: true });

			const status = await request(port, '/backup/status', { headers: auth });
			assert.deepEqual(status.json, {
				aleph: { configured: true, address: addressOf(KEY), credits: 1_500_000 }
			});

			const bytes = new Uint8Array(randomBytes(4096));
			const res = await request(port, '/backup/aleph?name=belege-2026-10-02.car', {
				method: 'POST',
				headers: auth,
				body: bytes
			});
			assert.equal(res.status, 200, res.text);
			assert.equal(res.json.status, 'processed');
			assert.equal(res.json.size, 4096);
			assert.equal(res.json.address, addressOf(KEY));
			assert.match(res.json.itemHash, /^[0-9a-f]{64}$/);
			assert.deepEqual(aleph.added.get(res.json.cid), bytes, 'the bytes arrived as they were');
			const store = aleph.stores.at(-1);
			assert.deepEqual(store, {
				sender: addressOf(KEY),
				cid: res.json.cid,
				channel: BACKUP_CHANNEL,
				status: 'processed'
			});
			assert.ok(logged.some((l) => /backup: 4096 byte\(s\) to Aleph, processed/.test(l)));
			assert.ok(logged.every((l) => !l.includes(res.json.cid) && !l.includes(addressOf(KEY))));
		} finally {
			await bridge.close();
		}
	});

	test('refuses an odd name and an empty backup; says how to set it up when it is not', async () => {
		const { bridge, port, auth } = await bridgeWith({ configured: true });
		try {
			const odd = await request(port, '/backup/aleph?name=../etc', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array([1])
			});
			assert.equal(odd.status, 400);
			const empty = await request(port, '/backup/aleph', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array(0)
			});
			assert.equal(empty.status, 400);
		} finally {
			await bridge.close();
		}
		const off = await bridgeWith({ configured: false });
		try {
			assert.deepEqual((await request(off.port, '/backup/status', { headers: off.auth })).json, {
				aleph: { configured: false }
			});
			const res = await request(off.port, '/backup/aleph', {
				method: 'POST',
				headers: off.auth,
				body: new Uint8Array([1])
			});
			assert.equal(res.status, 503);
			assert.match(res.json.error, /setup:aleph/);
		} finally {
			await off.bridge.close();
		}
	});

	test('a keychain entry that is no key: 503 with the setup command, nothing uploaded', async () => {
		const before = aleph.added.size;
		const { bridge, port, auth } = await bridgeWith({ configured: true, key: 'kein schluessel' });
		try {
			const res = await request(port, '/backup/aleph', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array([1, 2])
			});
			assert.equal(res.status, 503);
			assert.equal(res.json.code, 'ALEPH_BACKUP_KEY');
			assert.equal(aleph.added.size, before);
		} finally {
			await bridge.close();
		}
	});

	test('the backup object alone: Aleph refusing the upload is an error, not a backup', async () => {
		const backup = createAlephBackup({
			getKey: async () => KEY,
			ingestUrl: `${aleph.url}/nowhere`,
			apiHost: aleph.url
		});
		await assert.rejects(backup.put(new Uint8Array([1]), { name: 'x.car' }), /404/);
	});
});

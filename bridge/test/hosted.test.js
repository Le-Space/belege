// The bridge in a confidential VM (#583, #584): its secrets come with the
// unlock into a directory (the attestation agent's tmpfs) and stay in memory;
// its node announces the VM's public WebSocket name; `--hosted` starts it so.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { base58 } from '@scure/base';

import { ANNOUNCE, defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { secretFileOf, unlockedKeychain } from '../src/keychain.js';
import { request } from './support/http.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
/** @type {string} */ let dir;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-hosted-'));
});
after(() => rm(dir, { recursive: true, force: true }));

test('a secret file is named after its account, in plain characters', () => {
	assert.equal(secretFileOf('imap'), 'imap');
	assert.equal(secretFileOf('aleph-backup'), 'aleph_backup');
	assert.equal(secretFileOf('portal:vodafone'), 'portal_vodafone');
	assert.equal(secretFileOf('bridge-auth'), 'bridge_auth');
});

test('the unlocked keychain reads what came with the unlock, and writes only to memory', async () => {
	const secrets = join(dir, 'secrets-a');
	await rm(secrets, { recursive: true, force: true });
	await import('node:fs/promises').then((fs) => fs.mkdir(secrets));
	await writeFile(join(secrets, 'imap'), 'not-a-real-password\n');

	const imap = unlockedKeychain({ dir: secrets, account: 'imap' });
	assert.equal(await imap.read(), 'not-a-real-password');

	await imap.write('changed-in-memory');
	assert.equal(await imap.read(), 'changed-in-memory');
	// Nothing went to the directory: the file is as it came.
	assert.equal(await readFile(join(secrets, 'imap'), 'utf8'), 'not-a-real-password\n');
	assert.deepEqual(await readdir(secrets), ['imap']);

	await imap.remove?.();
	await assert.rejects(imap.read(), { code: 'KEYCHAIN_MISSING' });
	assert.deepEqual(await readdir(secrets), ['imap']);
});

test('the unlocked keychain says what is missing, and refuses what is no secret', async () => {
	const secrets = join(dir, 'secrets-b');
	await import('node:fs/promises').then((fs) =>
		fs.mkdir(join(secrets, 'kraken'), { recursive: true })
	);
	await writeFile(join(secrets, 'paperless'), 'x'.repeat(64 * 1024 + 1));
	await writeFile(join(secrets, 'coingecko'), '\n');

	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'imap' }).read(), {
		code: 'KEYCHAIN_MISSING',
		message: /No mail password came with the unlock/
	});
	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'kraken' }).read(), {
		code: 'KEYCHAIN_DENIED'
	});
	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'paperless' }).read(), {
		code: 'KEYCHAIN_DENIED'
	});
	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'coingecko' }).read(), {
		code: 'KEYCHAIN_MISSING'
	});
	// No secret leaks into an error message.
	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'paperless' }).read(), (e) => {
		assert.doesNotMatch(String(/** @type {Error} */ (e).message), /xxxx/);
		return true;
	});
});

test('the unlocked keychain takes no account whose file another could share, and follows no link', async () => {
	const secrets = join(dir, 'secrets-c');
	const fs = await import('node:fs/promises');
	await fs.mkdir(secrets, { recursive: true });
	await writeFile(join(secrets, 'portal_local_shop'), 'made-up');
	await writeFile(join(dir, 'outside'), 'made-up');
	await fs.symlink(join(dir, 'outside'), join(secrets, 'imap'));

	assert.equal(
		await unlockedKeychain({ dir: secrets, account: 'portal:local-shop' }).read(),
		'made-up'
	);
	for (const account of [
		'portal:local_shop',
		'Imap',
		'portal-local:shop',
		'portal_x',
		'a__b',
		''
	]) {
		assert.throws(
			() => unlockedKeychain({ dir: secrets, account }),
			{ code: 'KEYCHAIN_DENIED' },
			account
		);
	}
	await assert.rejects(unlockedKeychain({ dir: secrets, account: 'imap' }).read(), {
		code: 'KEYCHAIN_DENIED'
	});
});

test('only a public TLS WebSocket name is announced', async () => {
	for (const ok of [
		'/dns4/abc123.2n6.me/tcp/443/tls/ws',
		'/dns/bridge.example.com/tcp/8443/tls/ws'
	]) {
		assert.match(ok, ANNOUNCE, ok);
	}
	for (const bad of [
		'/ip4/10.0.0.1/tcp/443/tls/ws',
		'/dns4/localhost/tcp/443/tls/ws',
		'/dns4/abc.2n6.me/tcp/443/ws',
		'/dns4/abc.2n6.me/tcp/443/tls/ws/p2p-circuit',
		'/dns4/abc.2n6.me/tcp/0/tls/ws',
		'/dns4/-abc.2n6.me/tcp/443/tls/ws',
		'/dns4/ABC.2n6.me/tcp/443/tls/ws'
	]) {
		assert.doesNotMatch(bad, ANNOUNCE, bad);
	}
	const configPath = join(dir, 'announce.json');
	await writeFile(
		configPath,
		JSON.stringify({
			node: { announce: ['/dns4/abc123.2n6.me/tcp/443/tls/ws', '/ip4/192.168.1.2/tcp/1/ws', 7] }
		})
	);
	assert.deepEqual((await loadConfig(configPath)).node.announce, [
		'/dns4/abc123.2n6.me/tcp/443/tls/ws'
	]);
	assert.deepEqual(defaultConfig().node.announce, []);
});

/** @param {string[]} args @param {Record<string, string>} env */
function run(args, env = {}) {
	const child = spawn(process.execPath, [CLI, ...args], {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (d) => (stdout += d));
	child.stderr.on('data', (d) => (stderr += d));
	const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
	return { child, exited, out: () => stdout, err: () => stderr };
}

/** @param {() => string} read @param {RegExp} pattern */
async function waitFor(read, pattern, timeoutMs = 15_000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const m = pattern.exec(read());
		if (m) return m;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`timed out waiting for ${pattern}\n${read()}`);
}

test('--hosted and --test-mode exclude each other', async () => {
	const { exited, err } = run(['--hosted', '--test-mode', '--config', join(dir, 'x.json')]);
	assert.equal(await exited, 1);
	assert.match(err(), /exclude each other/);
});

test('--hosted starts unarmed with no secrets, and announces the VM’s name', async () => {
	const secrets = join(dir, 'secrets-empty');
	await import('node:fs/promises').then((fs) => fs.mkdir(secrets, { recursive: true }));
	const configPath = join(dir, 'hosted', 'bridge.json');
	const config = defaultConfig();
	config.bridge.port = 0;
	config.node.announce = ['/dns4/abc123.2n6.me/tcp/443/tls/ws'];
	await saveConfig(config, configPath);
	const bridge = run(['--hosted', '--config', configPath], {
		BELEGE_BRIDGE_SECRETS_DIR: secrets,
		// Never the machine's keychain: a stray read would fail loudly here.
		PATH: '/nonexistent'
	});
	try {
		await waitFor(bridge.err, /HOSTED: secrets from the unlock/);
		const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
		// The HTTP API listens before the node has started: wait for its addresses.
		let health = await request(Number(port), '/health');
		for (let i = 0; i < 100 && !health.json?.node?.addrs?.length; i += 1) {
			await new Promise((r) => setTimeout(r, 50));
			health = await request(Number(port), '/health');
		}
		assert.equal(health.status, 200);
		assert.equal(health.json.node.enabled, true);
		assert.equal(health.json.node.armed, false);
		assert.ok(
			health.json.node.addrs.some((/** @type {string} */ a) =>
				a.startsWith('/dns4/abc123.2n6.me/tcp/443/tls/ws/p2p/12D3KooW')
			),
			JSON.stringify(health.json.node.addrs)
		);
		// Unarmed, but neither an invitation nor a pairing code goes into the host's log (#585).
		await waitFor(bridge.out, /no invitation in the log/);
		assert.doesNotMatch(bridge.out(), /web\+ucep:pair\?|Pairing code/);
		// The node key's hash, for a TEE quote: SHA-256 of the key the peer id carries.
		// An Ed25519 peer id is an identity multihash: 0x00, length, the key's protobuf.
		const multihash = base58.decode(health.json.node.peerId);
		assert.equal(multihash[0], 0);
		const expected = createHash('sha256').update(multihash.slice(2)).digest('hex');
		assert.equal(
			(await readFile(join(dir, 'hosted', 'node', 'public-key.sha256'), 'utf8')).trim(),
			expected
		);
		// Nothing secret was written next to the config.
		assert.deepEqual(await readdir(secrets), []);
	} finally {
		bridge.child.kill('SIGTERM');
		await bridge.exited;
	}
});

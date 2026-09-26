// The real CLI as a process, in test mode: it prints a pairing code, and the
// code pairs.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '../src/config.js';
import { request } from './support/http.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
/** @type {string} */ let dir;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-cli-'));
});
after(() => rm(dir, { recursive: true, force: true }));

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
async function waitFor(read, pattern, timeoutMs = 10_000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const m = pattern.exec(read());
		if (m) return m;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`timed out waiting for ${pattern}\n${read()}`);
}

test('test mode refuses the real config file', async () => {
	const { exited, err } = run(['--test-mode'], { BELEGE_BRIDGE_CONFIG: '', HOME: dir });
	// HOME=dir makes the default path dir/.config/belege/bridge.json, which is the "real" one.
	assert.equal(await exited, 1);
	assert.match(err(), /refuses the real config/);
});

test('prints a pairing code on start, and the code pairs', async () => {
	const configPath = join(dir, 'bridge.json');
	await saveConfig({ ...defaultConfig(), bridge: { port: 0 } }, configPath);
	const bridge = run(['--test-mode', '--config', configPath, '--port', '0']);
	try {
		const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
		const [, code] = await waitFor(bridge.out, /Pairing code[^:]*: (\S+)/);
		const res = await request(Number(port), '/pair', { method: 'POST', body: { code } });
		assert.equal(res.status, 200);
		assert.match(res.json.token, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(bridge.out().includes(res.json.token), false, 'the token is not printed');
		assert.equal(bridge.err().includes(res.json.token), false);
	} finally {
		bridge.child.kill('SIGTERM');
		await bridge.exited;
	}
});

test('test mode: mail and LLM secrets from the environment; /health says both are set up', async () => {
	const configPath = join(dir, 'bridge-mail.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: 0 },
			mail: { ...defaultConfig().mail, host: '127.0.0.1', port: 1, user: 'u', tls: 'none' },
			llm: { ...defaultConfig().llm, baseUrl: 'http://127.0.0.1:1', configured: true }
		},
		configPath
	);
	const bridge = run(['--test-mode', '--config', configPath, '--port', '0'], {
		BELEGE_BRIDGE_TEST_IMAP_PASSWORD: 'x',
		BELEGE_BRIDGE_TEST_LLM_KEY: 'y'
	});
	try {
		const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
		const res = await request(Number(port), '/health');
		assert.deepEqual(res.json.mail, {
			configured: true,
			accountingAddress: 'buchhaltung@le-space.de'
		});
		assert.deepEqual(res.json.llm, {
			configured: true,
			models: ['deepseek-flash', 'deepseek-v4-pro']
		});
	} finally {
		bridge.child.kill('SIGTERM');
		await bridge.exited;
	}
});

test('test mode: the Kraken key comes from the environment, never from the macOS keychain', async () => {
	const { FAKE_KRAKEN_KEY, FAKE_KRAKEN_SECRET, startFakeKraken } = await import(
		'./support/fake-kraken.js'
	);
	const kraken = await startFakeKraken();
	const configPath = join(dir, 'bridge-kraken.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: 0 }, kraken: { configured: true, baseUrl: kraken.url } },
		configPath
	);
	const bridge = run(['--test-mode', '--config', configPath, '--port', '0'], {
		BELEGE_BRIDGE_TEST_KRAKEN_KEY: JSON.stringify({
			key: FAKE_KRAKEN_KEY,
			secret: FAKE_KRAKEN_SECRET
		})
	});
	try {
		const [, port] = await waitFor(bridge.out, /listening on http:\/\/127\.0\.0\.1:(\d+)/);
		const [, code] = await waitFor(bridge.out, /Pairing code[^:]*: (\S+)/);
		const { json } = await request(Number(port), '/pair', { method: 'POST', body: { code } });
		const res = await request(Number(port), '/kraken/balances', {
			headers: { authorization: `Bearer ${json.token}` }
		});
		assert.equal(res.status, 200, JSON.stringify(res.json));
		assert.ok(res.json.balances.length > 0);
		assert.ok(kraken.calls.some((c) => c.method === 'Balance'));
	} finally {
		bridge.child.kill('SIGTERM');
		await bridge.exited;
		await kraken.close();
	}
});

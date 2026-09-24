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

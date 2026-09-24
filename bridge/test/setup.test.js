// The setup CLI's logic, with scripted answers and a fake keychain.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSetup } from '../src/setup-hibiscus.js';
import { memoryKeychain } from '../src/keychain.js';
import { FAKE_PASSWORD, startFakeHibiscus } from './support/fake-hibiscus.js';

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {string} */ let dir;

before(async () => {
	hibiscus = await startFakeHibiscus();
	dir = await mkdtemp(join(tmpdir(), 'belege-setup-'));
});
after(async () => {
	await hibiscus?.close();
	await rm(dir, { recursive: true, force: true });
});

/** @param {string[]} answers @param {string} hidden */
function scripted(answers, hidden) {
	/** @type {string[]} */ const out = [];
	/** @type {string[]} */ const hiddenQuestions = [];
	return {
		out,
		hiddenQuestions,
		io: {
			ask: async (/** @type {string} */ q) => {
				out.push(q);
				return answers.shift() ?? '';
			},
			askHidden: async (/** @type {string} */ q) => {
				hiddenQuestions.push(q);
				return hidden;
			},
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

test('declining the fingerprint stores nothing and asks for no password', async () => {
	const configPath = join(dir, 'declined.json');
	const keychain = memoryKeychain();
	const { io, out, hiddenQuestions } = scripted(
		['127.0.0.1', String(hibiscus.port), 'n'],
		FAKE_PASSWORD
	);

	assert.equal(await runSetup({ io, keychain, configPath }), false);
	assert.ok(
		out.some((l) => l.includes(hibiscus.fingerprint)),
		'the fingerprint was shown'
	);
	assert.deepEqual(hiddenQuestions, []);
	await assert.rejects(keychain.read());
	await assert.rejects(stat(configPath));
	assert.equal(hibiscus.requests.length, 0);
});

test('a host other than loopback is refused', async () => {
	const { io } = scripted(['192.168.1.20'], FAKE_PASSWORD);
	assert.equal(
		await runSetup({ io, keychain: memoryKeychain(), configPath: join(dir, 'lan.json') }),
		false
	);
});

test('confirming pins the fingerprint, stores the password in the keychain, the rest in a 0600 file', async () => {
	const configPath = join(dir, 'bridge.json');
	const keychain = memoryKeychain();
	const { io, out } = scripted(
		[
			'127.0.0.1',
			String(hibiscus.port),
			'ja',
			'4711',
			'http://localhost:5173,http://localhost:4391',
			'y'
		],
		FAKE_PASSWORD
	);

	assert.equal(await runSetup({ io, keychain, configPath }), true);
	assert.equal(await keychain.read(), FAKE_PASSWORD);
	const text = await readFile(configPath, 'utf8');
	assert.equal(text.includes(FAKE_PASSWORD), false);
	const config = JSON.parse(text);
	assert.equal(config.hibiscus.certSha256, hibiscus.fingerprint);
	assert.deepEqual(config.hibiscus.ibanSuffixes, ['4711']);
	assert.deepEqual(config.appOrigins, ['http://localhost:5173', 'http://localhost:4391']);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	// The test call: two accounts in Hibiscus, one allowed, shown masked.
	assert.ok(out.includes('2 account(s) in Hibiscus, 1 allowed:'));
	assert.ok(out.includes('  DE00 **** 4711'));
	assert.equal(
		out.some((l) => l.includes('9999')),
		false
	);
});

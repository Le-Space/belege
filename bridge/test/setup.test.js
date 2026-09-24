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

/** @param {string[]} answers @param {string | string[]} hidden one answer for every hidden prompt, or one per prompt */
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
				return Array.isArray(hidden) ? (hidden.shift() ?? '') : hidden;
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

const answersUpToPassword = () => ['127.0.0.1', String(hibiscus.port), 'y', '4711', ''];

test('first run: Enter does not pretend to keep a password – it asks again', async () => {
	const keychain = memoryKeychain();
	const { io, out, hiddenQuestions } = scripted(
		[...answersUpToPassword(), 'n'],
		['', FAKE_PASSWORD]
	);
	assert.equal(await runSetup({ io, keychain, configPath: join(dir, 'first.json') }), true);
	assert.equal(await keychain.read(), FAKE_PASSWORD);
	assert.equal(hiddenQuestions.length, 2);
	assert.match(hiddenQuestions[0], /none is stored yet/);
	assert.ok(out.some((l) => l.includes('cannot be kept')));
});

test('first run: three empty answers store nothing and save no config', async () => {
	const keychain = memoryKeychain();
	const configPath = join(dir, 'empty.json');
	const { io } = scripted(answersUpToPassword(), ['', '', '']);
	assert.equal(await runSetup({ io, keychain, configPath }), false);
	await assert.rejects(keychain.read());
	await assert.rejects(readFile(configPath, 'utf8'));
});

test('a stored password is kept on Enter', async () => {
	const keychain = memoryKeychain(FAKE_PASSWORD);
	const { io, out, hiddenQuestions } = scripted([...answersUpToPassword(), 'n'], '');
	assert.equal(await runSetup({ io, keychain, configPath: join(dir, 'keep.json') }), true);
	assert.equal(hiddenQuestions.length, 1);
	assert.match(hiddenQuestions[0], /empty keeps the stored one/);
	assert.ok(out.includes('Keeping the password already in the keychain.'));
});

test('first run with HIBISCUS_PASSWORD in .env: offered, stored, and no prompt for it', async () => {
	const keychain = memoryKeychain();
	const { io, out, hiddenQuestions } = scripted([...answersUpToPassword(), '', 'n'], 'unused');
	assert.equal(
		await runSetup({ io, keychain, configPath: join(dir, 'env.json'), envPassword: FAKE_PASSWORD }),
		true
	);
	assert.equal(await keychain.read(), FAKE_PASSWORD);
	assert.equal(hiddenQuestions.length, 0);
	assert.ok(out.some((l) => l.includes('delete HIBISCUS_PASSWORD from .env')));
});

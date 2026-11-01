// setup:mail and setup:llm, with scripted answers, a fake keychain and a
// fake IMAP server for the test login.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMailSetup } from '../src/setup-mail.js';
import { runLlmSetup } from '../src/setup-llm.js';
import { memoryKeychain } from '../src/keychain.js';
import { loadConfig } from '../src/config.js';
import { FAKE_IMAP_PASSWORD, startFakeImap } from './support/fake-imap.js';

/** @type {string} */ let dir;
/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-setup-mail-'));
	imap = await startFakeImap();
});
after(async () => {
	await imap?.close();
	await rm(dir, { recursive: true, force: true });
});

/** @param {string[]} answers @param {string[]} hidden */
function scripted(answers, hidden = []) {
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
				return hidden.shift() ?? '';
			},
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

test('setup:mail stores host, user and the alias in a 0600 file, the token in the keychain, and logs in', async () => {
	const configPath = join(dir, 'mail.json');
	const keychain = memoryKeychain(null, 'imap');
	const { io, out, hiddenQuestions } = scripted(
		['127.0.0.1', String(imap.port), 'y', imap.user, '', '', 'y'],
		[FAKE_IMAP_PASSWORD]
	);
	assert.equal(await runMailSetup({ io, keychain, configPath }), true);
	assert.equal(await keychain.read(), FAKE_IMAP_PASSWORD);
	assert.match(hiddenQuestions[0], /none is stored yet/);
	const text = await readFile(configPath, 'utf8');
	assert.equal(text.includes(FAKE_IMAP_PASSWORD), false);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	const { mail } = await loadConfig(configPath);
	assert.deepEqual(
		{
			host: mail.host,
			port: mail.port,
			user: mail.user,
			tls: mail.tls,
			address: mail.accountingAddress,
			authServId: mail.authServId
		},
		{
			host: '127.0.0.1',
			port: imap.port,
			user: imap.user,
			tls: 'none',
			address: 'buchhaltung@le-space.de',
			authServId: '127.0.0.1' // defaults to the IMAP host: Mailu names itself after it
		}
	);
	assert.ok(
		out.some((l) => /^Logged in: \d+ folder\(s\)/.test(l)),
		out.join('\n')
	);
});

test('setup:mail offers IMAP_* from .env: defaults, and the password without a prompt', async () => {
	const configPath = join(dir, 'mail-env.json');
	const keychain = memoryKeychain(null, 'imap');
	const env = {
		IMAP_HOST: 'mail.example',
		IMAP_PORT: '993',
		IMAP_USER: 'inhaber@firma.example',
		IMAP_PASSWORD: 'env-imap-token',
		IMAP_ACCOUNTING_ADDRESS: 'belege@firma.example'
	};
	// Enter for every default, Enter (yes) for the .env password, no test login.
	const { io, out, hiddenQuestions } = scripted(['', '', '', '', '', 'n']);
	assert.equal(await runMailSetup({ io, keychain, configPath, env }), true);
	assert.equal(await keychain.read(), 'env-imap-token');
	assert.equal(hiddenQuestions.length, 0);
	assert.ok(out.some((l) => l.includes('delete IMAP_PASSWORD from .env')));
	const { mail } = await loadConfig(configPath);
	assert.deepEqual(
		[mail.host, mail.port, mail.tls, mail.user, mail.accountingAddress],
		['mail.example', 993, 'implicit', 'inhaber@firma.example', 'belege@firma.example']
	);
	assert.equal((await readFile(configPath, 'utf8')).includes('env-imap-token'), false);
});

test('setup:mail: no TLS is not even offered for another host; a stored token is kept on Enter', async () => {
	const configPath = join(dir, 'mail-keep.json');
	const keychain = memoryKeychain('stored-token', 'imap');
	const { io, out, hiddenQuestions } = scripted(
		['mail.example', '143', 'u@firma.example', '', 'n'],
		['']
	);
	assert.equal(await runMailSetup({ io, keychain, configPath }), true);
	assert.equal(await keychain.read(), 'stored-token');
	assert.match(hiddenQuestions[0], /empty keeps the stored one/);
	assert.equal(
		out.some((l) => l.includes('without TLS')),
		false
	);
	assert.equal((await loadConfig(configPath)).mail.tls, 'starttls');
});

test('setup:mail: a bad address, or no password on the first run, saves nothing', async () => {
	const bad = join(dir, 'mail-bad.json');
	const { io } = scripted(['mail.example', '993', 'u@firma.example', 'kein-at-zeichen']);
	assert.equal(
		await runMailSetup({ io, keychain: memoryKeychain(null, 'imap'), configPath: bad }),
		false
	);
	await assert.rejects(stat(bad));

	const empty = join(dir, 'mail-empty.json');
	const keychain = memoryKeychain(null, 'imap');
	const second = scripted(['mail.example', '993', 'u@firma.example', ''], ['', '', '']);
	assert.equal(await runMailSetup({ io: second.io, keychain, configPath: empty }), false);
	await assert.rejects(keychain.read());
	await assert.rejects(stat(empty));
});

test('setup:llm stores URL, models and terms, the key in the keychain; DEEPSEEK_* from .env', async () => {
	const configPath = join(dir, 'llm.json');
	const keychain = memoryKeychain(null, 'llm');
	const env = {
		DEEPSEEK_API_KEY: 'sk-env-key',
		DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
		DEEPSEEK_MODEL: 'deepseek-flash',
		REDACT_TERMS: 'Erika Beispiel; Beispiel ;x'
	};
	const { io, hiddenQuestions } = scripted(['', '', '', '', '']);
	assert.equal(await runLlmSetup({ io, keychain, configPath, env }), true);
	assert.equal(await keychain.read(), 'sk-env-key');
	assert.equal(hiddenQuestions.length, 0);
	const text = await readFile(configPath, 'utf8');
	assert.equal(text.includes('sk-env-key'), false);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	const { llm } = await loadConfig(configPath);
	assert.deepEqual(llm, {
		baseUrl: 'https://api.deepseek.com',
		model: 'deepseek-flash',
		retryModel: 'deepseek-v4-pro',
		redactTerms: ['Erika Beispiel', 'Beispiel'],
		configured: true
	});
});

test('setup:llm: a key from the hidden prompt; "-" clears the terms; http is refused', async () => {
	const configPath = join(dir, 'llm-prompt.json');
	const keychain = memoryKeychain(null, 'llm');
	const { io } = scripted(['', 'other-flash', 'other-pro', '-'], ['sk-typed']);
	assert.equal(await runLlmSetup({ io, keychain, configPath }), true);
	assert.equal(await keychain.read(), 'sk-typed');
	const { llm } = await loadConfig(configPath);
	assert.deepEqual([llm.model, llm.retryModel, llm.redactTerms], ['other-flash', 'other-pro', []]);

	const refused = scripted(['http://api.example']);
	assert.equal(
		await runLlmSetup({ io: refused.io, keychain, configPath: join(dir, 'llm-http.json') }),
		false
	);
	assert.ok(refused.out.some((l) => l.includes('without https')));
	await assert.rejects(stat(join(dir, 'llm-http.json')));
});

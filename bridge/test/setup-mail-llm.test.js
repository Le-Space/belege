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
	const { io, hiddenQuestions } = scripted(['', '', '', '', '', '']);
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
		redaction: 'on',
		configured: true,
		tee: null
	});
});

test('setup:llm: a model on this machine is asked about once, and then not blacked out (#423)', async () => {
	const keychain = memoryKeychain('sk-kept', 'llm');
	const local = scripted(['1', 'http://127.0.0.1:11434/v1', 'qwen3:8b', 'qwen3:8b', '']);
	const localPath = join(dir, 'llm-local.json');
	assert.equal(await runLlmSetup({ io: local.io, keychain, configPath: localPath }), true);
	assert.equal((await loadConfig(localPath)).llm.redaction, 'off');
	assert.ok(local.out.some((l) => /Does the model run on this machine itself/.test(l)));
	assert.equal(
		local.out.some((l) => /^Terms/.test(l)),
		false,
		'no terms asked when nothing is blacked out'
	);

	// A proxy on 127.0.0.1 that forwards to a provider: blacked out.
	const proxy = scripted(['1', 'http://127.0.0.1:4000/v1', 'm', 'm', 'n', '-']);
	const proxyPath = join(dir, 'llm-proxy.json');
	assert.equal(await runLlmSetup({ io: proxy.io, keychain, configPath: proxyPath }), true);
	assert.equal((await loadConfig(proxyPath)).llm.redaction, 'on');

	// A provider elsewhere is never asked.
	const remote = scripted(['1', 'https://api.deepseek.com', '', '', '-']);
	const remotePath = join(dir, 'llm-remote.json');
	assert.equal(await runLlmSetup({ io: remote.io, keychain, configPath: remotePath }), true);
	assert.equal((await loadConfig(remotePath)).llm.redaction, 'on');
	assert.equal(
		remote.out.some((l) => /on this machine itself/.test(l)),
		false
	);
});

test('setup:llm: a key from the hidden prompt; "-" clears the terms; http is refused', async () => {
	const configPath = join(dir, 'llm-prompt.json');
	const keychain = memoryKeychain(null, 'llm');
	const { io } = scripted(['', '', 'other-flash', 'other-pro', '-'], ['sk-typed']);
	assert.equal(await runLlmSetup({ io, keychain, configPath }), true);
	assert.equal(await keychain.read(), 'sk-typed');
	const { llm } = await loadConfig(configPath);
	assert.deepEqual([llm.model, llm.retryModel, llm.redactTerms], ['other-flash', 'other-pro', []]);

	const refused = scripted(['', 'http://api.example']);
	assert.equal(
		await runLlmSetup({ io: refused.io, keychain, configPath: join(dir, 'llm-http.json') }),
		false
	);
	assert.ok(refused.out.some((l) => l.includes('without https')));
	await assert.rejects(stat(join(dir, 'llm-http.json')));
});

test('setup:llm: LibertAI confidential – the enclave verified, shown and pinned; a new one only on a yes (#416)', async () => {
	const configPath = join(dir, 'llm-tee.json');
	const keychain = memoryKeychain(null, 'llm');
	const pinOf = (/** @type {string} */ hash, /** @type {string} */ measurement) => ({
		provider: /** @type {const} */ ('libertai'),
		itemHash: hash.repeat(64).slice(0, 64),
		measurement: measurement.repeat(96).slice(0, 96),
		sourceCommit: '8cd7b12',
		pinnedAt: '2026-10-23T10:00:00.000Z'
	});
	/** @type {string[]} */ const asked = [];
	// Blacking out is asked; here the person wants it anyway, with a term.
	const first = scripted(['2', '', '', 'y', 'Erika Beispiel'], ['lt-made-up-key']);
	assert.equal(
		await runLlmSetup({
			io: first.io,
			keychain,
			configPath,
			findDeployment: async (model) => (asked.push(model), pinOf('a', 'b'))
		}),
		true
	);
	assert.deepEqual(asked, ['qwen3.8-27b-tee']);
	assert.ok(first.out.some((l) => /Verified: deployment a{64}/.test(l)));
	assert.ok(first.out.some((l) => /source commit 8cd7b12/.test(l)));
	assert.equal(await keychain.read(), 'lt-made-up-key');
	const { llm } = await loadConfig(configPath);
	assert.deepEqual(llm, {
		baseUrl: 'https://api.libertai.io/v1',
		model: 'qwen3.8-27b-tee',
		retryModel: 'qwen3.8-27b-tee',
		redactTerms: ['Erika Beispiel'],
		redaction: 'on',
		configured: true,
		tee: pinOf('a', 'b')
	});
	assert.equal((await readFile(configPath, 'utf8')).includes('lt-made-up-key'), false);

	// LibertAI replaced the deployment: shown beside the old pin, and not taken without a yes.
	const declined = scripted(['', '', '']);
	assert.equal(
		await runLlmSetup({
			io: declined.io,
			keychain,
			configPath,
			findDeployment: async () => pinOf('c', 'd')
		}),
		false
	);
	assert.ok(declined.out.some((l) => /The pinned deployment was a{64}/.test(l)));
	assert.equal((await loadConfig(configPath)).llm.tee?.itemHash, 'a'.repeat(64));
	// The default: nothing blacked out in the enclave.
	const taken = scripted(['', '', 'y', ''], ['']);
	assert.equal(
		await runLlmSetup({
			io: taken.io,
			keychain,
			configPath,
			findDeployment: async () => pinOf('c', 'd')
		}),
		true
	);
	assert.equal((await loadConfig(configPath)).llm.tee?.itemHash, 'c'.repeat(64));
	assert.equal((await loadConfig(configPath)).llm.redaction, 'off');
	assert.deepEqual(
		(await loadConfig(configPath)).llm.redactTerms,
		['Erika Beispiel'],
		'kept for later'
	);
	assert.ok(taken.out.some((l) => /Nothing is blacked out/.test(l)));

	// An enclave that fails its proof: nothing saved.
	const failing = scripted(['2', '']);
	assert.equal(
		await runLlmSetup({
			io: failing.io,
			keychain,
			configPath: join(dir, 'llm-tee-failed.json'),
			findDeployment: async () => {
				throw Object.assign(new Error("The model's enclave could not be verified: bad report"), {
					code: 'LLM_ATTESTATION_FAILED'
				});
			}
		}),
		false
	);
	await assert.rejects(stat(join(dir, 'llm-tee-failed.json')));
	// Back to a URL: the pin goes.
	const back = scripted(
		['1', 'https://api.deepseek.com', 'deepseek-flash', 'deepseek-v4-pro', '-'],
		['']
	);
	assert.equal(await runLlmSetup({ io: back.io, keychain, configPath }), true);
	assert.equal((await loadConfig(configPath)).llm.tee, null);
});

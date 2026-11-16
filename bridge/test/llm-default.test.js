// The default language model is Ollama on this computer (2026-11-16); DeepSeek
// and other providers only on purpose, with their country; a config that has
// DeepSeek from the old default is asked once; a missing Ollama is said with
// what to do. Made-up config, a fake Ollama, a fake keychain.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	defaultConfig,
	loadConfig,
	OLLAMA_BASE_URL,
	OLLAMA_DEFAULT_MODEL,
	saveConfig,
	withDefaults
} from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { runLlmSetup } from '../src/setup-llm.js';
import { checkOllama, ollamaSteps } from '../src/llm/ollama.js';
import { isOllamaUrl, providerLabel, providerOf } from '../src/llm/providers.js';
import {
	createLlmChoice,
	keepCloud,
	needsDefaultQuestion,
	switchToLocal
} from '../src/llm/default-choice.js';
import { createCommands } from '../src/commands.js';

/** @type {string} */ let dir;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-llm-default-'));
});
after(async () => {
	await rm(dir, { recursive: true, force: true });
});

/** A DeepSeek setup as the old default left it: configured, never chosen on purpose. */
const oldDeepSeek = () => ({
	...defaultConfig().llm,
	baseUrl: 'https://api.deepseek.com',
	model: 'deepseek-flash',
	retryModel: 'deepseek-v4-pro',
	redactTerms: ['Erika Beispiel'],
	redaction: /** @type {const} */ ('on'),
	configured: true
});

/** @param {string[]} answers @param {string[]} [hidden] */
function scripted(answers, hidden = []) {
	/** @type {string[]} */ const out = [];
	/** @type {string[]} */ const asked = [];
	return {
		out,
		asked,
		io: {
			ask: async (/** @type {string} */ q) => (asked.push(q), out.push(q), answers.shift() ?? ''),
			askHidden: async (/** @type {string} */ q) => (asked.push(q), hidden.shift() ?? ''),
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

/** A fake Ollama: `GET /api/tags` with these models, or nothing answering. @param {string[] | null} models */
const fakeOllama = (models) => /** @type {typeof fetch} */ async (url) => {
	if (models === null) throw new TypeError('fetch failed');
	assert.match(String(url), /^http:\/\/127\.0\.0\.1:11434\/api\/tags$/);
	return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
		headers: { 'content-type': 'application/json' }
	});
};

test('the default model is Ollama on this computer, a small one, not set up until setup:llm', () => {
	const { llm } = defaultConfig();
	assert.equal(llm.baseUrl, 'http://127.0.0.1:11434/v1');
	assert.equal(llm.model, 'qwen3:4b-instruct-2507-q4_K_M');
	assert.equal(llm.retryModel, llm.model);
	assert.equal(llm.configured, false);
	assert.equal(llm.redaction, 'auto', 'blacked out until setup:llm is told the model runs here');
	assert.equal(llm.cloudOnPurpose, null);
	assert.ok(isOllamaUrl(llm.baseUrl));
	assert.equal(providerOf(llm.baseUrl).local, true);
});

test('a config never set up that still holds the old DeepSeek default gets Ollama; a set-up DeepSeek stays', () => {
	const unset = withDefaults({
		llm: {
			baseUrl: 'https://api.deepseek.com',
			model: 'deepseek-flash',
			retryModel: 'deepseek-v4-pro',
			redactTerms: [],
			redaction: 'auto',
			configured: false,
			tee: null
		}
	});
	assert.equal(unset.llm.baseUrl, OLLAMA_BASE_URL);
	assert.equal(unset.llm.model, OLLAMA_DEFAULT_MODEL);

	const set = withDefaults({ llm: oldDeepSeek() });
	assert.equal(set.llm.baseUrl, 'https://api.deepseek.com', 'never switched silently');
	assert.equal(set.llm.model, 'deepseek-flash');
	assert.equal(set.llm.cloudOnPurpose, null);
	assert.equal(withDefaults({ llm: { cloudOnPurpose: 42 } }).llm.cloudOnPurpose, null);
});

test('providers: name and country, a model here says so', () => {
	assert.equal(providerLabel(providerOf('https://api.deepseek.com')), 'DeepSeek – China');
	assert.equal(providerOf('https://api.deepseek.com').country, 'CN');
	assert.equal(providerLabel(providerOf('https://api.openai.com/v1')), 'OpenAI – United States');
	assert.equal(providerLabel(providerOf('https://api.mistral.ai/v1')), 'Mistral AI – France');
	assert.equal(
		providerLabel(providerOf('https://llm.example.com/v1')),
		'llm.example.com – country unknown'
	);
	assert.equal(providerLabel(providerOf(OLLAMA_BASE_URL)), 'Ollama (this computer)');
	assert.equal(providerOf('http://localhost:1234/v1').id, 'local');
	// LibertAI's confidential model stays as it is.
	assert.equal(providerLabel(providerOf('https://api.libertai.io/v1')), 'LibertAI');
});

test('the old-default question: only for DeepSeek, set up, not in an enclave, not chosen on purpose', () => {
	assert.equal(needsDefaultQuestion(oldDeepSeek()), true);
	assert.equal(needsDefaultQuestion({ ...oldDeepSeek(), configured: false }), false);
	assert.equal(
		needsDefaultQuestion(keepCloud(oldDeepSeek(), '2026-11-16T10:00:00.000Z')),
		false,
		'asked once'
	);
	assert.equal(needsDefaultQuestion(defaultConfig().llm), false);
	assert.equal(
		needsDefaultQuestion({ ...oldDeepSeek(), baseUrl: 'https://api.openai.com/v1' }),
		false
	);

	const local = switchToLocal(oldDeepSeek());
	assert.equal(local.baseUrl, OLLAMA_BASE_URL);
	assert.equal(local.model, OLLAMA_DEFAULT_MODEL);
	assert.equal(local.configured, true);
	assert.equal(local.redaction, 'auto', 'redaction stays on until setup:llm is told');
	assert.deepEqual(local.redactTerms, ['Erika Beispiel'], 'terms kept');
	assert.equal(needsDefaultQuestion(local), false);
});

test('Ollama missing: not running, the model not pulled, or there – with the steps to take', async () => {
	const base = { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_DEFAULT_MODEL };
	const down = await checkOllama({ ...base, fetch: fakeOllama(null) });
	assert.equal(down.state, 'unreachable');
	const steps = ollamaSteps(down).join('\n');
	assert.match(steps, /not installed or not running/);
	assert.match(steps, /ollama\.com\/download/);
	assert.match(steps, /ollama pull qwen3:4b-instruct-2507-q4_K_M/);
	assert.match(steps, /no model on the internet is used instead/);

	const noModel = await checkOllama({ ...base, fetch: fakeOllama(['other-model:7b']) });
	assert.equal(noModel.state, 'model-missing');
	assert.match(ollamaSteps(noModel).join('\n'), /ollama pull qwen3:4b-instruct-2507-q4_K_M/);

	const ok = await checkOllama({ ...base, fetch: fakeOllama([OLLAMA_DEFAULT_MODEL]) });
	assert.equal(ok.state, 'running');
	assert.deepEqual(ollamaSteps(ok), []);
	// A name without a tag is Ollama's `:latest`.
	const latest = await checkOllama({
		baseUrl: OLLAMA_BASE_URL,
		model: 'made-up',
		fetch: fakeOllama(['made-up:latest'])
	});
	assert.equal(latest.state, 'running');
});

test('setup:llm: Enter everywhere sets up Ollama, asks no key, and says when Ollama is missing', async () => {
	const configPath = join(dir, 'fresh.json');
	const keychain = memoryKeychain(null, 'llm');
	const { io, out, asked } = scripted([]);
	const saved = await runLlmSetup({
		io,
		keychain,
		configPath,
		checkOllama: async ({ model }) => ({ state: 'unreachable', model })
	});
	assert.equal(saved, true);
	const { llm } = await loadConfig(configPath);
	assert.equal(llm.baseUrl, OLLAMA_BASE_URL);
	assert.equal(llm.model, OLLAMA_DEFAULT_MODEL);
	assert.equal(llm.configured, true);
	assert.equal(llm.cloudOnPurpose, null);
	assert.equal(
		asked.some((q) => /API key/.test(q)),
		false,
		'no key for a model here'
	);
	await assert.rejects(keychain.read(), 'nothing stored');
	assert.ok(out.some((l) => /not installed or not running/.test(l)));
	assert.ok(out.some((l) => /ollama pull qwen3:4b-instruct-2507-q4_K_M/.test(l)));
});

test('setup:llm: a provider on the internet only on purpose – typed, shown with its country, confirmed', async () => {
	const keychain = memoryKeychain(null, 'llm');
	// No URL typed: nothing saved.
	const none = scripted(['3', '']);
	const nonePath = join(dir, 'cloud-none.json');
	assert.equal(await runLlmSetup({ io: none.io, keychain, configPath: nonePath }), false);
	await assert.rejects(stat(nonePath));

	// Typed, but not confirmed: nothing saved.
	const no = scripted(['3', 'https://api.deepseek.com', 'n']);
	const noPath = join(dir, 'cloud-no.json');
	assert.equal(await runLlmSetup({ io: no.io, keychain, configPath: noPath }), false);
	assert.ok(no.out.some((l) => /DeepSeek – China/.test(l)));
	await assert.rejects(stat(noPath));

	// Confirmed: saved, and remembered as chosen on purpose.
	const yes = scripted(['3', 'https://api.deepseek.com', 'y', '', '', '-'], ['sk-made-up']);
	const yesPath = join(dir, 'cloud-yes.json');
	assert.equal(
		await runLlmSetup({
			io: yes.io,
			keychain,
			configPath: yesPath,
			now: () => '2026-11-16T10:00:00.000Z'
		}),
		true
	);
	const { llm } = await loadConfig(yesPath);
	assert.equal(llm.baseUrl, 'https://api.deepseek.com');
	assert.deepEqual([llm.model, llm.retryModel], ['deepseek-flash', 'deepseek-v4-pro']);
	assert.equal(llm.redaction, 'on');
	assert.equal(llm.cloudOnPurpose, '2026-11-16T10:00:00.000Z');
	assert.equal(needsDefaultQuestion(llm), false);
});

test('setup:llm: DeepSeek from the old default is asked once – keep it on purpose, or switch', async () => {
	const keychain = memoryKeychain('sk-made-up', 'llm');
	// Keep: remembered in the config, and not asked again.
	const keepPath = join(dir, 'keep.json');
	await saveConfig({ ...defaultConfig(), llm: oldDeepSeek() }, keepPath);
	const keep = scripted(['n', '3', '', 'y', '', '', ''], ['']);
	assert.equal(
		await runLlmSetup({
			io: keep.io,
			keychain,
			configPath: keepPath,
			now: () => '2026-11-16T10:00:00.000Z'
		}),
		true
	);
	assert.ok(keep.out.some((l) => /was the default until now/.test(l)));
	const kept = (await loadConfig(keepPath)).llm;
	assert.equal(kept.baseUrl, 'https://api.deepseek.com');
	assert.equal(kept.cloudOnPurpose, '2026-11-16T10:00:00.000Z');
	const again = scripted(['3', '', 'y', '', '', ''], ['']);
	assert.equal(await runLlmSetup({ io: again.io, keychain, configPath: keepPath }), true);
	assert.equal(
		again.out.some((l) => /was the default until now/.test(l)),
		false,
		'asked once'
	);

	// Switch: straight to Ollama, the terms kept, nothing blacked out once it runs here.
	const switchPath = join(dir, 'switch.json');
	await saveConfig({ ...defaultConfig(), llm: oldDeepSeek() }, switchPath);
	const sw = scripted(['', '', '', '', '']);
	assert.equal(
		await runLlmSetup({
			io: sw.io,
			keychain,
			configPath: switchPath,
			checkOllama: async ({ model }) => ({ state: 'running', model })
		}),
		true
	);
	const switched = (await loadConfig(switchPath)).llm;
	assert.equal(switched.baseUrl, OLLAMA_BASE_URL);
	assert.equal(switched.model, OLLAMA_DEFAULT_MODEL);
	assert.deepEqual(switched.redactTerms, ['Erika Beispiel']);
	assert.ok(sw.out.some((l) => /Ollama runs and has/.test(l)));
	assert.equal(await keychain.read(), 'sk-made-up', 'the stored key stays for later');
});

test('/llm/status and /llm/choice: the question, the answer kept in the config, the switch after a restart', async () => {
	const config = { ...defaultConfig(), llm: oldDeepSeek() };
	let saves = 0;
	const llmChoice = createLlmChoice({
		config,
		save: async () => void saves++,
		now: () => '2026-11-16T10:00:00.000Z'
	});
	/** @param {any} [over] */
	const commandsWith = (over = {}) =>
		createCommands(
			/** @type {any} */ ({
				config,
				pairing: { isPaired: () => true, hasPendingCode: () => false },
				hibiscus: null,
				mail: null,
				llm: { lastRefusal: () => null, models: [] },
				llmKeyPresent: async () => true,
				llmTee: null,
				llmChoice,
				shares: { read: () => null, list: () => [], revoke: () => false },
				log: () => {},
				...over
			})
		);
	const commands = commandsWith();
	const by = (/** @type {string} */ name) =>
		/** @type {any} */ (commands.find((c) => c.name === name));
	const input = { query: new URLSearchParams(), params: {}, token: null };

	const before = (await by('llm.status').run({ ...input, body: {} })).json;
	assert.equal(before.defaultQuestion, true);
	assert.deepEqual(before.providerInfo, {
		id: 'deepseek',
		name: 'DeepSeek',
		country: 'CN',
		local: false
	});
	assert.equal(before.keyRequired, true);
	assert.equal(before.ollama, null);

	assert.equal(
		(await by('llm.choice').run({ ...input, body: { answer: 'cloud' } })).status,
		400,
		'only local or keep'
	);
	const answered = await by('llm.choice').run({ ...input, body: { answer: 'local' } });
	assert.equal(answered.status, 200);
	assert.deepEqual(answered.json, { answer: 'local', restartNeeded: true });
	assert.equal(saves, 1);
	assert.equal(config.llm.baseUrl, OLLAMA_BASE_URL);
	assert.equal(config.llm.redaction, 'auto');

	// Until the restart, the status says what calls still go to, and that a restart is due.
	const after = (await by('llm.status').run({ ...input, body: {} })).json;
	assert.equal(after.defaultQuestion, false);
	assert.equal(after.restartNeeded, true);
	assert.equal(after.providerInfo.id, 'deepseek');
	assert.equal(after.redaction.active, true);
	// Asked once.
	assert.equal((await by('llm.choice').run({ ...input, body: { answer: 'keep' } })).status, 409);

	// After the restart: Ollama, with what its check says.
	const restarted = commandsWith({
		llmOllama: async () => ({ state: 'unreachable', model: OLLAMA_DEFAULT_MODEL })
	});
	const status = (
		await /** @type {any} */ (restarted.find((c) => c.name === 'llm.status')).run({
			...input,
			body: {}
		})
	).json;
	assert.equal(status.providerInfo.id, 'ollama');
	assert.equal(status.keyRequired, false);
	assert.deepEqual(status.ollama, { state: 'unreachable', model: OLLAMA_DEFAULT_MODEL });
	assert.equal(status.restartNeeded, false);

	// A hosted bridge has no question to answer.
	const hosted = commandsWith({ llmChoice: null });
	const choice = /** @type {any} */ (hosted.find((c) => c.name === 'llm.choice'));
	assert.equal((await choice.run({ ...input, body: { answer: 'keep' } })).status, 409);
});

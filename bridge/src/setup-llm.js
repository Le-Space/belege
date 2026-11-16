#!/usr/bin/env node
// Set the bridge up for reading receipts with an LLM:
//
//   pnpm setup:llm
//
// 0. Which kind: 1 = Ollama on this computer (the default since 2026-11-16:
//    nothing leaves it), 2 = LibertAI's confidential inference (#416) – a
//    model in an attested enclave: the deployment is looked up, verified and
//    shown, and pinned once the person agrees; a changed one is pinned only
//    after a yes –, 3 = another OpenAI-compatible URL: a provider on the
//    internet (DeepSeek – China, …), chosen on purpose, or another server on
//    this machine (LM Studio).
//    A config that still has DeepSeek from the old default is asked once
//    first whether to switch to the local model (llm/default-choice.js).
// 1. The base URL (Ollama: http://127.0.0.1:11434/v1; a provider: no default,
//    it is typed, and its name and country are shown before it is taken).
// 2. The model, and the model to retry with.
// 3. For a URL on this machine: whether the model runs here (then nothing is
//    blacked out, #423). Otherwise the terms to black out before any text
//    leaves (own name, family names), separated by semicolons. IBANs,
//    own-domain e-mail addresses, streets and postcodes are blacked out anyway.
// 4. A provider's API key, from a hidden prompt, into the macOS keychain
//    (service `belege-bridge`, account `llm`). DEEPSEEK_API_KEY from .env is
//    offered instead, once. A model on this machine needs none.
//
// Defaults for a provider come from DEEPSEEK_* and REDACT_TERMS in the repo's
// .env, if any. Non-secret settings go to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import {
	defaultConfigPath,
	loadConfig,
	OLD_DEFAULT_LLM,
	OLLAMA_BASE_URL,
	OLLAMA_DEFAULT_MODEL,
	saveConfig
} from './config.js';
import { systemKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret, yes } from './setup-secret.js';
import { findDeployment as findLibertai } from './llm/confidential.js';
import { checkOllama, ollamaSteps } from './llm/ollama.js';
import { CLOUD_PROVIDERS, isOllamaUrl, providerLabel, providerOf } from './llm/providers.js';
import { DEFAULT_QUESTION, keepCloud, needsDefaultQuestion } from './llm/default-choice.js';

/** LibertAI's API, which requests are addressed to; in TEE mode they go to the enclave instead. */
export const LIBERTAI_BASE_URL = 'https://api.libertai.io/v1';
/** The model LibertAI serves in an attestable enclave (checked 2026-10-23: the only one). */
export const LIBERTAI_TEE_MODEL = 'qwen3.8-27b-tee';

const MODEL = /^[A-Za-z0-9._:/-]{1,80}$/;

/** @typedef {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} Io */

/**
 * @param {object} deps
 * @param {Io} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {Record<string, string | undefined>} [deps.env] DEEPSEEK_* and REDACT_TERMS from .env
 * @param {typeof findLibertai} [deps.findDeployment] tests: a fake enclave
 * @param {typeof checkOllama} [deps.checkOllama] tests: a fake Ollama
 * @param {() => string} [deps.now] tests: the time of an answer
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runLlmSetup({
	io,
	keychain,
	configPath,
	env = {},
	findDeployment = findLibertai,
	checkOllama: check = checkOllama,
	now = () => new Date().toISOString()
}) {
	let config = await loadConfig(configPath);
	const l = config.llm;

	// DeepSeek from the old default: asked once, the answer kept in the config.
	/** @type {string | null} */
	let kind = null;
	if (needsDefaultQuestion(l)) {
		for (const line of DEFAULT_QUESTION) io.print(line);
		const local = yes(
			(await io.ask(
				'Switch to the local model? [Y/n] (n keeps DeepSeek – China, on purpose; you are not asked again): '
			)) || 'y'
		);
		if (local) kind = '1';
		else {
			config.llm = keepCloud(l, now());
			await saveConfig(config, configPath);
			io.print('Kept DeepSeek on purpose. Change it any time with pnpm setup:llm.');
			config = await loadConfig(configPath);
		}
	}

	const current = providerOf(config.llm.baseUrl);
	const kindDefault = config.llm.tee
		? '2'
		: config.llm.configured && current.id !== 'ollama'
			? '3'
			: '1';
	if (!kind) {
		io.print('Which model reads your receipts?');
		io.print(
			`  1 = Ollama on this computer – nothing leaves it (the default; ${OLLAMA_DEFAULT_MODEL}, 2.5 GB)`
		);
		io.print('  2 = LibertAI, confidential – an attested enclave');
		io.print(
			`  3 = another OpenAI-compatible URL: a provider on the internet (${CLOUD_PROVIDERS.filter(
				(p) => p.country
			)
				.map((p) => providerLabel({ ...p, local: false }))
				.join(', ')}, …) or another server on this computer`
		);
		kind = (await io.ask(`Which one? [${kindDefault}]: `)) || kindDefault;
	}
	if (kind === '2') return libertaiSetup({ io, keychain, configPath, config, findDeployment });
	if (kind !== '1' && kind !== '3') {
		io.print(`Not one of 1, 2, 3: ${kind}`);
		return false;
	}
	return urlSetup({ io, keychain, configPath, config, env, ollama: kind === '1', check, now });
}

/**
 * Ollama, or another OpenAI-compatible URL.
 *
 * @param {object} p
 * @param {Io} p.io
 * @param {import('./keychain.js').Keychain} p.keychain
 * @param {string} p.configPath
 * @param {import('./config.js').BridgeConfig} p.config
 * @param {Record<string, string | undefined>} p.env
 * @param {boolean} p.ollama
 * @param {typeof checkOllama} p.check
 * @param {() => string} p.now
 */
async function urlSetup({ io, keychain, configPath, config, env, ollama, check, now }) {
	const l = config.llm;
	const fresh = !l.configured;
	const currentIsOllama = isOllamaUrl(l.baseUrl);

	/** @type {string} */
	let urlDefault;
	if (ollama) urlDefault = currentIsOllama ? l.baseUrl : OLLAMA_BASE_URL;
	else if (l.configured && !l.tee && !currentIsOllama) urlDefault = l.baseUrl;
	else urlDefault = (fresh && env.DEEPSEEK_BASE_URL) || '';
	if (!ollama && !urlDefault) {
		io.print(
			'A provider on the internet is chosen on purpose: type its URL, e.g. https://api.deepseek.com (DeepSeek – China).'
		);
	}
	const answer = await io.ask(`LLM base URL${urlDefault ? ` [${urlDefault}]` : ''}: `);
	const baseUrl = (answer || urlDefault).replace(/\/+$/, '');
	if (!baseUrl) {
		io.print('No URL: nothing changed.');
		return false;
	}
	let url;
	try {
		url = new URL(baseUrl);
	} catch {
		io.print(`Not a URL: ${baseUrl}`);
		return false;
	}
	const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
		io.print('Refusing a URL without https: receipt text must not travel in the clear.');
		return false;
	}
	const provider = providerOf(baseUrl);
	if (!loopback) {
		// Only on purpose: whose servers, and where, before anything is saved.
		io.print(
			`Provider: ${providerLabel(provider)}. Receipt and mail text goes there, blacked out first.`
		);
		if (!yes((await io.ask(`Use ${providerLabel(provider)}? [y/N]: `)) || 'n')) {
			io.print('Nothing changed.');
			return false;
		}
	}

	const sameHost = (() => {
		try {
			return new URL(l.baseUrl).host === url.host;
		} catch {
			return false;
		}
	})();
	const deepseek = provider.id === 'deepseek';
	const modelDefault = isOllamaUrl(baseUrl)
		? sameHost && l.configured
			? l.model
			: OLLAMA_DEFAULT_MODEL
		: sameHost && l.configured
			? l.model
			: (fresh && env.DEEPSEEK_MODEL) || (deepseek ? OLD_DEFAULT_LLM.model : '');
	const model =
		(await io.ask(`Model${modelDefault ? ` [${modelDefault}]` : ''}: `)) || modelDefault;
	const retryDefault = isOllamaUrl(baseUrl)
		? sameHost && l.configured
			? l.retryModel
			: model
		: sameHost && l.configured
			? l.retryModel
			: deepseek
				? OLD_DEFAULT_LLM.retryModel
				: model;
	const retryModel =
		(await io.ask(`Model for the retry${retryDefault ? ` [${retryDefault}]` : ''}: `)) ||
		retryDefault;
	if (!MODEL.test(model) || !MODEL.test(retryModel)) {
		io.print('A model name is letters, digits and . _ : / - only.');
		return false;
	}

	// A model on this machine gets the text as it is (#423). A loopback URL may
	// also be a proxy that forwards to a provider, so the person says which.
	/** @type {'on' | 'off'} */
	let redaction = 'on';
	if (loopback) {
		const local = yes(
			(await io.ask(
				'Does the model run on this machine itself (not a proxy that forwards to a provider)? Then nothing is blacked out. [Y/n]: '
			)) || 'y'
		);
		redaction = local ? 'off' : 'on';
	}

	const termsDefault = l.redactTerms.length ? l.redactTerms.join('; ') : (env.REDACT_TERMS ?? '');
	if (redaction === 'off') {
		io.print(
			'Nothing leaves this machine, so nothing is blacked out. Your terms are kept for later.'
		);
	}
	const askTerms = redaction === 'on';
	if (askTerms)
		io.print(
			'Terms to black out before text leaves this machine, separated by ";": your first and family name, together and the family name alone, and the names of others on your receipts (family on tickets, staff).'
		);
	if (askTerms) {
		io.print(
			"The company names from the app's Einstellungen are added by the app. IBANs, e-mail addresses, phone numbers, streets and postcodes are blacked out anyway."
		);
		io.print(
			'A name that is on no list and follows no label gets through. For nothing to leave, set a model on this machine – our advice for now, until fast models in a TEE with a checkable attestation are available.'
		);
	}
	const termsAnswer = askTerms
		? await io.ask(`Terms${termsDefault ? ` [${termsDefault}]` : ''} ("-" for none): `)
		: '';
	const redactTerms = askTerms
		? (termsAnswer === '-' ? '' : termsAnswer || termsDefault)
				.split(';')
				.map((t) => t.trim())
				.filter((t) => t.length >= 2)
		: l.redactTerms;

	if (loopback) {
		// A server on this machine needs no key; one stored for a provider stays for later.
		io.print('A model on this computer needs no API key; a key already stored stays for later.');
	} else {
		const stored = await storeSecret({
			io,
			keychain,
			what: 'API key',
			account: 'llm',
			envName: 'DEEPSEEK_API_KEY',
			envValue: env.DEEPSEEK_API_KEY
		});
		if (!stored) return false;
	}

	config.llm = {
		baseUrl,
		model,
		retryModel,
		redactTerms,
		redaction,
		configured: true,
		tee: null,
		cloudOnPurpose: loopback ? null : now()
	};
	await saveConfig(config, configPath);
	io.print(
		redaction === 'off'
			? `Saved ${configPath} (a model on this machine: nothing is blacked out).`
			: `Saved ${configPath} (${redactTerms.length} term(s) to black out).`
	);
	if (isOllamaUrl(baseUrl)) {
		const steps = ollamaSteps(await check({ baseUrl, model }));
		if (steps.length) for (const line of steps) io.print(line);
		else io.print(`Ollama runs and has ${model}.`);
	}
	io.print('Restart the bridge (pnpm bridge) to use it.');
	return true;
}

/**
 * LibertAI's confidential inference (#416): the enclave looked up and proved,
 * shown, and pinned on a yes. Whether text is blacked out before it goes into
 * the enclave is asked; the default is not to – nobody between this machine
 * and the attested enclave can read it. The API key from console.libertai.io
 * goes to the keychain.
 *
 * @param {object} p
 * @param {Io} p.io
 * @param {import('./keychain.js').Keychain} p.keychain
 * @param {string} p.configPath
 * @param {import('./config.js').BridgeConfig} p.config
 * @param {typeof findLibertai} p.findDeployment
 */
async function libertaiSetup({ io, keychain, configPath, config, findDeployment }) {
	const l = config.llm;
	const modelDefault = l.tee ? l.model : LIBERTAI_TEE_MODEL;
	const model = (await io.ask(`Model [${modelDefault}]: `)) || modelDefault;
	if (!MODEL.test(model)) {
		io.print('A model name is letters, digits and . _ : / - only.');
		return false;
	}
	io.print(
		'Looking up the enclave and checking its attestation (AMD signature, TLS key, measurement) …'
	);
	let pin;
	try {
		pin = await findDeployment(model);
	} catch (/** @type {any} */ error) {
		io.print(error.message);
		return false;
	}
	io.print(`Verified: deployment ${pin.itemHash}`);
	io.print(`  measurement ${pin.measurement}`);
	io.print(
		`  source commit ${pin.sourceCommit ?? '(not named)'} – rebuild it to check what the image does: github.com/Libertai/confidential-inference, VERIFYING.md`
	);
	const changed =
		l.tee && (l.tee.itemHash !== pin.itemHash || l.tee.measurement !== pin.measurement);
	if (changed) {
		io.print(`The pinned deployment was ${l.tee?.itemHash} (measurement ${l.tee?.measurement}).`);
		if (!yes((await io.ask('Pin the new one instead? [y/N]: ')) || 'n')) {
			io.print('Kept the old pin: requests fail until it answers again or a new one is pinned.');
			return false;
		}
	} else if (
		!yes(
			(await io.ask(
				'Pin this deployment? Every request goes to it, attested, or fails. [Y/n]: '
			)) || 'y'
		)
	) {
		return false;
	}

	// The enclave is attested and the TLS ends inside it: blacking out would only
	// cost reading quality. What the attestation does not prove – what the image
	// does – is said here, and the person may still choose to black out.
	io.print(
		'The text goes into the attested enclave; nobody on the way, LibertAI included, can read it. The attestation proves which image runs, not what it does.'
	);
	const blackOut = yes(
		(await io.ask(
			'Black out names, IBANs and addresses before text goes into the enclave anyway? [y/N]: '
		)) || 'n'
	);
	const termsDefault = l.redactTerms.join('; ');
	let redactTerms = l.redactTerms;
	if (blackOut) {
		io.print('Terms to black out, separated by ";":');
		const termsAnswer = await io.ask(
			`Terms${termsDefault ? ` [${termsDefault}]` : ''} ("-" for none): `
		);
		redactTerms = (termsAnswer === '-' ? '' : termsAnswer || termsDefault)
			.split(';')
			.map((t) => t.trim())
			.filter((t) => t.length >= 2);
	} else {
		io.print('Nothing is blacked out. Your terms are kept for later.');
	}

	const stored = await storeSecret({
		io,
		keychain,
		what: 'LibertAI API key (console.libertai.io)',
		account: 'llm',
		envName: 'LIBERTAI_API_KEY',
		envValue: undefined
	});
	if (!stored) return false;

	config.llm = {
		baseUrl: LIBERTAI_BASE_URL,
		model,
		retryModel: model,
		redactTerms,
		redaction: blackOut ? 'on' : 'off',
		configured: true,
		tee: pin,
		cloudOnPurpose: null
	};
	await saveConfig(config, configPath);
	io.print(
		blackOut
			? `Saved ${configPath}: ${model} in the pinned enclave, ${redactTerms.length} term(s) to black out.`
			: `Saved ${configPath}: ${model} in the pinned enclave, nothing blacked out.`
	);
	io.print('Restart the bridge (pnpm bridge) to use it.');
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	const { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, REDACT_TERMS } = process.env;
	try {
		const saved = await runLlmSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: systemKeychain({ account: 'llm' }),
			configPath: defaultConfigPath(),
			env: { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, REDACT_TERMS }
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

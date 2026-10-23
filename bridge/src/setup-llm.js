#!/usr/bin/env node
// Set the bridge up for reading receipts with an LLM:
//
//   pnpm setup:llm
//
// 0. Which kind: an OpenAI-compatible URL (DeepSeek, a model on this machine, …),
//    or LibertAI's confidential inference (#416) – a model in an attested
//    enclave: the deployment is looked up, verified and shown, and pinned once
//    the person agrees; a changed one is pinned only after a yes.
// 1. The provider's base URL (OpenAI-compatible; default https://api.deepseek.com).
// 2. The model, and the model to retry with (deepseek-flash, deepseek-v4-pro).
// 3. The terms to black out before any text leaves (own name, family names),
//    separated by semicolons. IBANs, own-domain e-mail addresses, streets and
//    postcodes are blacked out anyway.
// 4. The API key, from a hidden prompt, into the macOS keychain (service
//    `belege-bridge`, account `llm`). DEEPSEEK_API_KEY from .env is offered
//    instead, once.
//
// Defaults come from DEEPSEEK_* and REDACT_TERMS in the repo's .env, if any.
// Non-secret settings go to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import { defaultConfigPath, defaultLlmConfig, loadConfig, saveConfig } from './config.js';
import { systemKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret, yes } from './setup-secret.js';
import { findDeployment as findLibertai } from './llm/confidential.js';

/** LibertAI's API, which requests are addressed to; in TEE mode they go to the enclave instead. */
export const LIBERTAI_BASE_URL = 'https://api.libertai.io/v1';
/** The model LibertAI serves in an attestable enclave (checked 2026-10-23: the only one). */
export const LIBERTAI_TEE_MODEL = 'qwen3.8-27b-tee';

const MODEL = /^[A-Za-z0-9._:/-]{1,80}$/;

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {Record<string, string | undefined>} [deps.env] DEEPSEEK_* and REDACT_TERMS from .env
 * @param {typeof findLibertai} [deps.findDeployment] tests: a fake enclave
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runLlmSetup({
	io,
	keychain,
	configPath,
	env = {},
	findDeployment = findLibertai
}) {
	const config = await loadConfig(configPath);
	const l = config.llm;
	const fresh = !l.configured;

	const kindDefault = l.tee ? '2' : '1';
	const kind =
		(await io.ask(
			`Which model? 1 = an OpenAI-compatible URL (DeepSeek, a model on this machine, …), 2 = LibertAI, confidential (an attested enclave) [${kindDefault}]: `
		)) || kindDefault;
	if (kind === '2') return libertaiSetup({ io, keychain, configPath, config, findDeployment });

	const urlDefault =
		(fresh && env.DEEPSEEK_BASE_URL) || (l.tee ? defaultLlmConfig().baseUrl : l.baseUrl);
	const baseUrl = ((await io.ask(`LLM base URL [${urlDefault}]: `)) || urlDefault).replace(
		/\/+$/,
		''
	);
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

	const modelDefault = (fresh && env.DEEPSEEK_MODEL) || l.model;
	const model = (await io.ask(`Model [${modelDefault}]: `)) || modelDefault;
	const retryModel = (await io.ask(`Model for the retry [${l.retryModel}]: `)) || l.retryModel;
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
	const redactTerms = (termsAnswer === '-' ? '' : termsAnswer || termsDefault)
		.split(';')
		.map((t) => t.trim())
		.filter((t) => t.length >= 2);

	const stored = await storeSecret({
		io,
		keychain,
		what: 'API key',
		account: 'llm',
		envName: 'DEEPSEEK_API_KEY',
		envValue: env.DEEPSEEK_API_KEY
	});
	if (!stored) return false;

	config.llm = { baseUrl, model, retryModel, redactTerms, redaction, configured: true, tee: null };
	await saveConfig(config, configPath);
	io.print(
		redaction === 'off'
			? `Saved ${configPath} (a model on this machine: nothing is blacked out).`
			: `Saved ${configPath} (${redactTerms.length} term(s) to black out).`
	);
	io.print('Restart the bridge (pnpm bridge) to use it.');
	return true;
}

/**
 * LibertAI's confidential inference (#416): the enclave looked up and proved,
 * shown, and pinned on a yes. Text is still blacked out before it goes (defence
 * in depth), and the API key from console.libertai.io goes to the keychain.
 *
 * @param {object} p
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} p.io
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

	const termsDefault = l.redactTerms.join('; ');
	io.print(
		'Text is still blacked out before it goes: the enclave is attested, LibertAI still sees your IP address, sizes and times. Terms to black out, separated by ";":'
	);
	const termsAnswer = await io.ask(
		`Terms${termsDefault ? ` [${termsDefault}]` : ''} ("-" for none): `
	);
	const redactTerms = (termsAnswer === '-' ? '' : termsAnswer || termsDefault)
		.split(';')
		.map((t) => t.trim())
		.filter((t) => t.length >= 2);

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
		redaction: 'on',
		configured: true,
		tee: pin
	};
	await saveConfig(config, configPath);
	io.print(
		`Saved ${configPath}: ${model} in the pinned enclave, ${redactTerms.length} term(s) to black out.`
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

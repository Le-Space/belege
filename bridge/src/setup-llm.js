#!/usr/bin/env node
// Set the bridge up for reading receipts with an LLM:
//
//   pnpm setup:llm
//
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

import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { macosKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret } from './setup-secret.js';

const MODEL = /^[A-Za-z0-9._:/-]{1,80}$/;

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {Record<string, string | undefined>} [deps.env] DEEPSEEK_* and REDACT_TERMS from .env
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runLlmSetup({ io, keychain, configPath, env = {} }) {
	const config = await loadConfig(configPath);
	const l = config.llm;
	const fresh = !l.configured;

	const urlDefault = (fresh && env.DEEPSEEK_BASE_URL) || l.baseUrl;
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

	const termsDefault = l.redactTerms.length ? l.redactTerms.join('; ') : (env.REDACT_TERMS ?? '');
	io.print(
		'Terms to black out before text leaves this machine (own name, family names on tickets), separated by ";".'
	);
	io.print('IBANs, own e-mail addresses, streets and postcodes are blacked out anyway.');
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
		what: 'API key',
		account: 'llm',
		envName: 'DEEPSEEK_API_KEY',
		envValue: env.DEEPSEEK_API_KEY
	});
	if (!stored) return false;

	config.llm = { baseUrl, model, retryModel, redactTerms, configured: true };
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath} (${redactTerms.length} term(s) to black out).`);
	io.print('Restart the bridge (pnpm bridge) to use it.');
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	const { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, REDACT_TERMS } = process.env;
	try {
		const saved = await runLlmSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'llm' }),
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

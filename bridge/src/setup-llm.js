#!/usr/bin/env node
// Set the bridge up for reading receipts with an LLM:
//
//   pnpm setup:llm
//
// 1. The provider's base URL (OpenAI-compatible; default https://api.deepseek.com).
//    The known ones are listed (LLM_PROVIDERS in config.js): DeepSeek, and
//    LibertAI at https://api.libertai.io/v1.
// 2. The model, and the model to retry with: deepseek-flash and deepseek-v4-pro
//    with DeepSeek, deepseek-v4-flash and deepseek-v4.1-flash with LibertAI.
//    Switching to a known provider offers its models.
// 3. The terms to black out before any text leaves (own name, family names),
//    separated by semicolons. IBANs, own-domain e-mail addresses, streets and
//    postcodes are blacked out anyway.
// 4. The API key, from a hidden prompt, into the macOS keychain (service
//    `belege-bridge`, account `llm`). The provider's key from .env
//    (DEEPSEEK_API_KEY, or LIBERTAI_API_KEY for LibertAI) is offered instead, once.
//
// Defaults come from DEEPSEEK_* and REDACT_TERMS in the repo's .env, if any.
// Non-secret settings go to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import {
	LLM_PROVIDERS,
	defaultConfigPath,
	llmProviderOf,
	loadConfig,
	saveConfig
} from './config.js';
import { systemKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret } from './setup-secret.js';

const MODEL = /^[A-Za-z0-9._:/-]{1,80}$/;

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {Record<string, string | undefined>} [deps.env] DEEPSEEK_*, LIBERTAI_API_KEY and REDACT_TERMS from .env
 * @returns {Promise<boolean>} true when the configuration was saved
 */
export async function runLlmSetup({ io, keychain, configPath, env = {} }) {
	const config = await loadConfig(configPath);
	const l = config.llm;
	const fresh = !l.configured;

	io.print('Known providers (or any other OpenAI-compatible URL):');
	for (const p of LLM_PROVIDERS) io.print(`  ${p.name}: ${p.baseUrl}`);
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

	const provider = llmProviderOf(baseUrl);
	// Another provider than the saved one: its models, not the saved ones.
	const preset = baseUrl !== l.baseUrl ? provider : undefined;
	const modelDefault = preset?.model ?? ((fresh && env.DEEPSEEK_MODEL) || l.model);
	const retryDefault = preset?.retryModel ?? l.retryModel;
	const model = (await io.ask(`Model [${modelDefault}]: `)) || modelDefault;
	const retryModel = (await io.ask(`Model for the retry [${retryDefault}]: `)) || retryDefault;
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

	if (!fresh && baseUrl !== l.baseUrl) {
		io.print(`The key in the keychain is for ${l.baseUrl}: type the key for ${baseUrl}.`);
	}
	const envName = provider?.envKey ?? 'DEEPSEEK_API_KEY';
	const stored = await storeSecret({
		io,
		keychain,
		what: 'API key',
		account: 'llm',
		envName,
		envValue: env[envName]
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
	const { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, LIBERTAI_API_KEY, REDACT_TERMS } =
		process.env;
	try {
		const saved = await runLlmSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: systemKeychain({ account: 'llm' }),
			configPath: defaultConfigPath(),
			env: { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, LIBERTAI_API_KEY, REDACT_TERMS }
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

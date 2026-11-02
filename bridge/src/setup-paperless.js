#!/usr/bin/env node
// Paperless-ngx as a receipt source (issue #318):
//
//   pnpm setup:paperless
//
// Asks where Paperless answers (http://127.0.0.1:8000 by default; https, or
// http on this machine only) and for an API token – in Paperless under
// "My Profile" → "API Auth Token". The token goes into the keychain (service
// `belege-bridge`, account `paperless`), the address and a flag into
// bridge.json. One test call, which prints how many documents Paperless holds
// and nothing of them. PAPERLESS_API_TOKEN from the repo's .env is offered
// instead, once.

import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, paperlessBaseUrl, saveConfig } from './config.js';
import { systemKeychain } from './keychain.js';
import { PaperlessError, createPaperlessClient } from './paperless.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, yes } from './setup-secret.js';

/**
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<number>} the number of documents
 */
const testCall = (baseUrl, token) =>
	createPaperlessClient({ baseUrl, getToken: async () => token }).count();

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {(baseUrl: string, token: string) => Promise<number>} [deps.check]
 * @param {{ PAPERLESS_API_TOKEN?: string }} [deps.env] from the repo's .env
 * @returns {Promise<boolean>} true when the token was stored and the configuration saved
 */
export async function runPaperlessSetup({ io, keychain, configPath, check = testCall, env = {} }) {
	const config = await loadConfig(configPath);
	const typed = (await io.ask(`Paperless address [${config.paperless.baseUrl}]: `)).trim();
	const baseUrl = paperlessBaseUrl(typed || config.paperless.baseUrl);
	if (!baseUrl) {
		io.print(
			'That address is not taken: https, or http on this machine (127.0.0.1, localhost). Nothing changed.'
		);
		return false;
	}

	let fromEnv = false;
	if (env.PAPERLESS_API_TOKEN) {
		fromEnv = yes((await io.ask('PAPERLESS_API_TOKEN found in .env. Use it? [Y/n]: ')) || 'y');
	}
	io.print('The token is in Paperless under "My Profile" → "API Auth Token".');
	const token = (
		fromEnv ? String(env.PAPERLESS_API_TOKEN) : await io.askHidden('Paperless API token (hidden): ')
	).trim();
	if (!token) {
		io.print('No token given; nothing changed.');
		return false;
	}

	try {
		const count = await check(baseUrl, token);
		io.print(`Paperless answers: ${count} document(s).`);
	} catch (/** @type {any} */ error) {
		const reason = error instanceof PaperlessError ? error.message : 'the test call failed';
		io.print(`Paperless did not accept it: ${reason}. Nothing changed.`);
		return false;
	}

	await keychain.write(token);
	config.paperless = { configured: true, baseUrl };
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath}. Restart the bridge (pnpm bridge) to use it.`);
	if (fromEnv) {
		io.print(
			'You can now delete PAPERLESS_API_TOKEN from .env: the bridge reads only the keychain.'
		);
	}
	return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	try {
		const saved = await runPaperlessSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: systemKeychain({ account: 'paperless' }),
			configPath: defaultConfigPath(),
			env: { PAPERLESS_API_TOKEN: process.env.PAPERLESS_API_TOKEN }
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

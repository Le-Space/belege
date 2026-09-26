#!/usr/bin/env node
// Connect the bridge to one Kraken account, read only:
//
//   pnpm setup:kraken
//
// 1. On kraken.com, Settings → API → "Create API key" with only these
//    permissions: "Query Funds" and "Query Ledger Entries". Nothing that can
//    trade, deposit or withdraw.
// 2. Paste the API key and the private key into the hidden prompts, or take
//    KRAKEN_API_KEY and KRAKEN_PRIVATE_KEY from the repo's .env when offered.
//    They go into the macOS keychain (service `belege-bridge`, account
//    `kraken`), as JSON, and nowhere else.
// 3. A test call reads the balances and prints how many assets it found
//    (never an amount).
//
// Only `kraken.configured` goes to ~/.config/belege/bridge.json (0600).

import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, saveConfig } from './config.js';
import { macosKeychain } from './keychain.js';
import { createKrakenClient, isKrakenSecret, KrakenError } from './kraken.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, yes } from './setup-secret.js';

/**
 * @param {object} deps
 * @param {{ ask?: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} deps.configPath
 * @param {(credentials: { key: string, secret: string }, baseUrl: string) => Promise<number>} [deps.check]
 *   the test call; returns the number of assets with a balance
 * @param {{ KRAKEN_API_KEY?: string, KRAKEN_PRIVATE_KEY?: string }} [deps.env] from the repo's .env
 * @returns {Promise<boolean>} true when the key was stored and the configuration saved
 */
export async function runKrakenSetup({ io, keychain, configPath, check = testCall, env = {} }) {
	const config = await loadConfig(configPath);
	io.print('Create a Kraken API key with only "Query Funds" and "Query Ledger Entries".');

	let fromEnv = false;
	if (env.KRAKEN_API_KEY && env.KRAKEN_PRIVATE_KEY && io.ask) {
		fromEnv = yes(
			(await io.ask('KRAKEN_API_KEY and KRAKEN_PRIVATE_KEY found in .env. Use them? [Y/n]: ')) ||
				'y'
		);
	}
	const key = (
		fromEnv ? String(env.KRAKEN_API_KEY) : await io.askHidden('Kraken API key (hidden): ')
	).trim();
	if (!key) {
		io.print('No API key given; nothing changed.');
		return false;
	}
	const secret = (
		fromEnv ? String(env.KRAKEN_PRIVATE_KEY) : await io.askHidden('Kraken private key (hidden): ')
	).trim();
	if (!isKrakenSecret(secret)) {
		io.print('That is not a Kraken private key (base64 of 64 bytes); nothing changed.');
		return false;
	}

	try {
		const assets = await check({ key, secret }, config.kraken.baseUrl);
		io.print(`The key works: ${assets} asset(s) with a balance.`);
	} catch (/** @type {any} */ error) {
		const reason = error instanceof KrakenError ? error.message : 'the test call failed';
		io.print(`Kraken did not accept the key: ${reason}. Nothing changed.`);
		return false;
	}

	await keychain.write(JSON.stringify({ key, secret }));
	config.kraken = { ...config.kraken, configured: true };
	await saveConfig(config, configPath);
	io.print(`Saved ${configPath}. Restart the bridge (pnpm bridge) to use it.`);
	if (fromEnv) {
		io.print(
			'You can now delete KRAKEN_API_KEY and KRAKEN_PRIVATE_KEY from .env: the bridge reads only the keychain.'
		);
	}
	return true;
}

/** @param {{ key: string, secret: string }} credentials @param {string} baseUrl */
async function testCall(credentials, baseUrl) {
	const client = createKrakenClient({ getCredentials: async () => credentials, baseUrl });
	return (await client.balances()).length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	const { KRAKEN_API_KEY, KRAKEN_PRIVATE_KEY } = process.env;
	try {
		const saved = await runKrakenSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'kraken' }),
			configPath: defaultConfigPath(),
			env: { KRAKEN_API_KEY, KRAKEN_PRIVATE_KEY }
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

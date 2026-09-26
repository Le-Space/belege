#!/usr/bin/env node
// An optional CoinGecko demo key for the daily rates (rates.js):
//
//   pnpm setup:coingecko
//
// Without a key, CoinGecko answers fewer requests. The key goes into the macOS
// keychain (service `belege-bridge`, account `coingecko`); COINGECKO_API_KEY
// from the repo's .env is offered instead, once. The bridge sends it as a
// header, never in a URL.

import { fileURLToPath } from 'node:url';

import { macosKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, storeSecret } from './setup-secret.js';

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} [deps.envValue] COINGECKO_API_KEY from .env
 */
export async function runCoinGeckoSetup({ io, keychain, envValue }) {
	const stored = await storeSecret({
		io,
		keychain,
		what: 'CoinGecko API key',
		account: 'coingecko',
		envName: 'COINGECKO_API_KEY',
		envValue
	});
	if (stored) io.print('Restart the bridge (pnpm bridge) to use it.');
	return stored;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	try {
		const saved = await runCoinGeckoSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'coingecko' }),
			envValue: process.env.COINGECKO_API_KEY
		});
		closePrompts();
		process.exit(saved ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

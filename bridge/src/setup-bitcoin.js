#!/usr/bin/env node
// The Bitcoin wallet's extended public key, read only:
//
//   pnpm setup:bitcoin
//
// A zpub (native SegWit, bc1q…), a ypub (3…) or an xpub – the account's
// public key from the wallet app's settings or a hardware wallet's companion
// app. It can show every address and payment, but spend nothing. Wallets
// hand out an xpub for more than one address type, so for an xpub this asks
// which: bc1q… (p2wpkh) or 1… (p2pkh).
//
// It goes into the macOS keychain (service `belege-bridge`, account
// `bitcoin`, JSON `{ key, type }`), and only there: the app knows the wallet
// by its fingerprint (`btc-` + 8 hex), which this prints with the type.
// BITCOIN_XPUB from the repo's .env is offered instead, once.

import { fileURLToPath } from 'node:url';

import { macosKeychain } from './keychain.js';
import { deriveAddress, keyFingerprint, parseExtendedKey } from './chains/bitcoin.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { loadRepoEnv, yes } from './setup-secret.js';

const NAMES = {
	p2wpkh: 'bc1q… (native SegWit)',
	'p2sh-p2wpkh': '3… (SegWit in P2SH)',
	p2pkh: '1… (legacy)'
};

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {string} [deps.envValue] BITCOIN_XPUB from .env
 * @returns {Promise<string | null>} the fingerprint, or null when nothing was stored
 */
export async function runBitcoinSetup({ io, keychain, envValue }) {
	let key = '';
	if (envValue) {
		if (yes((await io.ask('BITCOIN_XPUB found in .env. Use it? [Y/n]: ')) || 'y')) key = envValue;
	}
	if (!key) key = await io.askHidden('Bitcoin xpub, ypub or zpub (hidden): ');
	key = key.trim();
	/** @type {string | undefined} */
	let type;
	if (key.startsWith('xpub')) {
		io.print('An xpub is used for more than one kind of address. Which does your wallet show?');
		const answer = (await io.ask('  1) bc1q…  (native SegWit)   2) 1…  (legacy)  [1]: ')) || '1';
		type = answer.trim() === '2' ? 'p2pkh' : 'p2wpkh';
	}
	try {
		const parsed = parseExtendedKey(key, type);
		deriveAddress(parsed.account, parsed.type, 0, 0);
		type = parsed.type;
	} catch (/** @type {any} */ error) {
		io.print(`${error.message}. Nothing changed.`);
		return null;
	}
	await keychain.write(JSON.stringify({ key, type }));
	const fingerprint = keyFingerprint(key);
	io.print('Stored in the keychain (service belege-bridge, account bitcoin).');
	io.print(
		`Addresses: ${NAMES[/** @type {keyof typeof NAMES} */ (type)]}. In the app the wallet shows as ${fingerprint}.`
	);
	io.print('Restart the bridge (pnpm bridge) to use it.');
	if (envValue && key === envValue.trim()) {
		io.print('You can now delete BITCOIN_XPUB from .env: the bridge reads only the keychain.');
	}
	return fingerprint;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	loadRepoEnv(new URL('../../.env', import.meta.url));
	try {
		const stored = await runBitcoinSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'bitcoin' }),
			envValue: process.env.BITCOIN_XPUB
		});
		closePrompts();
		process.exit(stored ? 0 : 1);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

#!/usr/bin/env node
// An optional Blockscout API key for the Filecoin Pay statement
// (@le-space/chains filecoin-pay.js):
//
//   pnpm setup:blockscout
//
// The statement reads what was paid into and taken out of a payer's balance
// in Filecoin Pay from the contract's events at Blockscout – and, where the
// makers' index does not answer, everything from there. Without a key
// Blockscout answers about ten requests and then none for minutes. With one,
// the bridge asks Blockscout's keyed host (api.blockscout.com) instead.
//
// 1. On dev.blockscout.com create an API key (the free plan is enough).
// 2. Paste it into the hidden prompt. Enter keeps a stored key, `-` deletes it.
// 3. A test call (the newest block of Filecoin) says whether Blockscout takes
//    the key. A key Blockscout refuses is not stored.
//
// The key goes into the macOS keychain (service `belege-bridge`, account
// `blockscout`) and nowhere else: it is never printed, logged or read from a
// file. The bridge sends it to api.blockscout.com only, in the
// `authorization` header – in no URL.

import { fileURLToPath } from 'node:url';

import { FILECOIN_PAY } from '@le-space/chains/filecoin-pay';
import { systemKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { yes } from './setup-secret.js';

/** @typedef {'ok' | 'refused-key' | 'unreachable'} KeyCheck */

/** What a key looks like: letters, digits, `_` and `-` (Blockscout's begin with `proapi_`). @param {string} key */
export const isBlockscoutKey = (key) => /^[A-Za-z0-9_-]{8,200}$/.test(key);

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {(key: string) => Promise<KeyCheck>} [deps.check] the test call
 * @returns {Promise<boolean>} whether a key is stored afterwards
 */
export async function runBlockscoutSetup({ io, keychain, check = testCall }) {
	const stored = await keychain.read().then(
		() => true,
		() => false
	);
	io.print(
		'A Blockscout API key lets the Filecoin Pay statement read the payment contract’s events without Blockscout’s rate limit.'
	);
	const answer = (
		await io.askHidden(
			stored
				? 'Blockscout API key (hidden; Enter keeps the stored one, "-" deletes it): '
				: 'Blockscout API key (hidden; Enter stores none): '
		)
	).trim();

	if (answer === '-') {
		if (!stored) {
			io.print('No Blockscout key is stored; nothing to delete.');
			return false;
		}
		if (!yes((await io.ask('Delete the stored Blockscout key? [y/N]: ')) || 'n')) {
			io.print('Keeping the one already in the keychain.');
			return true;
		}
		await keychain.remove?.();
		io.print('Deleted. Blockscout is asked without a key again (restart not needed).');
		return false;
	}
	if (!answer) {
		io.print(stored ? 'Keeping the one already in the keychain.' : 'Nothing stored.');
		return stored;
	}
	if (!isBlockscoutKey(answer)) {
		io.print(
			'That does not look like a Blockscout API key (letters, digits, _ and -); nothing changed.'
		);
		return stored;
	}

	const result = await check(answer);
	if (result === 'refused-key') {
		io.print('Blockscout did not accept the key; nothing changed.');
		return stored;
	}
	await keychain.write(answer);
	io.print('Stored in the keychain (service belege-bridge, account blockscout).');
	io.print(
		result === 'ok'
			? '  Filecoin: answers'
			: '  Filecoin: not reachable right now – the key is stored unchecked'
	);
	io.print('The bridge uses it from the next statement on; no restart needed.');
	return true;
}

/**
 * The newest block of Filecoin, asked of the keyed host. Only the outcome
 * comes back, never the answer's text.
 *
 * @param {string} key
 * @param {{ fetch?: typeof fetch, api?: string }} [options] tests: a fake
 * @returns {Promise<KeyCheck>}
 */
export async function testCall(key, { fetch: f = fetch, api = FILECOIN_PAY.keyedApi } = {}) {
	try {
		const res = await f(
			`${api}?chain_id=${FILECOIN_PAY.chainId}&module=block&action=eth_block_number`,
			{
				headers: { authorization: `Bearer ${key}` },
				signal: AbortSignal.timeout(15_000),
				redirect: 'error'
			}
		);
		// 401: a key it does not know; 402: it saw none it takes; 403: not allowed.
		if (res.status === 401 || res.status === 402 || res.status === 403) return 'refused-key';
		const body = await res.json().catch(() => null);
		return res.ok && typeof body?.result === 'string' && /^0x[0-9a-f]+$/i.test(body.result)
			? 'ok'
			: 'unreachable';
	} catch {
		return 'unreachable';
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		await runBlockscoutSetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: systemKeychain({ account: 'blockscout' })
		});
		closePrompts();
		process.exit(0);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

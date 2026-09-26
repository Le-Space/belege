#!/usr/bin/env node
// An optional Alchemy API key for own EVM wallets (chains/alchemy.js):
//
//   pnpm setup:alchemy
//
// Without a key, EVM wallets are read from Blockscout, which answers only a
// few requests per half hour and IP address. With one, from Alchemy
// (Ethereum, Base, Arbitrum, Optimism, Polygon).
//
// 1. On dashboard.alchemy.com create an app (the free tier is enough) with
//    the networks Ethereum, Base, Arbitrum, OP Mainnet and Polygon PoS.
// 2. Paste its API key into the hidden prompt. Enter keeps a stored key,
//    `-` deletes it.
// 3. A test call (eth_chainId on each network) says which networks answer.
//    A key Alchemy refuses is not stored.
//
// The key goes into the macOS keychain (service `belege-bridge`, account
// `alchemy`) and nowhere else: it is never printed, logged or read from a
// file. The bridge puts it into the URL of its requests to Alchemy only.

import { fileURLToPath } from 'node:url';

import { CHAINS } from './chains/registry.js';
import { alchemyBaseUrl, isAlchemyKey } from './chains/alchemy.js';
import { macosKeychain } from './keychain.js';
import { ask, askHidden, closePrompts } from './prompt.js';
import { yes } from './setup-secret.js';

/**
 * @typedef {{ chain: string, result: 'ok' | 'refused-key' | 'denied' | 'wrong-chain' | 'unreachable' }} NetworkCheck
 */

/**
 * @param {object} deps
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} deps.io
 * @param {import('./keychain.js').Keychain} deps.keychain
 * @param {(key: string) => Promise<NetworkCheck[]>} [deps.check] the test call
 * @returns {Promise<boolean>} whether a key is stored afterwards
 */
export async function runAlchemySetup({ io, keychain, check = testCall }) {
	const stored = await keychain.read().then(
		() => true,
		() => false
	);
	io.print(
		'An Alchemy API key reads own EVM wallets (Ethereum, Base, Arbitrum, Optimism, Polygon) without Blockscout’s rate limit.'
	);
	const answer = (
		await io.askHidden(
			stored
				? 'Alchemy API key (hidden; Enter keeps the stored one, "-" deletes it): '
				: 'Alchemy API key (hidden; Enter stores none): '
		)
	).trim();

	if (answer === '-') {
		if (!stored) {
			io.print('No Alchemy key is stored; nothing to delete.');
			return false;
		}
		if (!yes((await io.ask('Delete the stored Alchemy key? [y/N]: ')) || 'n')) {
			io.print('Keeping the one already in the keychain.');
			return true;
		}
		await keychain.remove?.();
		io.print('Deleted. EVM wallets are read from Blockscout again (restart not needed).');
		return false;
	}
	if (!answer) {
		io.print(stored ? 'Keeping the one already in the keychain.' : 'Nothing stored.');
		return stored;
	}
	if (!isAlchemyKey(answer)) {
		io.print(
			'That does not look like an Alchemy API key (letters, digits, _ and -); nothing changed.'
		);
		return stored;
	}

	const results = await check(answer);
	if (results.some((r) => r.result === 'refused-key')) {
		io.print('Alchemy did not accept the key; nothing changed.');
		return stored;
	}
	await keychain.write(answer);
	io.print('Stored in the keychain (service belege-bridge, account alchemy).');
	for (const r of results) {
		const said = {
			ok: 'answers',
			denied: 'refused – enable this network for the app in the Alchemy dashboard',
			'wrong-chain': 'answered for another chain',
			unreachable: 'not reachable right now',
			'refused-key': 'refused the key'
		}[r.result];
		io.print(`  ${r.chain}: ${said}`);
	}
	io.print('The bridge uses it from the next sync on; no restart needed.');
	return true;
}

/**
 * eth_chainId on each network. Only the outcome comes back, never the answer's text.
 *
 * @param {string} key
 * @returns {Promise<NetworkCheck[]>}
 */
async function testCall(key) {
	/** @type {NetworkCheck[]} */
	const out = [];
	for (const chain of Object.values(CHAINS)) {
		if (chain.kind !== 'evm' || !chain.alchemy) continue;
		/** @type {NetworkCheck['result']} */
		let result;
		try {
			const res = await fetch(`${alchemyBaseUrl(chain.alchemy.network)}/${key}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
				signal: AbortSignal.timeout(15_000),
				redirect: 'error'
			});
			const body = await res.json().catch(() => null);
			result =
				res.status === 401
					? 'refused-key'
					: res.status === 403
						? 'denied'
						: typeof body?.result === 'string' && /^0x[0-9a-f]+$/i.test(body.result)
							? BigInt(body.result) === BigInt(chain.chainId)
								? 'ok'
								: 'wrong-chain'
							: 'unreachable';
		} catch {
			result = 'unreachable';
		}
		out.push({ chain: chain.name, result });
	}
	return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		await runAlchemySetup({
			io: { ask, askHidden, print: (line) => console.log(line) },
			keychain: macosKeychain({ account: 'alchemy' })
		});
		closePrompts();
		process.exit(0);
	} catch (/** @type {any} */ error) {
		closePrompts();
		console.error(`Setup failed: ${error.message}`);
		process.exit(1);
	}
}

#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// start-as-browser.mjs: what the start screen will do, from a terminal, for a
// test run on testnet (#696). The books ask the contract for a start, wait
// for the launcher's env key, encrypt the secrets to it as Phala expects
// (x25519, AES-256-GCM: hex of ephemeral key ‖ iv ‖ ciphertext and tag), sign
// the upload with a key of the books, then wait until the contract shows an
// attested bridge.
//
//   BOOKS_ACCOUNT_ID   the books' NEAR account (testnet), its key in ~/.near-credentials
//   BRIDGE_CONTRACT_ID the contract
//   LAUNCHER_URL       default http://127.0.0.1:8790
//   NEAR_RPC_URL       default https://rpc.testnet.fastnear.com
//
// Test secrets only: this sends bridge_start and nothing else. Keys are read,
// never printed.

import {
	createCipheriv,
	createHash,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	randomBytes,
	sign
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { base58 } from '@scure/base';

import { envMessage } from '../src/launcher.js';

const env = process.env;
const books = env.BOOKS_ACCOUNT_ID ?? '';
const contractId = env.BRIDGE_CONTRACT_ID ?? '';
if (!books || !contractId) {
	console.error('set BOOKS_ACCOUNT_ID and BRIDGE_CONTRACT_ID');
	process.exit(2);
}
const launcher = env.LAUNCHER_URL || 'http://127.0.0.1:8790';
const rpcUrl = env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';

const cred = JSON.parse(
	readFileSync(join(homedir(), '.near-credentials', 'testnet', `${books}.json`), 'utf8')
);
const provider = new JsonRpcProvider({ url: rpcUrl });
const account = new Account(books, provider, KeyPairSigner.fromSecretKey(cred.private_key));

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s`;
const say = (/** @type {string} */ l) => console.log(`${ts()}  ${l}`);
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Phala's env encryption (dstack-sdk encryptEnvVars).
 *
 * @param {{ key: string, value: string }[]} vars
 * @param {string} publicKeyHex the app's x25519 key
 */
export function encryptEnv(vars, publicKeyHex) {
	const theirs = createPublicKey({
		key: Buffer.concat([
			Buffer.from('302a300506032b656e032100', 'hex'),
			Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex')
		]),
		format: 'der',
		type: 'spki'
	});
	const mine = generateKeyPairSync('x25519');
	const shared = diffieHellman({ privateKey: mine.privateKey, publicKey: theirs });
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', shared, iv);
	const body = Buffer.concat([
		cipher.update(JSON.stringify({ env: vars }), 'utf8'),
		cipher.final(),
		cipher.getAuthTag()
	]);
	const ephemeral = mine.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
	return Buffer.concat([ephemeral, iv, body]).toString('hex');
}

/** @param {string} message */
function signAsBooks(message) {
	const raw = base58.decode(cred.private_key.replace(/^ed25519:/, ''));
	const key = createPrivateKey({
		key: Buffer.concat([
			Buffer.from('302e020100300506032b657004220420', 'hex'),
			Buffer.from(raw.subarray(0, 32))
		]),
		format: 'der',
		type: 'pkcs8'
	});
	return sign(null, Buffer.from(message), key).toString('base64');
}

say(`request_start for ${books}`);
const known = await provider.callFunction(contractId, 'get_books', { books }).catch(() => null);
const atMs = String(
	await account.callFunction({
		contractId,
		methodName: 'request_start',
		args: {},
		gas: 30_000_000_000_000n,
		deposit: known ? 0n : 10_000_000_000_000_000_000_000n
	})
);
say(`start at_ms ${atMs}`);

let info;
for (;;) {
	const r = await fetch(`${launcher}/v1/starts/${books}`);
	if (r.ok) {
		info = await r.json();
		if (info.at_ms === atMs) break;
	}
	await wait(2000);
}
say(`env key from the launcher, compose ${info.compose_hash.slice(0, 12)}…`);

const encrypted = encryptEnv(
	[
		{
			key: 'BELEGE_BRIDGE_SECRETS',
			value: JSON.stringify({ bridge_start: JSON.stringify({ books, at_ms: atMs }) })
		}
	],
	info.env_public_key
);
const up = await fetch(`${launcher}/v1/starts/${books}`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		at_ms: atMs,
		encrypted_env: encrypted,
		public_key: cred.public_key,
		signature: signAsBooks(envMessage(books, atMs, encrypted))
	})
});
say(`env uploaded: HTTP ${up.status} ${JSON.stringify(await up.json())}`);
if (up.status !== 202) process.exit(1);

for (;;) {
	const b = /** @type {any} */ (await provider.callFunction(contractId, 'get_books', { books }));
	if (b?.bridge?.start_at_ms === atMs && b.bridge.valid) {
		say(
			`attested bridge on NEAR: compose ${b.bridge.compose_hash.slice(0, 12)}…, node key hash ${b.bridge.peer_key_hash.slice(0, 12)}…`
		);
		break;
	}
	if (b?.request == null && !b?.bridge) {
		say('the start was answered without a bridge (see the launcher log)');
		process.exit(1);
	}
	await wait(3000);
}

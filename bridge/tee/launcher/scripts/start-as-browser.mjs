#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// start-as-browser.mjs: what the start screen will do, from a terminal, for a
// test run on testnet (#696), in two phases:
//
// 1. The books ask the contract for a start, wait for the launcher's env key,
//    encrypt the start (bridge_start, nothing secret) to it as Phala expects
//    (x25519, AES-256-GCM: hex of ephemeral key ‖ iv ‖ ciphertext and tag),
//    sign the upload with a key of the books.
// 2. Once the contract shows the VM attested, they take the VM's intake key
//    from the launcher, check its hash against the contract, seal the
//    secrets to it (dstack/intake.mjs) and upload them, signed.
//
//   BOOKS_ACCOUNT_ID   the books' NEAR account (testnet), its key in ~/.near-credentials
//   BRIDGE_CONTRACT_ID the contract
//   LAUNCHER_URL       default http://127.0.0.1:8790
//   NEAR_RPC_URL       default https://rpc.testnet.fastnear.com
//
// Test secrets only: a made-up config and account. Keys are read, never
// printed. (The start page also checks the KMS's signature over the env key.)

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

import { envMessage, secretsMessage } from '../src/launcher.js';
import { sealSecrets } from '../../dstack/intake.mjs';

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
			`attested VM on NEAR: compose ${b.bridge.compose_hash.slice(0, 12)}…, intake key hash ${b.bridge.intake_key_hash.slice(0, 12)}…`
		);
		info = b.bridge;
		break;
	}
	if (b?.request == null && !b?.bridge) {
		say('the start was answered without a bridge (see the launcher log)');
		process.exit(1);
	}
	await wait(3000);
}

const shown = await (await fetch(`${launcher}/v1/starts/${books}`)).json();
const hash = createHash('sha256')
	.update(Buffer.from(String(shown.intake_key), 'hex'))
	.digest('hex');
if (shown.at_ms !== atMs || hash !== info.intake_key_hash) {
	say('the launcher shows another intake key than the contract: nothing sent');
	process.exit(1);
}
const sealed = sealSecrets(
	JSON.stringify({ bridge_config: JSON.stringify({ devices: [] }), coingecko: 'test-not-a-key' }),
	shown.intake_key,
	books,
	atMs
);
const sent = await fetch(`${launcher}/v1/starts/${books}/secrets`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		at_ms: atMs,
		sealed,
		public_key: cred.public_key,
		signature: signAsBooks(secretsMessage(books, atMs, sealed))
	})
});
say(`secrets sealed to the attested VM: HTTP ${sent.status} ${JSON.stringify(await sent.json())}`);

import { describe, expect, it } from 'vitest';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import {
	checkEnvKey,
	encryptEnv,
	envKeySigner,
	envMessage,
	functionCallTransaction,
	intakeKeyHash,
	KNOWN_KMS,
	launcherClient,
	nearAccountOf,
	nearBooks,
	sealSecrets,
	secretsMessage,
	signedTransaction,
	startNearBridge
} from './near-bridge.js';

// A public answer of Phala Cloud's pubkey endpoint for a provisioned (never started) test app.
const signedKey = {
	kms: 'pha1-prod3',
	appId: '920ba3bbd716259609c47437fddb2792ebd54456',
	publicKey: 'd10d09347e706405e6abd4fe9178c0c1af03f14212ffbe4e3ccd6345f3c95154',
	signature:
		'647ef0e1b7dbc3323ec038f1a38cf8e8f428a3d583de30d68addc956247a575b193fb0946fd477e09b6ac018af5270fa3a99c647fe76d0a0b155de1879f4ebe400'
};

// The same vector as bridge/test/tee-dstack.test.js: what the VM opens.
const SEALED_VECTOR =
	'0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20333333333333333333333333381b10c951a9a43ddfb212d3be4fc963a927aa976c0faf24cc1054704d';
const intakeKey = bytesToHex(x25519.getPublicKey(new Uint8Array(32).fill(0x11)));

describe('the NEAR bridge', () => {
	it('takes the env key only with the KMS’s signature for that app', () => {
		expect(envKeySigner(signedKey)).toBe(KNOWN_KMS['pha1-prod3']);
		expect(() => checkEnvKey(signedKey)).not.toThrow();
		expect(() => checkEnvKey({ ...signedKey, appId: '00'.repeat(20) })).toThrow(/not signed/);
		expect(() => checkEnvKey({ ...signedKey, publicKey: 'ee'.repeat(32) })).toThrow(/not signed/);
		expect(() => checkEnvKey({ ...signedKey, kms: 'toString' })).toThrow(/unknown KMS/);
		expect(envKeySigner({ ...signedKey, signature: 'zz' })).toBeNull();
		expect(envKeySigner({ ...signedKey, timestamp: 1 })).not.toBe(KNOWN_KMS['pha1-prod3']);
	});

	it('seals the secrets as the VM opens them, and only for the key the contract shows', async () => {
		expect(intakeKey).toBe('7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13');
		const sealed = await sealSecrets({
			json: '{"imap":"pw"}',
			intakeKey,
			expectedHash: intakeKeyHash(intakeKey),
			books: 'books-a.testnet',
			atMs: '2000',
			ephemeralSeed: new Uint8Array(32).fill(0x22),
			iv: new Uint8Array(12).fill(0x33)
		});
		expect(sealed).toBe(SEALED_VECTOR);
		await expect(
			sealSecrets({ json: '{}', intakeKey, expectedHash: '00'.repeat(32), books: 'b', atMs: '1' })
		).rejects.toThrow(/not the one the contract shows/);
	});

	it('encrypts the env as Phala opens it', async () => {
		const appKey = new Uint8Array(32).fill(7);
		const hex = await encryptEnv(
			[{ key: 'A', value: 'b' }],
			bytesToHex(x25519.getPublicKey(appKey))
		);
		const box = hexToBytes(hex);
		const shared = x25519.getSharedSecret(appKey, box.slice(0, 32));
		const key = await crypto.subtle.importKey('raw', shared, 'AES-GCM', false, ['decrypt']);
		const pt = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: box.slice(32, 44) },
			key,
			box.slice(44)
		);
		expect(JSON.parse(new TextDecoder().decode(pt))).toEqual({ env: [{ key: 'A', value: 'b' }] });
	});

	it('signs uploads as the launcher checks them', () => {
		expect(envMessage('b.testnet', '2000', 'ab')).toBe(
			'belege-bridge/env/1\nb.testnet\n2000\nfb8e20fc2e4c3f248c60c39bd652f3c1347298bb977b8b4d5903b85055620603'
		);
		expect(secretsMessage('b.testnet', '2000', 'ab').startsWith('belege-bridge/secrets/1\n')).toBe(
			true
		);
	});

	it('names the books by their implicit account', () => {
		const seed = new Uint8Array(32).fill(3);
		const a = nearAccountOf(seed);
		expect(a.accountId).toBe(bytesToHex(ed25519.getPublicKey(seed)));
		expect(a.publicKey).toBe(`ed25519:${base58.encode(ed25519.getPublicKey(seed))}`);
		expect(() => nearAccountOf(new Uint8Array(31))).toThrow();
	});

	// Cross-checked once against @near-js/transactions 2.5.1 (createTransaction,
	// functionCall, encodeTransaction) for the same fields.
	it('writes a function call in Borsh as NEAR reads it', () => {
		const tx = functionCallTransaction({
			signerId: 'a.testnet',
			publicKey: new Uint8Array(32).fill(1),
			nonce: 5n,
			receiverId: 'c.testnet',
			blockHash: new Uint8Array(32).fill(2),
			methodName: 'request_start',
			args: {},
			gas: 30_000_000_000_000n,
			deposit: 10_000_000_000_000_000_000_000n
		});
		expect(bytesToHex(sha256(tx))).toBe(NEAR_JS_TX_HASH);
		expect(signedTransaction(tx, new Uint8Array(64)).length).toBe(tx.length + 65);
	});

	it('starts: NEAR first, the KMS-signed env key, the attested VM, then the sealed secrets', async () => {
		const seed = new Uint8Array(32).fill(9);
		const books = nearAccountOf(seed);
		const phases = /** @type {string[]} */ ([]);
		/** @type {any[]} */
		const posts = [];
		let views = 0;
		const near = /** @type {any} */ ({
			books,
			requestStart: async () => '2000',
			view: async () =>
				++views < 2
					? { request: { kind: 'start' } }
					: {
							bridge: {
								start_at_ms: '2000',
								valid: true,
								compose_hash: 'cc',
								intake_key_hash: intakeKeyHash(intakeKey)
							}
						}
		});
		let infos = 0;
		const launcher = launcherClient({
			url: 'https://launcher.example',
			books,
			fetch: /** @type {any} */ (
				async (/** @type {string} */ url, /** @type {any} */ init) => {
					if (init?.method === 'POST') {
						posts.push({ url, body: JSON.parse(init.body) });
						return new Response('{}', { status: 200 });
					}
					infos++;
					return new Response(
						JSON.stringify({
							at_ms: '2000',
							kms: signedKey.kms,
							app_id: signedKey.appId,
							env_public_key: signedKey.publicKey,
							env_key_signature: signedKey.signature,
							compose_hash: 'cc',
							...(infos > 1 ? { intake_key: intakeKey } : {})
						}),
						{ status: 200 }
					);
				}
			)
		});
		let asked = false;
		const r = await startNearBridge({
			near,
			launcher,
			secrets: async () => {
				asked = true;
				return { bridge_config: '{}' };
			},
			onPhase: (p) => phases.push(p),
			pollMs: 1
		});
		expect(r).toEqual({ atMs: '2000', composeHash: 'cc' });
		expect(asked).toBe(true);
		expect(phases).toEqual([
			'requested',
			'provisioned',
			'booting',
			'attested',
			'secretsHandedOver'
		]);
		expect(posts.map((p) => p.url)).toEqual([
			`https://launcher.example/v1/starts/${books.accountId}`,
			`https://launcher.example/v1/starts/${books.accountId}/secrets`
		]);
		const { sealed, signature } = posts[1].body;
		expect(
			ed25519.verify(
				Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
				new TextEncoder().encode(secretsMessage(books.accountId, '2000', sealed)),
				books.publicKeyBytes
			)
		).toBe(true);
	});

	it('reads NEAR over JSON-RPC: a missing account is not funded yet', async () => {
		const near = nearBooks({
			seed: new Uint8Array(32).fill(4),
			rpcUrl: 'https://rpc.example',
			fetch: /** @type {any} */ (
				async () => new Response(JSON.stringify({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }))
			)
		});
		expect(await near.balance()).toBeNull();
		await expect(near.view()).rejects.toThrow(/UNKNOWN_ACCOUNT/);
	});
});

const NEAR_JS_TX_HASH = '4ed92f431c2c801bd49e10862891cfd8334bcc5e78bb0c6dc1387acbf644ce96';

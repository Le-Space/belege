// The hosted bridge on Phala (Intel TDX), started and stopped through NEAR
// (#696): the second way next to Aleph (hosted-bridge.js). The books ask the
// contract (bridge/tee/near-contract) for a start; Le Space's launcher
// (bridge/tee/launcher) creates the VM; the VM proves itself to the contract
// with a TDX quote; only then this browser seals what the bridge starts with
// – the same as for Aleph (`hostedSecrets`) – to the VM's own key, whose hash
// the contract shows. The launcher carries everything and can read nothing:
//
//   1. request_start on NEAR, signed with the books' NEAR key
//   2. the launcher provisions; this browser checks the KMS's signature over
//      the app's env key and sends the start (nothing secret), signed
//   3. the VM boots and proves itself; the contract checks the quote
//      (DCAP, measurements, compose hash, machine) and keeps the hash of the
//      VM's intake key
//   4. this browser seals the secrets to the intake key whose hash the
//      contract shows, and hands them over, signed
//   5. the bridge runs, dials out to the books' relays and is paired
//
// NEAR is spoken here directly over JSON-RPC (a function-call transaction in
// Borsh, signed with ed25519), without a NEAR SDK in the app.

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

const env = import.meta.env ?? {};

/** Where the books talk to: NEAR testnet and Le Space's launcher. */
export const NEAR_BRIDGE = Object.freeze({
	rpcUrl: env.VITE_NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com',
	contractId: env.VITE_NEAR_BRIDGE_CONTRACT || 'belege-bridge2-855939.testnet',
	launcherUrl: env.VITE_NEAR_BRIDGE_LAUNCHER || 'https://bridge-launcher.le-space.de'
});

/** The sealed settings record with the books' NEAR key (32-byte ed25519 seed, hex). */
export const NEAR_KEY_SETTING = 'bridge/near-key';

/** What the contract asks of new books, once (0.01 NEAR), in yoctoNEAR. */
export const BOOKS_STORAGE = 10_000_000_000_000_000_000_000n;
const TGAS = 1_000_000_000_000n;

export const PHASES = /** @type {const} */ ([
	'requested',
	'provisioned',
	'booting',
	'attested',
	'secretsHandedOver'
]);

const encoder = new TextEncoder();

/** @param {...Uint8Array} parts */
function concat(...parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
};
/** @param {string} b64 */
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// --- the books' NEAR account -------------------------------------------------

/**
 * The books' implicit NEAR account: its id is the hex of the public key, so
 * it exists once someone sends it NEAR. No wallet, no name to register.
 *
 * @param {Uint8Array} seed 32 bytes
 */
export function nearAccountOf(seed) {
	if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('not a NEAR key');
	const pub = ed25519.getPublicKey(seed);
	return {
		accountId: bytesToHex(pub),
		publicKey: `ed25519:${base58.encode(pub)}`,
		publicKeyBytes: pub,
		/** @param {Uint8Array} message */
		sign: (message) => ed25519.sign(message, seed)
	};
}

/**
 * The books' NEAR key from the sealed settings; made on the owner's device
 * when there is none and `create` is not false.
 *
 * @param {{ list: (o?: any) => Promise<any[]>, put: (r: any) => Promise<any> }} settings
 * @param {{ create?: boolean }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function ensureNearKey(settings, { create } = {}) {
	const records = await settings.list({
		where: (/** @type {any} */ r) => r.key === NEAR_KEY_SETTING
	});
	for (const { value } of [...records].reverse()) {
		if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) return hexToBytes(value);
	}
	if (create === false) return null;
	const seed = ed25519.utils.randomSecretKey();
	await settings.put({ key: NEAR_KEY_SETTING, value: bytesToHex(seed) });
	return seed;
}

// --- NEAR over JSON-RPC --------------------------------------------------------

/** Borsh, as much as a function call needs. */
class Writer {
	/** @type {number[]} */
	bytes = [];
	/** @param {number} n */
	u8(n) {
		this.bytes.push(n & 0xff);
	}
	/** @param {number} n */
	u32(n) {
		for (let i = 0; i < 4; i++) this.u8(n >>> (8 * i));
	}
	/** @param {bigint} n @param {number} size */
	uint(n, size) {
		let v = BigInt(n);
		for (let i = 0; i < size; i++) {
			this.u8(Number(v & 0xffn));
			v >>= 8n;
		}
	}
	/** @param {Uint8Array} b */
	fixed(b) {
		for (const x of b) this.u8(x);
	}
	/** @param {Uint8Array} b */
	vec(b) {
		this.u32(b.length);
		this.fixed(b);
	}
	/** @param {string} s */
	string(s) {
		this.vec(encoder.encode(s));
	}
}

/**
 * A NEAR transaction with one FunctionCall action, in Borsh.
 *
 * @param {{ signerId: string, publicKey: Uint8Array, nonce: bigint, receiverId: string, blockHash: Uint8Array, methodName: string, args: any, gas: bigint, deposit: bigint }} t
 */
export function functionCallTransaction(t) {
	const w = new Writer();
	w.string(t.signerId);
	w.u8(0); // ed25519
	w.fixed(t.publicKey);
	w.uint(t.nonce, 8);
	w.string(t.receiverId);
	w.fixed(t.blockHash);
	w.u32(1); // one action
	w.u8(2); // FunctionCall
	w.string(t.methodName);
	w.vec(encoder.encode(JSON.stringify(t.args ?? {})));
	w.uint(t.gas, 8);
	w.uint(t.deposit, 16);
	return Uint8Array.from(w.bytes);
}

/** @param {Uint8Array} tx @param {Uint8Array} signature 64 bytes */
export function signedTransaction(tx, signature) {
	return concat(tx, Uint8Array.of(0), signature);
}

/**
 * The books on NEAR: their account, the contract's view, start and stop.
 *
 * @param {{ seed: Uint8Array, rpcUrl?: string, contractId?: string, fetch?: typeof fetch }} o
 */
export function nearBooks({
	seed,
	rpcUrl = NEAR_BRIDGE.rpcUrl,
	contractId = NEAR_BRIDGE.contractId,
	fetch: f = (...a) => globalThis.fetch(...a)
}) {
	const books = nearAccountOf(seed);
	/** @param {string} method @param {any} params */
	async function rpc(method, params) {
		const res = await f(rpcUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 'belege', method, params })
		});
		const body = await res.json().catch(() => ({}));
		if (body.error) {
			const e = body.error;
			throw new Error(`NEAR: ${e.cause?.name ?? e.name ?? 'error'}`);
		}
		if (!res.ok) throw new Error(`NEAR: HTTP ${res.status}`);
		return body.result;
	}
	/** @param {string} method @param {any} args */
	async function view(method, args) {
		const r = await rpc('query', {
			request_type: 'call_function',
			finality: 'final',
			account_id: contractId,
			method_name: method,
			args_base64: toBase64(encoder.encode(JSON.stringify(args)))
		});
		return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
	}
	/** @param {string} methodName @param {bigint} deposit */
	async function call(methodName, deposit) {
		const key = await rpc('query', {
			request_type: 'view_access_key',
			finality: 'final',
			account_id: books.accountId,
			public_key: books.publicKey
		});
		const tx = functionCallTransaction({
			signerId: books.accountId,
			publicKey: books.publicKeyBytes,
			nonce: BigInt(key.nonce) + 1n,
			receiverId: contractId,
			blockHash: base58.decode(key.block_hash),
			methodName,
			args: {},
			gas: 30n * TGAS,
			deposit
		});
		const signed = signedTransaction(tx, books.sign(sha256(tx)));
		const out = await rpc('send_tx', {
			signed_tx_base64: toBase64(signed),
			wait_until: 'EXECUTED_OPTIMISTIC'
		});
		const status = out?.status ?? {};
		if (status.Failure) throw new Error(`NEAR: ${methodName} failed`);
		if (typeof status.SuccessValue !== 'string')
			throw new Error(`NEAR: ${methodName} not executed`);
		const text = new TextDecoder().decode(fromBase64(status.SuccessValue));
		return text ? JSON.parse(text) : null;
	}
	return {
		books,
		/** yoctoNEAR, or null while the account does not exist (not funded yet). */
		async balance() {
			try {
				const a = await rpc('query', {
					request_type: 'view_account',
					finality: 'final',
					account_id: books.accountId
				});
				return BigInt(a.amount);
			} catch {
				return null;
			}
		},
		/** @returns {Promise<any>} grants, the open request, the attested bridge */
		view: () => view('get_books', { books: books.accountId }),
		/** The start's time, as the contract keeps it. */
		async requestStart() {
			const known = await view('get_books', { books: books.accountId }).catch(() => null);
			return String(await call('request_start', known ? 0n : BOOKS_STORAGE));
		},
		async requestStop() {
			return String(await call('request_stop', 0n));
		}
	};
}

// --- the env key and the secrets -----------------------------------------------

/**
 * The KMS this app trusts, by Phala Cloud's slug: its secp256k1 key as Phala
 * publishes it (`kms_info.k256_pubkey`), pinned here, not taken from the launcher.
 * One cluster ("Phala KMS 2026-11"), one key: Phala names its nodes by
 * several slugs and provisions on whichever has room.
 */
const PHALA_KMS_2026_11 = '0221797a507c4240f318dede4829d0a2f84d01331e82f3f43c8f5746451c9d5e20';
export const KNOWN_KMS = Object.freeze({
	'pha1-prod3': PHALA_KMS_2026_11,
	'pha1-prod4': PHALA_KMS_2026_11,
	phala: PHALA_KMS_2026_11
});

const ENV_KEY_PREFIX = encoder.encode('dstack-env-encrypt-pubkey:');

/** @param {string} text @param {number} length */
function hexOf(text, length) {
	const clean = String(text ?? '').replace(/^0x/i, '');
	if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(clean)) return null;
	return hexToBytes(clean.toLowerCase());
}

/**
 * The compressed key that signed an app's env key (dstack's
 * verifyEnvEncryptPublicKey: keccak-256 over the prefix, the app id,
 * [a timestamp] and the key; secp256k1, recoverable), or null.
 *
 * @param {{ appId: string, publicKey: string, signature: string, timestamp?: number|bigint }} o
 */
export function envKeySigner({ appId, publicKey, signature, timestamp }) {
	const app = hexOf(appId, 20);
	const pub = hexOf(publicKey, 32);
	const sig = hexOf(signature, 65);
	if (!app || !pub || !sig || sig[64] > 1) return null;
	const parts = [ENV_KEY_PREFIX, app];
	if (timestamp !== undefined) {
		const ts = new Uint8Array(8);
		new DataView(ts.buffer).setBigUint64(0, BigInt(timestamp));
		parts.push(ts);
	}
	parts.push(pub);
	try {
		// noble's recovered form: the recovery bit first, then r ‖ s.
		const recovered = concat(Uint8Array.of(sig[64]), sig.slice(0, 64));
		const key = secp256k1.recoverPublicKey(recovered, keccak_256(concat(...parts)), {
			prehash: false
		});
		return bytesToHex(key);
	} catch {
		return null;
	}
}

/**
 * Throws unless a KMS this app knows signed `publicKey` for `appId`.
 * @param {{ kms: string, appId: string, publicKey: string, signature: string, timestamp?: number }} o
 */
export function checkEnvKey({ kms, ...signed }) {
	const expected = Object.hasOwn(KNOWN_KMS, kms)
		? KNOWN_KMS[/** @type {keyof typeof KNOWN_KMS} */ (kms)]
		: null;
	if (!expected) throw new Error(`unknown KMS ${String(kms).slice(0, 40)}`);
	if (envKeySigner(signed) !== expected) throw new Error('the env key is not signed by the KMS');
}

/**
 * Phala's env encryption (dstack-sdk encryptEnvVars): x25519 with an
 * ephemeral key, the shared secret as the AES-256-GCM key.
 * @param {{ key: string, value: string }[]} vars @param {string} publicKeyHex
 */
export async function encryptEnv(vars, publicKeyHex) {
	const eph = x25519.utils.randomSecretKey();
	const shared = x25519.getSharedSecret(eph, hexToBytes(publicKeyHex.replace(/^0x/, '')));
	const key = await crypto.subtle.importKey('raw', shared, 'AES-GCM', false, ['encrypt']);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			encoder.encode(JSON.stringify({ env: vars }))
		)
	);
	shared.fill(0);
	return bytesToHex(concat(x25519.getPublicKey(eph), iv, ct));
}

export const SECRETS_DOMAIN = 'belege-bridge/secrets/1';

/** hex SHA-256 of an intake key, as the contract keeps it. @param {string} intakeHex */
export const intakeKeyHash = (intakeHex) => bytesToHex(sha256(hexToBytes(intakeHex)));

/**
 * Seal the secrets to the attested VM's intake key (the VM's side:
 * bridge/tee/dstack/intake.mjs). Refuses a key whose hash is not the one
 * the contract shows.
 *
 * @param {{ json: string, intakeKey: string, expectedHash: string, books: string, atMs: string, ephemeralSeed?: Uint8Array, iv?: Uint8Array }} o
 */
export async function sealSecrets({
	json,
	intakeKey,
	expectedHash,
	books,
	atMs,
	ephemeralSeed,
	iv
}) {
	if (!/^[0-9a-f]{64}$/.test(intakeKey)) throw new Error('not an intake key');
	if (intakeKeyHash(intakeKey) !== expectedHash)
		throw new Error('the intake key is not the one the contract shows: nothing sent');
	const intake = hexToBytes(intakeKey);
	const eph = ephemeralSeed ?? x25519.utils.randomSecretKey();
	const ephPub = x25519.getPublicKey(eph);
	const shared = x25519.getSharedSecret(eph, intake);
	const raw = hkdf(sha256, shared, concat(ephPub, intake), encoder.encode(SECRETS_DOMAIN), 32);
	const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
	const nonce = iv ? new Uint8Array(iv) : crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: nonce,
				additionalData: encoder.encode(`${SECRETS_DOMAIN}\n${books}\n${atMs}`)
			},
			key,
			encoder.encode(json)
		)
	);
	raw.fill(0);
	shared.fill(0);
	return bytesToHex(concat(ephPub, nonce, ct));
}

// --- the launcher ----------------------------------------------------------------

const digest = (/** @type {string} */ text) => bytesToHex(sha256(encoder.encode(text)));
/** @param {string} books @param {string} atMs @param {string} hex */
export const envMessage = (books, atMs, hex) =>
	`belege-bridge/env/1\n${books}\n${atMs}\n${digest(hex)}`;
/** @param {string} books @param {string} atMs @param {string} hex */
export const secretsMessage = (books, atMs, hex) =>
	`belege-bridge/secrets/1\n${books}\n${atMs}\n${digest(hex)}`;

/**
 * Le Space's launcher: creates and deletes the VM and carries what this
 * browser hands the VM. Trusted with nothing: the env key must carry the
 * KMS's signature, the intake key must hash to what the contract shows, and
 * every upload is signed by the books' NEAR key, which the launcher checks.
 *
 * @param {{ url?: string, books: { accountId: string, publicKey: string, sign: (m: Uint8Array) => Uint8Array }, fetch?: typeof fetch }} o
 */
export function launcherClient({
	url = NEAR_BRIDGE.launcherUrl,
	books,
	fetch: f = (...a) => globalThis.fetch(...a)
}) {
	const startUrl = `${url.replace(/\/+$/, '')}/v1/starts/${encodeURIComponent(books.accountId)}`;
	/** @param {string} message */
	const signed = (message) => ({
		public_key: books.publicKey,
		signature: toBase64(books.sign(encoder.encode(message)))
	});
	/** @param {string} u @param {any} body */
	async function post(u, body) {
		const res = await f(u, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const answer = await res.json().catch(() => ({}));
		if (!res.ok)
			throw new Error(`launcher: ${String(answer.error ?? `HTTP ${res.status}`).slice(0, 120)}`);
		return answer;
	}
	return {
		/** What the launcher shows for this start, or null. */
		async info() {
			const res = await f(startUrl);
			return res.ok ? res.json() : null;
		},
		/** Phase 1: the start (nothing secret), encrypted to the app's env key once the KMS's signature holds. @param {any} info @param {string} atMs */
		async sendStart(info, atMs) {
			checkEnvKey({
				kms: info.kms,
				appId: info.app_id,
				publicKey: info.env_public_key,
				signature: info.env_key_signature
			});
			const sealedEnv = await encryptEnv(
				[
					{
						key: 'BELEGE_BRIDGE_SECRETS',
						value: JSON.stringify({
							bridge_start: JSON.stringify({ books: books.accountId, at_ms: atMs })
						})
					}
				],
				info.env_public_key
			);
			return post(startUrl, {
				at_ms: atMs,
				encrypted_env: sealedEnv,
				...signed(envMessage(books.accountId, atMs, sealedEnv))
			});
		},
		/** Phase 2: the secrets, sealed to the attested VM's intake key. @param {{ intakeKey: string, expectedHash: string, atMs: string, secrets: Record<string, string> }} o */
		async sendSecrets({ intakeKey, expectedHash, atMs, secrets }) {
			const sealed = await sealSecrets({
				json: JSON.stringify(secrets),
				intakeKey,
				expectedHash,
				books: books.accountId,
				atMs
			});
			return post(`${startUrl}/secrets`, {
				at_ms: atMs,
				sealed,
				...signed(secretsMessage(books.accountId, atMs, sealed))
			});
		}
	};
}

// --- a start and a stop ------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Each step waits on what it can check itself: the launcher's answers only
 * count once NEAR or a signature confirms them.
 *
 * @param {{
 *   near: ReturnType<typeof nearBooks>,
 *   launcher: ReturnType<typeof launcherClient>,
 *   secrets: () => Promise<Record<string, string>>,
 *   onPhase?: (phase: (typeof PHASES)[number], detail?: any) => void,
 *   pollMs?: number,
 *   timeoutMs?: number
 * }} o `secrets` is asked for only once the VM is attested
 */
export async function startNearBridge({
	near,
	launcher,
	secrets,
	onPhase = () => {},
	pollMs = 3000,
	timeoutMs = 12 * 60_000
}) {
	const until = Date.now() + timeoutMs;
	const due = () => {
		if (Date.now() > until) throw new Error('the start took too long');
	};
	const atMs = await near.requestStart();
	onPhase('requested', { atMs });

	let info;
	for (;;) {
		due();
		info = await launcher.info().catch(() => null);
		if (info?.at_ms === atMs && info.env_public_key) break;
		await sleep(pollMs);
	}
	onPhase('provisioned', { composeHash: info.compose_hash });
	await launcher.sendStart(info, atMs);
	onPhase('booting');

	let bridge;
	for (;;) {
		due();
		const b = await near.view().catch(() => null);
		if (b?.bridge?.start_at_ms === atMs && b.bridge.valid) {
			bridge = b.bridge;
			break;
		}
		if (b && !b.request && !b.bridge) throw new Error('the start was answered without a VM');
		await sleep(pollMs);
	}
	onPhase('attested', { composeHash: bridge.compose_hash });

	for (;;) {
		due();
		info = await launcher.info().catch(() => null);
		if (info?.at_ms === atMs && info.intake_key) break;
		await sleep(pollMs);
	}
	await launcher.sendSecrets({
		intakeKey: info.intake_key,
		expectedHash: bridge.intake_key_hash,
		atMs,
		secrets: await secrets()
	});
	onPhase('secretsHandedOver');
	return { atMs, composeHash: String(bridge.compose_hash) };
}

/** @param {{ near: ReturnType<typeof nearBooks>, pollMs?: number, timeoutMs?: number }} o */
export async function stopNearBridge({ near, pollMs = 3000, timeoutMs = 3 * 60_000 }) {
	const atMs = await near.requestStop();
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		const b = await near.view().catch(() => null);
		if (b && !b.request) return { atMs };
		await sleep(pollMs);
	}
	throw new Error('the stop was not answered in time');
}

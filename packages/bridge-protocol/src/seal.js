// SPDX-License-Identifier: AGPL-3.0-or-later
// A call to the bridge and its answer, sealed above the connection.
//
// The connection between a device and the bridge is Noise: a key agreement
// made for that connection. A device of the books and their bridge also hold
// a key in common from before – the bridge's own key, 32 bytes, which the
// device proves at the gate (@belege/device-gate) and which never travels on
// a connection once the bridge is paired. With it, what a call carries is
// sealed a second time, symmetrically: the arguments by the device, the
// answer by the bridge. What a call says then rests on that key too, not on
// the connection's key agreement alone.
//
//   key      HKDF-SHA-256(secret, salt = the call's nonce, info = context)
//   context  "belege/bridge-seal/v1" \n direction \n consumer \n provider \n command
//   sealed   AES-256-GCM, the context as additional data
//
//   a call    { "$sealed": base64(nonce[32] ‖ iv[12] ‖ ciphertext) }   of the arguments' JSON
//   an answer { "$sealed": base64(iv[12] ‖ ciphertext) }               of the answer's JSON
//
// The nonce is made for the call; the answer's key comes from the same nonce
// with the other direction, so an answer opens only for the call it answers,
// between these two peers, for this command. Nothing here is a new secret on
// disk: the key is the one both sides hold already.
//
// The handover (the call that brings the bridge its key) cannot be sealed
// with that key. It is sealed with one from the invitation's secret instead,
// which the device got from the bridge's own screen or terminal
// (`handoverSecret`).
//
// Runs in a browser and in Node: WebCrypto only.

import { fromBase64, toBase64 } from './blocks.js';

/** What a peer says in `help` when it seals: the version of this layout. */
export const SEAL_VERSION = 1;
/** The one member of a sealed call's arguments and of a sealed answer. */
export const SEALED = '$sealed';

const DOMAIN = 'belege/bridge-seal/v1';
const HANDOVER_DOMAIN = 'belege/bridge-handover/v1';
const NONCE_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed call or answer that does not open, or is none. */
export class SealError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'SealError';
	}
}

/**
 * @typedef {object} SealContext who calls whom with what: a sealed call opens for these only
 * @property {string} consumer the calling device's peer id
 * @property {string} provider the answering peer's id
 * @property {string} command the command's name
 */

/** Whether arguments or an answer are sealed. @param {unknown} value */
export const isSealed = (value) =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	typeof (/** @type {any} */ (value)[SEALED]) === 'string';

/**
 * What `n` bytes of JSON take once sealed, as the JSON that travels: the
 * nonce, the IV and the tag on top, base64, and the member's name.
 *
 * @param {number} n
 */
export const sealedSize = (n) =>
	Math.ceil((n + NONCE_BYTES + IV_BYTES + TAG_BYTES) / 3) * 4 + SEALED.length + 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** @param {unknown} secret */
function checkSecret(secret) {
	if (!(secret instanceof Uint8Array) || secret.length !== 32 || secret.every((b) => b === 0)) {
		throw new SealError('the key must be 32 bytes');
	}
}

/** @param {SealContext} context @param {'call' | 'answer'} direction */
function contextBytes(context, direction) {
	const parts = [context?.consumer, context?.provider, context?.command];
	if (!parts.every((p) => typeof p === 'string' && p.length > 0 && !/[\n\r]/.test(p))) {
		throw new SealError('the context names the two peers and the command');
	}
	return encoder.encode([DOMAIN, direction, ...parts].join('\n'));
}

/**
 * @param {Uint8Array} secret @param {Uint8Array} nonce @param {Uint8Array} info
 * @param {KeyUsage} usage
 */
async function keyOf(secret, nonce, info, usage) {
	const base = await crypto.subtle.importKey('raw', Uint8Array.from(secret), 'HKDF', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: Uint8Array.from(nonce), info: Uint8Array.from(info) },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage]
	);
}

/** @param {Uint8Array[]} parts */
function concat(...parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** @param {unknown} sealed @param {number} least */
function bytesOf(sealed, least) {
	if (!isSealed(sealed)) throw new SealError('not sealed');
	let bytes;
	try {
		bytes = fromBase64(/** @type {any} */ (sealed)[SEALED]);
	} catch {
		throw new SealError('not sealed');
	}
	if (bytes.length < least) throw new SealError('not sealed');
	return bytes;
}

/**
 * @param {Uint8Array} secret @param {Uint8Array} nonce @param {SealContext} context
 * @param {'call' | 'answer'} direction @param {unknown} value @param {Uint8Array} iv
 */
async function sealJson(secret, nonce, context, direction, value, iv) {
	const info = contextBytes(context, direction);
	const key = await keyOf(secret, nonce, info, 'encrypt');
	const text = JSON.stringify(value ?? null);
	return new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: Uint8Array.from(iv), additionalData: info },
			key,
			encoder.encode(text)
		)
	);
}

/**
 * @param {Uint8Array} secret @param {Uint8Array} nonce @param {SealContext} context
 * @param {'call' | 'answer'} direction @param {Uint8Array} iv @param {Uint8Array} cipher
 */
async function openJson(secret, nonce, context, direction, iv, cipher) {
	const info = contextBytes(context, direction);
	const key = await keyOf(secret, nonce, info, 'decrypt');
	let plain;
	try {
		plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: Uint8Array.from(iv), additionalData: info },
			key,
			Uint8Array.from(cipher)
		);
	} catch {
		throw new SealError('the seal does not open: another key, another call or changed bytes');
	}
	try {
		return JSON.parse(decoder.decode(plain));
	} catch {
		throw new SealError('what was sealed is no JSON');
	}
}

/**
 * The calling side: seal the arguments, and open the answer to this call.
 *
 * @param {Uint8Array} secret the key both sides hold, 32 bytes
 * @param {SealContext} context
 * @param {unknown} args the arguments, as they would go unsealed
 * @param {{ nonce?: Uint8Array, iv?: Uint8Array }} [fixed] a test vector's fixed values
 * @returns {Promise<{ sent: Record<string, string>, open: (answer: unknown) => Promise<any> }>}
 */
export async function sealCall(secret, context, args, fixed = {}) {
	checkSecret(secret);
	const nonce = fixed.nonce ?? crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
	if (nonce.length !== NONCE_BYTES || iv.length !== IV_BYTES) throw new SealError('fixed values');
	const cipher = await sealJson(secret, nonce, context, 'call', args, iv);
	return {
		sent: { [SEALED]: toBase64(concat(nonce, iv, cipher)) },
		async open(answer) {
			const bytes = bytesOf(answer, IV_BYTES + TAG_BYTES);
			return openJson(
				secret,
				nonce,
				context,
				'answer',
				bytes.subarray(0, IV_BYTES),
				bytes.subarray(IV_BYTES)
			);
		}
	};
}

/**
 * The answering side: open the arguments, and seal the answer to this call.
 *
 * @param {Uint8Array} secret
 * @param {SealContext} context
 * @param {unknown} sent the arguments as they came
 * @returns {Promise<{ args: any, seal: (answer: unknown, fixed?: { iv?: Uint8Array }) => Promise<Record<string, string>> }>}
 */
export async function openCall(secret, context, sent) {
	checkSecret(secret);
	const bytes = bytesOf(sent, NONCE_BYTES + IV_BYTES + TAG_BYTES);
	// A copy: the answer's key comes from it after the caller's buffer may be gone.
	const nonce = Uint8Array.from(bytes.subarray(0, NONCE_BYTES));
	const args = await openJson(
		secret,
		nonce,
		context,
		'call',
		bytes.subarray(NONCE_BYTES, NONCE_BYTES + IV_BYTES),
		bytes.subarray(NONCE_BYTES + IV_BYTES)
	);
	return {
		args,
		async seal(answer, fixed = {}) {
			const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
			if (iv.length !== IV_BYTES) throw new SealError('fixed values');
			const cipher = await sealJson(secret, nonce, context, 'answer', answer, iv);
			return { [SEALED]: toBase64(concat(iv, cipher)) };
		}
	};
}

/**
 * The key a handover is sealed with: from the invitation's secret, which the
 * device read off the bridge and which the pairing proof uses as it is.
 *
 * @param {Uint8Array} invitationSecret 32 bytes
 * @returns {Promise<Uint8Array>} 32 bytes
 */
export async function handoverSecret(invitationSecret) {
	checkSecret(invitationSecret);
	const base = await crypto.subtle.importKey(
		'raw',
		Uint8Array.from(invitationSecret),
		'HKDF',
		false,
		['deriveBits']
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: new Uint8Array(0),
				info: encoder.encode(HANDOVER_DOMAIN)
			},
			base,
			256
		)
	);
}

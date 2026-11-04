// Joining the books as a member (#611): two short texts, no network protocol
// before the device proof.
//
//   1. The joining device shows a join code (`belege-join:…`, also as a QR
//      code): a one-time x25519 public key, the member's write identity (a DID
//      from the member's own root, member-vault.js) and this device's peer id.
//      Nothing in it is secret: it may go by mail or chat.
//   2. The owner pastes it under "Mitglied aufnehmen". The owner's device
//      seals the member bundle to that one-time key – ECDH with a key of its
//      own, then HKDF, as the book move does (move/book-move.js) – and answers
//      with `belege-member:…`. Only the device that made the code opens it,
//      and its one-time key lives in memory only, until it has.
//
// Both sides show the same four groups of four (the key's fingerprint), so
// a code swapped on the way is seen.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { sealer } from '../db-encryption.js';
import { keyFingerprint } from '../move/book-move.js';
import { decodeBundle, encodeBundle } from './member-vault.js';

const JOIN_PREFIX = 'belege-join:';
const ANSWER_PREFIX = 'belege-member:';
const VERSION = 1;
const HKDF_INFO = new TextEncoder().encode('belege/member-join/v1');
const DID = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/;
const PEER_ID = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;

export class JoinError extends Error {
	/**
	 * @param {string} message
	 * @param {'code' | 'answer' | 'otherCode'} [code] what went wrong, for the person's text
	 */
	constructor(message, code = 'code') {
		super(message);
		this.name = 'JoinError';
		this.code = code;
	}
}

/** @param {Uint8Array} bytes */
const b64url = (bytes) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
/** @param {string} text */
function unb64url(text) {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
		c.charCodeAt(0)
	);
}
/** @param {unknown} value */
const textOf = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));
/** @param {string} text */
function valueOf(text) {
	try {
		return JSON.parse(new TextDecoder().decode(unb64url(text)));
	} catch {
		return null;
	}
}

/**
 * @typedef {object} JoinRequest what a join code says
 * @property {Uint8Array} publicKey the one-time x25519 key
 * @property {string} writer the member's write identity (did:key)
 * @property {string} device the joining device's peer id
 * @property {string} label how the member calls themselves
 */

/**
 * A join code for this device: the one-time key pair stays here, in memory.
 *
 * @param {{ writer: string, device: string, label: string }} p
 * @returns {{ secretKey: Uint8Array, publicKey: Uint8Array, text: string, fingerprint: string }}
 */
export function createJoinRequest({ writer, device, label }) {
	if (!DID.test(writer)) throw new JoinError('The write identity is no DID.');
	if (!PEER_ID.test(device)) throw new JoinError('The device id is no peer id.');
	const { secretKey, publicKey } = x25519.keygen();
	const text = `${JOIN_PREFIX}${textOf({
		v: VERSION,
		key: b64url(publicKey),
		writer,
		device,
		label: String(label ?? '').slice(0, 60)
	})}`;
	return { secretKey, publicKey, text, fingerprint: keyFingerprint(publicKey) };
}

/**
 * A join code as the owner reads it, typed or scanned.
 *
 * @param {string} text
 * @returns {JoinRequest & { fingerprint: string }}
 */
export function parseJoinRequest(text) {
	const s = String(text ?? '').trim();
	if (!s.startsWith(JOIN_PREFIX)) throw new JoinError('That is no join code.');
	const v = valueOf(s.slice(JOIN_PREFIX.length));
	if (v?.v !== VERSION) throw new JoinError('That join code is of another version.');
	let publicKey;
	try {
		publicKey = unb64url(String(v.key));
	} catch {
		throw new JoinError('That join code is damaged.');
	}
	if (publicKey.length !== 32) throw new JoinError('That join code is damaged.');
	if (!DID.test(String(v.writer))) throw new JoinError('That join code names no write identity.');
	if (!PEER_ID.test(String(v.device))) throw new JoinError('That join code names no device.');
	return {
		publicKey,
		writer: v.writer,
		device: v.device,
		label: String(v.label ?? '').slice(0, 60),
		fingerprint: keyFingerprint(publicKey)
	};
}

/** @param {Uint8Array} shared @param {Uint8Array} ephemeral @param {Uint8Array} target */
const joinKey = (shared, ephemeral, target) =>
	hkdf(sha256, shared, new Uint8Array([...ephemeral, ...target]), HKDF_INFO, 32);

/**
 * The owner's answer: the member bundle sealed to the join code's key.
 *
 * @param {{ request: JoinRequest, bundle: import('./member-vault.js').MemberBundle }} p
 * @returns {Promise<string>}
 */
export async function sealJoinAnswer({ request, bundle }) {
	const ephemeral = x25519.keygen();
	const shared = x25519.getSharedSecret(ephemeral.secretKey, request.publicKey);
	const key = joinKey(shared, ephemeral.publicKey, request.publicKey);
	const sealed = await (await sealer(key)).seal(new TextEncoder().encode(encodeBundle(bundle)));
	return `${ANSWER_PREFIX}${textOf({
		v: VERSION,
		ephemeral: b64url(ephemeral.publicKey),
		to: keyFingerprint(request.publicKey),
		sealed: b64url(sealed)
	})}`;
}

/**
 * The answer, opened on the device that made the join code.
 *
 * @param {string} text
 * @param {{ secretKey: Uint8Array, publicKey: Uint8Array }} key this device's one-time key
 * @returns {Promise<import('./member-vault.js').MemberBundle>}
 */
export async function openJoinAnswer(text, key) {
	const s = String(text ?? '').trim();
	if (!s.startsWith(ANSWER_PREFIX))
		throw new JoinError('That is no answer to a join code.', 'answer');
	const v = valueOf(s.slice(ANSWER_PREFIX.length));
	if (v?.v !== VERSION) throw new JoinError('That answer is of another version.', 'answer');
	if (v.to !== keyFingerprint(key.publicKey)) {
		throw new JoinError('That answer was sealed for another join code.', 'otherCode');
	}
	let bytes;
	try {
		const ephemeral = unb64url(String(v.ephemeral));
		const shared = x25519.getSharedSecret(key.secretKey, ephemeral);
		bytes = await (
			await sealer(joinKey(shared, ephemeral, key.publicKey))
		).open(unb64url(String(v.sealed)));
	} catch {
		throw new JoinError('That answer does not open here, or it was changed.', 'answer');
	}
	return decodeBundle(new TextDecoder().decode(bytes));
}

/**
 * The books' fingerprint: four groups of four from their identity, shown on
 * the owner's screen with the answer and on the member's before it is kept –
 * so an answer from other books than the owner's is seen.
 *
 * @param {{ did: string, identityHash: string }} books
 */
export const booksFingerprint = (books) =>
	keyFingerprint(new TextEncoder().encode(`${books.did}\n${books.identityHash}`));

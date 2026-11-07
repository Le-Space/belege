// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the bridge's secrets reach the attested VM (#696). The VM boots
// without them and makes an X25519 key of its own; the hash of its public
// key is in the quote the NEAR contract checks. Only when the contract shows
// the VM as attested does the browser seal the secrets to that key:
//
//   shared = X25519(ephemeral, intake key)
//   key    = HKDF-SHA256(shared, salt = ephemeral pub ‖ intake pub, info = DOMAIN)
//   sealed = hex(ephemeral pub (32) ‖ iv (12) ‖ AES-256-GCM(secrets JSON, aad))
//   aad    = DOMAIN "\n" books "\n" start ms
//
// The aad ties the secrets to one start of one set of books. The start page
// (Le-Space/belege-bridge-near) does the same with noble-curves; the shared
// test vector in bridge/test/tee-dstack.test.js keeps both in step.

import {
	createCipheriv,
	createDecipheriv,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	hkdfSync,
	randomBytes
} from 'node:crypto';

export const SECRETS_DOMAIN = 'belege-bridge/secrets/1';
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

/** @param {Buffer} raw */
const publicKeyOf = (raw) =>
	createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: 'der', type: 'spki' });
/** @param {Buffer} raw */
const privateKeyOf = (raw) =>
	createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw]), format: 'der', type: 'pkcs8' });

/** @param {string} books @param {string|number} atMs */
export const aadOf = (books, atMs) => Buffer.from(`${SECRETS_DOMAIN}\n${books}\n${atMs}`);

/** A fresh intake key; `publicKey` is the raw 32 bytes, hex. */
export function intakeKey() {
	const { publicKey, privateKey } = generateKeyPairSync('x25519');
	return {
		privateKey,
		publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex')
	};
}

/** An intake key from a fixed seed: for test vectors only. @param {Buffer} seed */
export function intakeKeyFromSeed(seed) {
	const privateKey = privateKeyOf(seed);
	return {
		privateKey,
		publicKey: createPublicKey(privateKey)
			.export({ format: 'der', type: 'spki' })
			.subarray(12)
			.toString('hex')
	};
}

/**
 * @param {Buffer} shared @param {Buffer} ephemeral @param {Buffer} intake
 */
const aesKey = (shared, ephemeral, intake) =>
	Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, intake]), SECRETS_DOMAIN, 32));

/**
 * Seal for an intake key (the browser's side; here for tests and scripts).
 *
 * @param {string} json @param {string} intakeHex @param {string} books @param {string|number} atMs
 * @param {{ ephemeralSeed?: Buffer, iv?: Buffer }} [fixed] a test vector's fixed values
 */
export function sealSecrets(json, intakeHex, books, atMs, fixed = {}) {
	const intake = Buffer.from(intakeHex, 'hex');
	const eph = fixed.ephemeralSeed
		? privateKeyOf(fixed.ephemeralSeed)
		: generateKeyPairSync('x25519').privateKey;
	const ephPub = createPublicKey(eph).export({ format: 'der', type: 'spki' }).subarray(12);
	const shared = diffieHellman({ privateKey: eph, publicKey: publicKeyOf(intake) });
	const iv = fixed.iv ?? randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', aesKey(shared, ephPub, intake), iv);
	cipher.setAAD(aadOf(books, atMs));
	const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final(), cipher.getAuthTag()]);
	return Buffer.concat([ephPub, iv, ct]).toString('hex');
}

/**
 * Open what the browser sealed; throws on anything else.
 *
 * @param {string} sealedHex @param {{ privateKey: import('node:crypto').KeyObject, publicKey: string }} key
 * @param {string} books @param {string|number} atMs
 */
export function openSecrets(sealedHex, key, books, atMs) {
	if (!/^[0-9a-f]+$/.test(sealedHex) || sealedHex.length < 2 * (32 + 12 + 16))
		throw new Error('not sealed secrets');
	const sealed = Buffer.from(sealedHex, 'hex');
	const ephPub = sealed.subarray(0, 32);
	const iv = sealed.subarray(32, 44);
	const body = sealed.subarray(44);
	const shared = diffieHellman({ privateKey: key.privateKey, publicKey: publicKeyOf(ephPub) });
	const decipher = createDecipheriv(
		'aes-256-gcm',
		aesKey(shared, ephPub, Buffer.from(key.publicKey, 'hex')),
		iv
	);
	decipher.setAAD(aadOf(books, atMs));
	decipher.setAuthTag(body.subarray(body.length - 16));
	return Buffer.concat([
		decipher.update(body.subarray(0, body.length - 16)),
		decipher.final()
	]).toString('utf8');
}

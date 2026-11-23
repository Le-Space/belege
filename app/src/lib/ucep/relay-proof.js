// Whether a relay's registration on Aleph is the relay's own, signed twice
// (@le-space/aleph-bootstrap, "dual-key-attested"): the account that runs it
// authorises a publisher key for one peer id, and that publisher signs what
// the relay announces – its peer id, its addresses, its registration (which
// names the instance) and when. Both are Ethereum `personal_sign` signatures
// over the exact JSON text aleph-bootstrap writes, so they are checked here
// with the curves the app already carries, not with a wallet library.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const SCHEME = 'personal_sign';
const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** @param {unknown} value */
const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** @param {unknown} left @param {unknown} right */
const sameOptional = (left, right) => (left ?? undefined) === (right ?? undefined);

/**
 * The address that signed `message` with `personal_sign`, or null.
 *
 * @param {string} message
 * @param {unknown} signature 65 bytes as hex: r, s, v
 */
export function recoverSigner(message, signature) {
	const hex = typeof signature === 'string' ? signature.trim().replace(/^0x/, '') : '';
	if (!/^[0-9a-fA-F]{130}$/.test(hex)) return null;
	try {
		const sig = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
		const body = encoder.encode(message);
		const digest = keccak_256(
			new Uint8Array([...encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`), ...body])
		);
		let v = sig[64];
		if (v >= 27) v -= 27;
		if (v !== 0 && v !== 1) return null;
		const point = secp256k1.Signature.fromBytes(sig.slice(0, 64), 'compact')
			.addRecoveryBit(v)
			.recoverPublicKey(digest);
		return `0x${toHex(keccak_256(point.toBytes(false).slice(1)).slice(-20))}`;
	} catch {
		return null;
	}
}

/** @param {unknown} addrs */
const dedupe = (addrs) => [
	...new Set(
		(Array.isArray(addrs) ? addrs : [])
			.map((a) => (typeof a === 'string' ? a.trim() : ''))
			.filter(Boolean)
	)
];

/** @param {unknown} addrs */
const addrsHash = (addrs) =>
	`0x${toHex(keccak_256(encoder.encode(JSON.stringify(dedupe(addrs)))))}`;

/** The owner's text, in aleph-bootstrap's key order. @param {any} p */
const ownerText = (p) =>
	JSON.stringify({
		ownerAddress: p.ownerAddress,
		publisherAddress: p.publisherAddress,
		peerId: p.peerId,
		registrationId: p.registrationId,
		profile: p.profile,
		version: p.version,
		instanceItemHash: p.instanceItemHash,
		issuedAt: p.issuedAt,
		expiresAt: p.expiresAt
	});

/** The publisher's text, in aleph-bootstrap's key order. @param {any} p */
const proofText = (p) =>
	JSON.stringify({
		peerId: p.peerId,
		multiaddrs: p.multiaddrs ? dedupe(p.multiaddrs) : undefined,
		browserMultiaddrs: p.browserMultiaddrs ? dedupe(p.browserMultiaddrs) : undefined,
		multiaddrsHash: p.multiaddrsHash,
		browserMultiaddrsHash: p.browserMultiaddrsHash,
		registrationId: p.registrationId,
		profile: p.profile,
		version: p.version,
		updatedAt: p.updatedAt
	});

/**
 * Whether a registration's content is signed by its owner and its publisher,
 * for the peer id, addresses, registration and instance it names.
 *
 * @param {any} content a `relay-bootstrap-v2` post's content
 * @param {{ instance: string, now?: number }} expected the instance its registration id names
 */
export function signedRegistration(content, { instance, now = Date.now() }) {
	const auth = content?.authorization;
	const proof = content?.relayProof;
	const a = auth?.payload;
	const p = proof?.payload;
	if (!a || !p || auth.scheme !== SCHEME || proof.scheme !== SCHEME) return false;
	const owner = lower(content.ownerAddress);
	const publisher = lower(a.publisherAddress);
	if (!owner || lower(a.ownerAddress) !== owner || !publisher) return false;
	if (content.publisherAddress != null && lower(content.publisherAddress) !== publisher) {
		return false;
	}
	// One peer id throughout: the content's, the owner's and the publisher's.
	if (typeof content.peerId !== 'string' || a.peerId !== content.peerId) return false;
	if (p.peerId !== content.peerId) return false;
	// The registration, and with it the instance, is the one the publisher signed.
	if (typeof content.registrationId !== 'string') return false;
	if (p.registrationId !== content.registrationId) return false;
	if (a.registrationId != null && a.registrationId !== content.registrationId) return false;
	if (a.instanceItemHash != null && lower(a.instanceItemHash) !== instance) return false;
	if (!sameOptional(p.profile, content.profile) || !sameOptional(p.version, content.version)) {
		return false;
	}
	if (typeof p.updatedAt !== 'number' || p.updatedAt !== content.updatedAt) return false;
	if (a.expiresAt != null && !(now <= a.expiresAt)) return false;
	// The addresses are the ones the publisher signed.
	if (p.multiaddrsHash) {
		if (p.multiaddrsHash !== addrsHash(content.multiaddrs)) return false;
	} else if (JSON.stringify(dedupe(p.multiaddrs)) !== JSON.stringify(dedupe(content.multiaddrs))) {
		return false;
	}
	if (p.browserMultiaddrsHash) {
		if (p.browserMultiaddrsHash !== addrsHash(content.browserMultiaddrs)) return false;
	} else if (p.browserMultiaddrs || content.browserMultiaddrs) {
		if (
			JSON.stringify(dedupe(p.browserMultiaddrs)) !==
			JSON.stringify(dedupe(content.browserMultiaddrs))
		) {
			return false;
		}
	}
	return (
		recoverSigner(ownerText(a), auth.signature) === owner &&
		recoverSigner(proofText(p), proof.signature) === publisher
	);
}

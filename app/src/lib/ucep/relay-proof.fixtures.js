// Relay registrations signed as @le-space/aleph-bootstrap signs them, with
// made-up keys, for the specs of relay-proof.js and net.js. Nothing is real.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const encoder = new TextEncoder();
/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** A made-up key and its address. @param {number} n 1–255 */
export function testKey(n) {
	const secret = new Uint8Array(32);
	secret[31] = n;
	const pub = secp256k1.getPublicKey(secret, false);
	return { secret, address: `0x${toHex(keccak_256(pub.slice(1)).slice(-20))}` };
}

/** `personal_sign`. @param {string} message @param {Uint8Array} secret */
export function personalSign(message, secret) {
	const body = encoder.encode(message);
	const digest = keccak_256(
		new Uint8Array([...encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`), ...body])
	);
	const sig = secp256k1.Signature.fromBytes(
		secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' }),
		'recovered'
	);
	return `0x${toHex(sig.toBytes('compact'))}${(27 + /** @type {number} */ (sig.recovery)).toString(16)}`;
}

/**
 * A registration's content, signed by `owner` for `publisher`, and by
 * `publisher` for what it announces.
 *
 * @param {{ owner: ReturnType<typeof testKey>, publisher: ReturnType<typeof testKey>,
 *   instance: string, peerId: string, multiaddrs: string[], updatedAt: number,
 *   instanceItemHash?: string }} p
 */
export function signedContent({
	owner,
	publisher,
	instance,
	peerId,
	multiaddrs,
	updatedAt,
	instanceItemHash
}) {
	const registrationId = `relay:orbitdb-relay:relay-main:${instance}`;
	const authorization = {
		ownerAddress: owner.address,
		publisherAddress: publisher.address,
		peerId,
		instanceItemHash,
		issuedAt: updatedAt - 1
	};
	const proof = { peerId, multiaddrs, registrationId, updatedAt };
	return {
		peerId,
		multiaddrs,
		registrationId,
		ownerAddress: owner.address,
		publisherAddress: publisher.address,
		updatedAt,
		authorization: {
			scheme: 'personal_sign',
			payload: authorization,
			signature: personalSign(
				JSON.stringify({
					ownerAddress: authorization.ownerAddress,
					publisherAddress: authorization.publisherAddress,
					peerId,
					registrationId: undefined,
					profile: undefined,
					version: undefined,
					instanceItemHash,
					issuedAt: authorization.issuedAt,
					expiresAt: undefined
				}),
				owner.secret
			)
		},
		relayProof: {
			scheme: 'personal_sign',
			payload: proof,
			signature: personalSign(
				JSON.stringify({
					peerId,
					multiaddrs: [...new Set(multiaddrs)],
					browserMultiaddrs: undefined,
					multiaddrsHash: undefined,
					browserMultiaddrsHash: undefined,
					registrationId,
					profile: undefined,
					version: undefined,
					updatedAt
				}),
				publisher.secret
			)
		}
	};
}

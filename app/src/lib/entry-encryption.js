// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/entry-encryption.js) at 56647d5.
// Changed: the plaintext migration is gone. invoice01 hands back entries that
// were written before its list was sealed; belege has never written a
// plaintext entry, so an unsealed payload here can only be a mistake or a
// forgery, and it is refused instead of read.
//
// The seam between sealed bytes and an OrbitDB log.
//
// OrbitDB takes `encryption: { data: { encrypt, decrypt } }` and applies it to
// an entry's payload: `entry.js` encodes the payload to dag-cbor, hands the
// bytes to `encrypt`, and on the way back hands whatever it stored to
// `decrypt` and decodes the result. So both halves speak bytes, and the
// cryptography itself stays in ./db-encryption.js where it can be proven on
// its own.

import { deterministicSealer, sealer } from './db-encryption.js';

/**
 * OrbitDB's `encryption` option for one database.
 *
 * @param {Uint8Array} rawKey 32 bytes, see ./database-keys.js
 * @returns {Promise<{ data: { encrypt: (bytes: Uint8Array) => Promise<Uint8Array>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export async function payloadEncryption(rawKey) {
	const seal = await sealer(rawKey);

	return {
		data: {
			encrypt: (bytes) => seal.seal(bytes),

			/** @param {any} value the stored payload, sealed bytes and nothing else */
			async decrypt(value) {
				if (!(value instanceof Uint8Array)) {
					throw new Error('Refusing an unencrypted entry: every belege entry is sealed.');
				}
				return seal.open(value);
			}
		}
	};
}

/**
 * OrbitDB's `encryption` option with both layers: the payload sealed as
 * always (`data`, a random nonce each), and the whole entry sealed again
 * (`replication`, deterministic: see db-encryption.js `deterministicSealer`)
 * with a key of its own. A peer without that key gets blocks it cannot
 * decode: not who wrote an entry, not when, not which entries it follows –
 * so it cannot walk or replicate the log.
 *
 * @param {Uint8Array} dataKey 32 bytes, deriveDatabaseKey
 * @param {Uint8Array} replicationKey 32 bytes, deriveReplicationKey
 */
export async function sealedEncryption(dataKey, replicationKey) {
	const { data } = await payloadEncryption(dataKey);
	const entries = await deterministicSealer(replicationKey);
	return {
		data,
		replication: {
			encrypt: (/** @type {Uint8Array} */ bytes) => entries.seal(bytes),
			/** @param {any} value */
			async decrypt(value) {
				if (!(value instanceof Uint8Array)) {
					throw new Error('Refusing an entry without its replication seal.');
				}
				return entries.open(value);
			}
		}
	};
}

// Follows Le-Space/simple-todo apps/privacy01 (src/lib/p2p.js, `createOrbitDBInstance`)
// and packages/todo (src/memory-identities.js) at lespace/main: the OrbitDB
// signing key lives in a keystore that forgets, and is derived again from the
// passkey on every unlock.
// Changed: belege keeps the provider's default secp256k1 signing key (privacy01
// switched to Ed25519), uses the provider's own `createSessionKeystore()`, and
// removes the persistent keystore an earlier build left behind.
//
// No private key at rest.
//
// OrbitDB signs every entry with whatever `keystore.getKey(identity.id)`
// returns, and its default keystore (`KeyStore({ path })`) writes that key to
// IndexedDB in the clear. Anyone with the browser profile could then sign
// entries as the passkey's DID without the passkey.
//
// The key does not need to be kept: it is derived from the passkey's PRF
// answer, which every unlock reads anyway for the database key. So the
// keystore here lives in memory only, is filled from that answer before the
// provider looks, and is gone when the tab closes.

import { Identities } from '@orbitdb/core';
import { createSessionKeystore } from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';

/**
 * The IndexedDB database the PR #1 build kept the signing key in:
 * browser-level's `level-js-` prefix plus `KeyStore({ path: 'belege/orbitdb/keystore' })`.
 */
export const LEGACY_KEYSTORE_DATABASE = 'level-js-belege/orbitdb/keystore';

/**
 * Identities on a session-only keystore that already holds the signing key.
 *
 * @param {any} ipfs a Helia instance
 * @param {{ did: string, signingKey: Uint8Array }} key derived from this unlock's PRF answer
 * @returns {Promise<any>} OrbitDB Identities
 */
export async function createSessionIdentities(ipfs, { did, signingKey }) {
	if (typeof did !== 'string' || !did) throw new Error('A DID is required.');
	if (!(signingKey instanceof Uint8Array) || signingKey.length !== 32) {
		throw new Error('A 32-byte signing key is required.');
	}
	// Typed `unknown` by the provider; it is an OrbitDB KeyStore on MemoryStorage.
	const keystore = /** @type {any} */ (await createSessionKeystore());
	// Empty, being new: no earlier key to keep (seedRestoredSigningKey's concern).
	await keystore.addKey(did, { privateKey: signingKey });
	return Identities({ ipfs, keystore });
}

/**
 * Delete the keystore database an earlier build wrote, key and all.
 *
 * Nothing else is in it, and nothing opens it any more. Resolves in every
 * case: a browser without IndexedDB, or one that refuses, is no reason to
 * keep the books shut.
 *
 * @param {Pick<IDBFactory, 'deleteDatabase'> | undefined} [idb]
 * @returns {Promise<'deleted' | 'blocked' | 'failed' | 'unavailable'>}
 */
export function forgetLegacyKeystore(idb = globalThis.indexedDB) {
	if (!idb) return Promise.resolve('unavailable');
	return new Promise((resolve) => {
		let request;
		try {
			request = idb.deleteDatabase(LEGACY_KEYSTORE_DATABASE);
		} catch {
			resolve('failed');
			return;
		}
		request.onsuccess = () => resolve('deleted');
		request.onerror = () => resolve('failed');
		// Another tab of an old build still has it open. The delete stays queued
		// and completes when that tab lets go; there is nothing to wait for here.
		request.onblocked = () => resolve('blocked');
	});
}

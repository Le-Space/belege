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

/**
 * The signing key OrbitDB puts in every entry, and verifies on every join.
 *
 * Ed25519 rather than secp256k1: verifying a secp256k1 entry costs 3.45 ms and an Ed25519
 * one 0.17 ms on the same machine (measured through @libp2p/crypto, the path
 * OrbitDB verifies through), and a restore of 2 000 entries went from 11.8 s to
 * 5.6 s. libp2p reads the type from the raw length — 32 bytes secp256k1,
 * 64 bytes Ed25519 — so the length is the switch, and the provider derives
 * either from the same PRF answer.
 */
export const SIGNING_KEY_TYPE = 'Ed25519';
const ED25519_KEY_BYTES = 64;
import {
	createSessionKeystore,
	withoutStaleIdentityCache
} from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';

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
	if (!(signingKey instanceof Uint8Array) || signingKey.length !== ED25519_KEY_BYTES) {
		throw new Error(`A ${ED25519_KEY_BYTES}-byte Ed25519 signing key is required.`);
	}
	// Typed `unknown` by the provider; it is an OrbitDB KeyStore on MemoryStorage.
	const keystore = /** @type {any} */ (await createSessionKeystore());
	// Empty, being new: no earlier key to keep (seedRestoredSigningKey's concern).
	await keystore.addKey(did, { privateKey: signingKey });
	return withoutStaleIdentityCache(await Identities({ ipfs, keystore }));
}

/**
 * The `info` the books' signer is derived under (`createSecretSigner`, #496).
 * Bumping it gives the books another identity, and with it other databases.
 */
export const BOOKS_IDENTITY_INFO = 'belege/books-identity/v1';

/**
 * Identities on a session-only keystore that signs as the books (#496): the
 * collections are written by the books' own identity, an Ed25519 signer from
 * the books' secret, which holds its key inside and hands none out. Entries
 * an earlier passkey identity wrote (the databases before the move, and
 * backups of them) still verify through the registered provider.
 *
 * @param {any} ipfs a Helia instance
 * @param {{ did: string, type: 'Ed25519', publicKey: Uint8Array, sign: (data: Uint8Array) => Promise<Uint8Array> }} signer
 *   from `createSecretSigner`
 * @returns {Promise<any>} OrbitDB Identities
 */
export async function createBooksIdentities(ipfs, signer) {
	if (!signer || typeof signer.sign !== 'function' || typeof signer.did !== 'string') {
		throw new Error('A signer from createSecretSigner is required.');
	}
	// Typed `unknown` by the provider; it is an OrbitDB KeyStore on MemoryStorage.
	const keystore = /** @type {any} */ (await createSessionKeystore({ signer }));
	return withoutStaleIdentityCache(await Identities({ ipfs, keystore }));
}

/**
 * OrbitDB 4.0.0 remembers a verified identity under its `signatures.id` and
 * refuses another session of the same passkey (orbitdb/orbitdb#1258): this
 * session's identity cached, every entry an earlier session signed – from a
 * backup, or synced from an own device – is refused as "Key … is not allowed
 * to write to the log". The workaround that lived here (PR #259) is the
 * provider's since 0.11.0 (orbitdb-identity-provider-webauthn-did#90), so
 * that simple-todo and Belege stop carrying copies of it; re-exported so the
 * tests and any caller keep their import.
 */
export { withoutStaleIdentityCache };

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

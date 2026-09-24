// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/p2p.js) at 56647d5,
// the parts that build Helia and OrbitDB for a passkey identity:
// `createPersistentStores`, `createHeliaWithLibp2p` and the passkey branch of
// `createOrbitDBInstance`.
// Changed: always persistent (no memory mode, so `keepLogsWhereTheChoiceSays`
// has nothing to decide and is not needed); no network (see network.js); no
// todo list, delegation, relay or diagnostics code; the database key is
// derived from the passkey's PRF output before anything is opened, and the
// same PRF answer seeds the identity's signing key, which spares the passkey
// the provider's own PRF prompt. That key lives in a session-only keystore
// (session-identities.js) and the libp2p peer key is ephemeral (network.js):
// no private key is kept in IndexedDB or localStorage.

import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { createOrbitDB, useIdentityProvider } from '@orbitdb/core';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	WebAuthnDIDProvider,
	deriveSigningKeyBytes
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';

import { createEphemeralPeerKey, createOfflineLibp2p } from './network.js';
import { deriveBlobKey, deriveDatabaseKey } from './database-keys.js';
import { readPrfOutput } from './passkey-identity.js';
import { createSessionIdentities, forgetLegacyKeystore } from './session-identities.js';
import { openStore } from './store/repository.js';
import { createBlobStore } from './receipts/blob-store.js';

/**
 * IndexedDB names. Everything belege keeps lives under `belege/`. There is no
 * keystore among them: see session-identities.js.
 */
export const STORAGE_PATHS = Object.freeze({
	blockstore: 'belege/helia-blocks',
	datastore: 'belege/helia-data',
	orbitdb: 'belege/orbitdb'
});

/**
 * @typedef {object} Session
 * @property {string} did
 * @property {Awaited<ReturnType<typeof openStore>>} store
 * @property {import('./receipts/blob-store.js').BlobStore} blobs receipt files, sealed with the blob key
 * @property {string} identityHash the identity document's hash
 * @property {string} peerId this session's libp2p peer id
 * @property {() => Promise<void>} stop
 * @property {{ signingKey: Uint8Array, databaseKey: Uint8Array, blobKey: Uint8Array, peerKey: Uint8Array }} [secretsForE2E]
 *   only in E2E builds
 */

/**
 * Unlock the books with a passkey: PRF → key, then Helia, OrbitDB and the
 * sealed databases.
 *
 * Prompts: one for the PRF output here. The provider signs the identity with
 * the passkey once per identity document and keeps that (public) proof, so a
 * new passkey adds its `create` and that signature, a restore its two touches
 * and that signature, and an unlock nothing.
 *
 * @param {any} credential from passkey-identity.js
 * @returns {Promise<Session>}
 * @throws {import('./passkey-identity.js').PrfUnavailableError} before anything is opened
 */
export async function startSession(credential) {
	// First, and before anything is opened: without PRF there is no key, and
	// without a key nothing is read or written. No plaintext fallback.
	const prfOutput = await readPrfOutput(credential);
	const encryptionKey = await deriveDatabaseKey(prfOutput);
	const blobKey = await deriveBlobKey(prfOutput);

	// A PR #1 build kept the signing key in IndexedDB. Gone before anything opens.
	await forgetLegacyKeystore();

	const blockstore = new LevelBlockstore(STORAGE_PATHS.blockstore);
	const datastore = new LevelDatastore(STORAGE_PATHS.datastore);
	const peerKey = await createEphemeralPeerKey();
	const libp2p = await createOfflineLibp2p(peerKey);
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor], blockstore, datastore }), libp2p)
	).start();

	try {
		try {
			useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
		} catch {
			// Already registered.
		}

		// The provider would ask the passkey for this very PRF output again to
		// derive its secp256k1 signing key. Derived here from the answer already
		// in hand, with the provider's own function, it is the same key — and in
		// the keystore before the provider looks, so it does not ask. The
		// keystore is in memory: the next unlock derives the key again.
		//
		// secp256k1, the provider's default, as before: the key, and with it the
		// identity document and its cached passkey proof, stay what PR #1 made.
		const did = credential.did ?? (await WebAuthnDIDProvider.createDID(credential));
		const signingKey =
			credential.signingKey instanceof Uint8Array
				? credential.signingKey
				: await deriveSigningKeyBytes(prfOutput, did);
		const identities = await createSessionIdentities(helia, { did, signingKey });

		const identity = await identities.createIdentity({
			provider: OrbitDBWebAuthnIdentityProviderFunction({ webauthnCredential: credential })
		});
		const orbitdb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities,
			identity,
			directory: STORAGE_PATHS.orbitdb
		});
		const store = await openStore({ orbitdb, encryptionKey, prfOutput });
		const blobs = await createBlobStore({ blockstore: helia.blockstore, key: blobKey });

		return {
			did: identity.id,
			identityHash: identity.hash,
			peerId: libp2p.peerId.toString(),
			store,
			blobs,
			// Only in E2E builds, so the test can look for these bytes on disk.
			// Written inline so every other build drops it, not just skips it.
			...(import.meta.env.VITE_E2E === 'true'
				? {
						secretsForE2E: {
							signingKey,
							databaseKey: encryptionKey,
							blobKey,
							peerKey: peerKey.raw
						}
					}
				: {}),
			async stop() {
				await store.close();
				await orbitdb.stop();
				await helia.stop();
			}
		};
	} catch (error) {
		await helia.stop().catch(() => {});
		throw error;
	}
}

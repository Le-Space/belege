// Ported from Le-Space/simple-todo apps/invoice01 (src/lib/p2p.js) at 56647d5,
// the parts that build Helia and OrbitDB for a passkey identity:
// `createPersistentStores`, `createHeliaWithLibp2p` and the passkey branch of
// `createOrbitDBInstance`.
// Changed: always persistent (no memory mode, so `keepLogsWhereTheChoiceSays`
// has nothing to decide and is not needed); no network (see network.js); no
// todo list, delegation, relay or diagnostics code; the database key is
// derived from the passkey's PRF output before anything is opened, and the
// same PRF answer seeds the identity's signing key, which spares the passkey
// the provider's own PRF prompt.

import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { createOrbitDB, Identities, KeyStore, useIdentityProvider } from '@orbitdb/core';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	WebAuthnDIDProvider,
	deriveSigningKeyBytes
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';

import { createOfflineLibp2p } from './network.js';
import { deriveDatabaseKey } from './database-keys.js';
import { readPrfOutput } from './passkey-identity.js';
import { seedRestoredSigningKey, withRestoredSigningKey } from './restored-signing-key.js';
import { openStore } from './store/repository.js';

/** IndexedDB names. Everything belege keeps lives under `belege/`. */
export const STORAGE_PATHS = Object.freeze({
	blockstore: 'belege/helia-blocks',
	datastore: 'belege/helia-data',
	orbitdb: 'belege/orbitdb',
	keystore: 'belege/orbitdb/keystore'
});

/**
 * @typedef {object} Session
 * @property {string} did
 * @property {Awaited<ReturnType<typeof openStore>>} store
 * @property {() => Promise<void>} stop
 */

/**
 * Unlock the books with a passkey: PRF → key, then Helia, OrbitDB and the
 * sealed databases.
 *
 * Prompts: one for the PRF output here, and one when the provider signs the
 * identity. A new passkey adds its `create`, a restore its two touches.
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

	const blockstore = new LevelBlockstore(STORAGE_PATHS.blockstore);
	const datastore = new LevelDatastore(STORAGE_PATHS.datastore);
	const libp2p = await createOfflineLibp2p();
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor], blockstore, datastore }), libp2p)
	).start();

	try {
		try {
			useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
		} catch {
			// Already registered.
		}

		const keystore = await KeyStore({ path: STORAGE_PATHS.keystore });
		const identities = await Identities({ ipfs: helia, keystore });

		// The provider would ask the passkey for this very PRF output again to
		// derive its secp256k1 signing key. Derived here from the answer already
		// in hand, with the provider's own function, it is the same key — and in
		// the keystore before the provider looks, so it does not ask.
		const did = credential.did ?? (await WebAuthnDIDProvider.createDID(credential));
		const signingKey =
			credential.signingKey instanceof Uint8Array
				? credential.signingKey
				: await deriveSigningKeyBytes(prfOutput, did);
		await seedRestoredSigningKey(keystore, withRestoredSigningKey({ did }, signingKey));

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

		return {
			did: identity.id,
			store,
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

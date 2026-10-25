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
//
// The books write as an identity of their own (#496): an Ed25519 signer from
// the books' secret, the root of every collection's access controller
// (store/books-access.js), so a second passkey or a recovery phrase can write
// to the same books once the vault keeps that secret (#406). The passkey's
// identity stays the person's: its DID is shown, and is what a record says
// wrote it. The databases the passkey wrote before move once, with their
// whole history (store/migrate.js).

import { networkPause } from './network-pause.js';
import { createLibp2p } from 'libp2p';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { deviceSalt, deviceSyncOn, knownPeers, syncLibp2pConfig } from './sync/device-sync.js';
import { firstContactPolicy, relayPeerOf } from './sync/first-contact.js';
import { createDeviceGate } from './sync/device-gate.js';
import { lanRelayAddr, networkMode, relaysFor } from './sync/network-mode.js';
import { attachQrSession, closeQrSession, qrPeers } from './sync/qr-link.js';
import { relayAddrs } from './ucep/net.js';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { createOrbitDB, useIdentityProvider } from '@orbitdb/core';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	WebAuthnDIDProvider,
	configureWebAuthn,
	createSecretSigner,
	deriveSigningKeyBytes,
	getWebAuthnConfig
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';

import { createEphemeralPeerKey, createOfflineLibp2p } from './network.js';
import {
	deriveBackupKey,
	deriveBlobKey,
	deriveBooksSecret,
	deriveDatabaseKey,
	deriveDeviceAuthKey,
	deriveDevicePeerSeed,
	derivePeerKeySeed,
	deriveReplicationKey
} from './database-keys.js';
import { readPrfOutput } from './passkey-identity.js';
import { adoptNewerVault, openBooksVault } from './books-vault.js';
import { sealer } from './db-encryption.js';
import {
	BOOKS_IDENTITY_INFO,
	createBooksIdentities,
	createSessionIdentities,
	forgetLegacyKeystore,
	SIGNING_KEY_TYPE
} from './session-identities.js';
import { openStore } from './store/repository.js';
import { booksAccessController, sealAccessLists } from './store/books-access.js';
import { sealedEncryption } from './entry-encryption.js';
import { createBlobStore } from './receipts/blob-store.js';

/**
 * IndexedDB names. Everything belege keeps lives under `belege/`. There is no
 * keystore among them: see session-identities.js.
 */
/**
 * Set once the books before the replication layer have moved in this browser
 * (store/migrate.js), per identity. A flag, nothing secret; a restored backup
 * of the old books clears it, so they move in again.
 */
export const SEALED_BOOKS_FLAG = 'belege.sealed-books';

/**
 * Set once the passkey's databases have moved to the books' own identity in
 * this browser (#496), per books identity. A flag, nothing secret; a restored
 * backup of the passkey's databases clears it, so they move in again.
 */
export const BOOKS_IDENTITY_FLAG = 'belege.books-identity';

/** @param {string} key */
function flagSet(key) {
	try {
		return localStorage.getItem(key) === '1';
	} catch {
		return false;
	}
}

/** @param {string} key */
function setFlag(key) {
	try {
		localStorage.setItem(key, '1');
	} catch {
		// Not kept: the next unlock looks again and finds nothing new to move.
	}
}

/** @param {string} key */
function clearFlag(key) {
	try {
		localStorage.removeItem(key);
	} catch {
		// Nothing kept, nothing to clear.
	}
}

export const STORAGE_PATHS = Object.freeze({
	blockstore: 'belege/helia-blocks',
	datastore: 'belege/helia-data',
	orbitdb: 'belege/orbitdb'
});

/**
 * @typedef {object} Session
 * @property {string} did the passkey's: shown, and what a record says wrote it
 * @property {string} booksDid the books' own identity, the root writer of every collection (#496)
 * @property {import('./books-vault.js').OpenedVault} vault the books' vault, open (#406)
 * @property {Uint8Array} ownIndexKey this passkey's index key on Aleph (backup/vault-index.js), in memory
 * @property {Awaited<ReturnType<typeof openStore>>} store
 * @property {import('./receipts/blob-store.js').BlobStore} blobs receipt files, sealed with the blob key
 * @property {(meta: { appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').buildBackup>>>} makeBackup
 *   everything this browser keeps, as one sealed backup (issue #77)
 * @property {(meta: { chain: import('./backup/archive.js').BackupChain, appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').buildIncrement>>>} makeIncrement
 *   what is new since the chain's last backup, sealed; null when nothing is (#454)
 * @property {(sealed: Uint8Array, onProgress?: (p: import('./backup/archive.js').RestoreProgress) => void, chain?: { increments?: Uint8Array[], base?: string, fetchBytes?: (cid: string) => Promise<Uint8Array> }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').restoreBackup>>>} restoreBackup
 *   a sealed backup, with its increments, back into these books; reload the page afterwards
 * @property {string} identityHash the books' identity document's hash
 * @property {string} peerId this session's libp2p peer id
 * @property {Uint8Array} ucepSeed the seed of the UCEP node's peer key, derived from the passkey
 * @property {{ seal: (bytes: Uint8Array) => Promise<Uint8Array>, open: (bytes: Uint8Array) => Promise<Uint8Array> }} syncLogSealer
 *   seals the sync log in this browser (sync/sync-log.js), under a key of its own
 * @property {boolean} online device sync is on: the node talks to the relay (#123)
 * @property {string[]} relays
 * @property {import('./sync/network-mode.js').NetworkMode} mode where devices meet, as the node was built (#148)
 * @property {any} libp2p the node under Helia and OrbitDB
 * @property {ReturnType<typeof createDeviceGate> | null} deviceGate which peers proved the passkey (online only)
 * @property {() => Promise<void>} stop
 * @property {{ signingKey?: Uint8Array, booksSecret: Uint8Array, databaseKey: Uint8Array, replicationKey: Uint8Array, blobKey: Uint8Array, peerKey: Uint8Array }} [secretsForE2E]
 *   only in E2E builds
 */

/**
 * Where an unlock is (startSession `onStatus`).
 *
 * @typedef {{ step: 'keys' | 'network' | 'identity' | 'blobs' }
 *   | { step: 'open', collection: string }
 *   | { step: 'move', collection: string, done: number, total: number }} UnlockStatus
 */

/**
 * Run `fn` with the provider asking for this credential only (#429).
 *
 * The provider's identity proof takes no per-call option: under its default
 * policy (discoverable credentials) it leaves `allowCredentials` out, and any
 * passkey of this origin on the authenticator may answer – one that is not
 * the credential gives a proof OrbitDB later refuses. The policy is switched
 * off for this call only; a restore's first touch needs it on, because there
 * it has no credential to name yet.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function pinnedToCredential(fn) {
	const { discoverableCredentials } = getWebAuthnConfig();
	configureWebAuthn({ discoverableCredentials: false });
	try {
		return await fn();
	} finally {
		configureWebAuthn({ discoverableCredentials });
	}
}

/**
 * Unlock the books with a passkey: PRF → key, then Helia, OrbitDB and the
 * sealed databases.
 *
 * Prompts: one for the PRF output here, and nothing else: the books sign as
 * their own identity (#496), not the passkey. A new passkey adds its `create`,
 * a restore its two touches. The prompt names the credential, so no other
 * passkey of this origin can answer it (#429).
 *
 * `beforePrompt`, when given, is awaited before it: the page says what the
 * touch is for (passkey-steps.svelte.js). An unlock, whose touch its own button
 * starts, passes none.
 *
 * Each step is reported to `onStatus` as it starts – the unlock screen shows
 * it, and the console times it: opening large books, or moving them into the
 * sealed databases once (store/migrate.js), takes minutes, and without it an
 * unlock that is working looks the same as one that hangs.
 *
 * @param {any} credential from passkey-identity.js
 * @param {{ onStatus?: (status: UnlockStatus) => void,
 *   beforePrompt?: (purpose: 'prf') => Promise<void>,
 *   lookupVault?: boolean }} [options]
 *   `lookupVault`: an empty device – ask Aleph's index for the books' vault (#406)
 * @returns {Promise<Session>}
 * @throws {import('./passkey-identity.js').PrfUnavailableError} before anything is opened
 */
export async function startSession(
	credential,
	{ onStatus, beforePrompt, lookupVault = false } = {}
) {
	onStatus?.({ step: 'keys' });
	await beforePrompt?.('prf');
	// First, and before anything is opened: without PRF there is no key, and
	// without a key nothing is read or written. No plaintext fallback.
	const passkeyPrf = await readPrfOutput(credential);
	// The root every key is derived from, out of the books' vault (#406): for
	// books made before the vault, the PRF output itself, kept there on this
	// first unlock; for a passkey added later, the founding passkey's, through
	// its own slot. Each key below is derived from it as it always was.
	// An empty device (`lookupVault`): this browser has no vault for the
	// passkey, so its index on Aleph is asked (backup/vault-index.js), then the
	// books' own index for the current record – which may say the passkey was
	// removed there.
	const indexes = lookupVault ? await import('./backup/vault-index.js') : null;
	let vault = await openBooksVault({
		prfOutput: passkeyPrf,
		rawCredentialId: credential.rawCredentialId,
		credentialId: String(credential.credentialId ?? ''),
		label: String(credential.displayName ?? ''),
		storage: globalThis.localStorage,
		...(indexes ? { find: () => indexes.findVaultOnAleph({ prfOutput: passkeyPrf }) } : {})
	});
	if (indexes && vault.found) {
		const current = await indexes.readRootIndex({ root: vault.root }).catch(() => null);
		if (current?.vault) {
			vault = await adoptNewerVault(
				vault,
				current.vault,
				{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
				globalThis.localStorage
			);
		}
	}
	// This passkey's index key: kept in memory, so the vault can be published
	// there later without asking the passkey again.
	const { passkeyIndexKey } = await import('./backup/vault-index.js');
	const ownIndexKey = await passkeyIndexKey(passkeyPrf);
	const prfOutput = vault.root;
	const encryptionKey = await deriveDatabaseKey(prfOutput);
	const blobKey = await deriveBlobKey(prfOutput);
	const backupKey = await deriveBackupKey(prfOutput);
	// The whole entries sealed again (entry-encryption.js sealedEncryption).
	const replicationKey = await deriveReplicationKey(prfOutput);
	// The UCEP node's key (ucep/net.js): the same peer id on every unlock.
	const ucepSeed = await derivePeerKeySeed(prfOutput);
	// The sync log's own key (sync/sync-log.js): never the books'.
	const { SYNC_LOG_INFO } = await import('./sync/sync-log.js');
	const syncLogSealer = await sealer(await deriveDatabaseKey(prfOutput, SYNC_LOG_INFO));

	// A PR #1 build kept the signing key in IndexedDB. Gone before anything opens.
	await forgetLegacyKeystore();

	onStatus?.({ step: 'network' });

	const blockstore = new LevelBlockstore(STORAGE_PATHS.blockstore);
	const datastore = new LevelDatastore(STORAGE_PATHS.datastore);
	// Device sync (#123), when switched on for this device: online over the
	// relay, on a peer key of this device's own. Else offline, as always.
	// … and not while the network is paused in the header (network-pause.js).
	const online = deviceSyncOn() && !networkPause();
	// Where devices meet (#148), as this browser keeps it: the books are not open yet.
	const mode = networkMode();
	// Aleph is asked for the Le-Space relays only when this device goes online
	// in the public mode; the own network's relay is the bridge's (network-mode.js).
	const relays = online ? await relaysFor(mode, () => relayAddrs()) : [];
	const relayPeers = new Set(
		[...relays, lanRelayAddr()].map((addr) => relayPeerOf(addr)).filter(Boolean)
	);
	const peerKey = online
		? await generateKeyPairFromSeed('Ed25519', await deriveDevicePeerSeed(prfOutput, deviceSalt()))
		: await createEphemeralPeerKey();
	// Only a device that proves it holds the passkey gets the books (device-gate.js).
	// In "Beides" a device the books do not know yet comes in over the own network only.
	const deviceGate = online
		? createDeviceGate({
				authKey: await deriveDeviceAuthKey(prfOutput),
				// The proof is offered to devices, never to a relay this node dials.
				offer: (peer) => !relayPeers.has(peer),
				admit: firstContactPolicy({
					mode,
					knownPeers,
					lanRelayPeer: relayPeerOf(lanRelayAddr()),
					qrPeers
				})
			})
		: null;
	const libp2p = deviceGate
		? await createLibp2p(syncLibp2pConfig({ privateKey: peerKey, relays, gate: deviceGate, mode }))
		: await createOfflineLibp2p(peerKey);
	// The code exchange builds its connections on this node (qr-link.js).
	if (deviceGate && (mode === 'qr' || mode === 'both')) attachQrSession(libp2p);
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ codecs: [dagCbor], blockstore, datastore }), libp2p)
	).start();

	try {
		try {
			useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
		} catch {
			// Already registered.
		}

		onStatus?.({ step: 'identity' });
		// The passkey's DID: the person's, shown, and what a record says wrote
		// it. The passkey signs nothing for OrbitDB any more – the books do
		// (#496) – so no identity proof is asked for.
		const did = credential.did ?? (await WebAuthnDIDProvider.createDID(credential));
		// The books' own identity (#496): what OrbitDB signs every entry as.
		const booksSecret = await deriveBooksSecret(prfOutput);
		// E2E builds only: books as they were made before #496, written by the
		// passkey's own identity (its signing key from the PRF answer, its proof
		// one more touch), so a test can watch them move (e2e/books-identity.spec.js).
		const beforeBooksIdentity =
			import.meta.env.VITE_E2E === 'true' &&
			/** @type {any} */ (globalThis).__belegeBeforeBooksIdentity === true;
		const passkeyWriter = beforeBooksIdentity
			? await (async () => {
					const signingKey =
						credential.signingKey instanceof Uint8Array
							? credential.signingKey
							: await deriveSigningKeyBytes(passkeyPrf, did, SIGNING_KEY_TYPE);
					const identities = await createSessionIdentities(helia, { did, signingKey });
					const identity = await pinnedToCredential(() =>
						identities.createIdentity({
							provider: OrbitDBWebAuthnIdentityProviderFunction({ webauthnCredential: credential })
						})
					);
					return { signingKey, identities, identity };
				})()
			: null;
		const books = await createSecretSigner(booksSecret, { info: BOOKS_IDENTITY_INFO });
		const booksIdentities = passkeyWriter
			? passkeyWriter.identities
			: await createBooksIdentities(helia, books);
		const booksIdentity = passkeyWriter
			? passkeyWriter.identity
			: await booksIdentities.createIdentity({
					provider: OrbitDBWebAuthnIdentityProviderFunction({ signer: books })
				});
		const orbitdb = await createOrbitDB({
			ipfs: helia,
			// @ts-expect-error `identities` is a documented option the bundled types omit
			identities: booksIdentities,
			identity: booksIdentity,
			directory: STORAGE_PATHS.orbitdb
		});
		// The access list's own database is sealed like every other (books-access.js).
		const encryption = await sealedEncryption(encryptionKey, replicationKey);
		sealAccessLists(encryption);
		// The books before the replication layer move in once per browser
		// (store/migrate.js); a restored backup of them moves in again. So do the
		// passkey's databases, to the books' identity (#496).
		const moveFlag = `${SEALED_BOOKS_FLAG}:${did}`;
		const booksFlag = `${BOOKS_IDENTITY_FLAG}:${booksIdentity.id}`;
		const store = await openStore({
			orbitdb,
			encryptionKey,
			replicationKey,
			prfOutput,
			...(beforeBooksIdentity
				? {}
				: {
						accessController: booksAccessController(booksIdentity.id),
						author: did,
						formerWriter: did,
						moveFromPasskey: !flagSet(booksFlag)
					}),
			move: !flagSet(moveFlag),
			onOpen: (collection) => onStatus?.({ step: 'open', collection }),
			onMove: ({ collection, moved, total }) =>
				onStatus?.({ step: 'move', collection, done: moved, total })
		});
		setFlag(moveFlag);
		if (!beforeBooksIdentity) setFlag(booksFlag);
		onStatus?.({ step: 'blobs' });
		const blobs = await createBlobStore({ blockstore: helia.blockstore, key: blobKey, online });

		return {
			did,
			booksDid: booksIdentity.id,
			vault,
			ownIndexKey,
			identityHash: booksIdentity.hash,
			peerId: libp2p.peerId.toString(),
			store,
			blobs,
			/**
			 * Everything this browser keeps, as one sealed backup (backup/archive.js,
			 * loaded only when asked for).
			 *
			 * @param {{ appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
			 */
			async makeBackup({ appVersion, onProgress }) {
				const { buildBackup } = await import('./backup/archive.js');
				return buildBackup({
					databases: store.databases(),
					blockstore: helia.blockstore,
					receipts: store.receipts,
					key: backupKey,
					appVersion,
					onProgress
				});
			},
			/**
			 * What is new since the chain's last backup, sealed (backup/archive.js, #454).
			 *
			 * @param {{ chain: import('./backup/archive.js').BackupChain, appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
			 */
			async makeIncrement({ chain, appVersion, onProgress }) {
				const { buildIncrement } = await import('./backup/archive.js');
				return buildIncrement({
					databases: store.databases(),
					blockstore: helia.blockstore,
					receipts: store.receipts,
					key: backupKey,
					chain,
					appVersion,
					onProgress
				});
			},
			/**
			 * Put a sealed backup back into these books (backup/archive.js). The
			 * databases are closed once the backup opened with this passkey and fits
			 * these books – not before: a wrong passkey or a broken file leaves the
			 * books open. The restore reopens them behind the store's back, so the page
			 * reloads afterwards; an error after the close says so (`booksClosed`).
			 *
			 * @param {Uint8Array} sealed
			 * @param {(p: import('./backup/archive.js').RestoreProgress) => void} [onProgress]
			 * @param {{ increments?: Uint8Array[], base?: string,
			 *   fetchBytes?: (cid: string) => Promise<Uint8Array> }} [chain] the full
			 *   backup's increments (#454), and where to look for a head it lacks
			 */
			async restoreBackup(sealed, onProgress, chain) {
				const { restoreBackup } = await import('./backup/archive.js');
				const { default: SealedDocuments } = await import('./store/sealed-documents.js');
				const { oldBooksNames, oldBooksOpenOptions, passkeyBooksOpenOptions } = await import(
					'./store/repository.js'
				);
				const { deriveSealedDatabaseName } = await import('./database-keys.js');
				const addresses = Object.fromEntries(
					Object.entries(store.databases()).map(([name, db]) => [name, String(db.address)])
				);
				// A backup made before the replication layer names the old databases:
				// their addresses, from opening them (without sync) once.
				const oldOptions = await oldBooksOpenOptions(encryptionKey, did);
				/** @type {Record<string, string>} */
				const oldAddresses = {};
				for (const [name, dbName] of Object.entries(await oldBooksNames(prfOutput))) {
					const db = await orbitdb.open(dbName, oldOptions);
					oldAddresses[name] = String(db.address);
					await db.close();
				}
				// A backup made before the books' own identity (#496) names the
				// passkey's databases: their addresses, from opening them likewise.
				const passkeyOptions = await passkeyBooksOpenOptions(encryptionKey, replicationKey, did);
				/** @type {Record<string, string>} */
				const passkeyAddresses = {};
				for (const name of Object.keys(addresses)) {
					const db = await orbitdb.open(
						await deriveSealedDatabaseName(prfOutput, name),
						passkeyOptions
					);
					passkeyAddresses[name] = String(db.address);
					await db.close();
				}
				let closed = false;
				const result = await restoreBackup({
					orbitdb,
					sealed,
					...(chain ? { increments: chain.increments, base: chain.base } : {}),
					...(chain?.fetchBytes ? { fetchBytes: chain.fetchBytes } : {}),
					key: backupKey,
					targets: [
						{
							name: 'sealed',
							addresses,
							open: {
								type: SealedDocuments.type,
								Database: SealedDocuments({ indexBy: 'id' }),
								encryption: await sealedEncryption(encryptionKey, replicationKey)
							}
						},
						{ name: 'passkey', addresses: passkeyAddresses, open: passkeyOptions },
						{ name: 'old', addresses: oldAddresses, open: oldOptions }
					],
					onProgress,
					beforeRestore: async () => {
						await store.close();
						closed = true;
					}
				}).catch((/** @type {any} */ error) => {
					if (closed && error && typeof error === 'object') error.booksClosed = true;
					throw error;
				});
				// Back into the old databases: they move in on the next unlock.
				if (result.target === 'old') clearFlag(moveFlag);
				if (result.target === 'passkey') clearFlag(booksFlag);
				return result;
			},
			ucepSeed,
			syncLogSealer,
			online,
			relays,
			mode,
			libp2p,
			deviceGate,
			// Only in E2E builds, so the test can look for these bytes on disk.
			// Written inline so every other build drops it, not just skips it.
			...(import.meta.env.VITE_E2E === 'true'
				? {
						secretsForE2E: {
							...(passkeyWriter ? { signingKey: passkeyWriter.signingKey } : {}),
							booksSecret,
							databaseKey: encryptionKey,
							replicationKey,
							blobKey,
							peerKey: peerKey.raw
						}
					}
				: {}),
			async stop() {
				closeQrSession();
				await store.close();
				sealAccessLists(null);
				await orbitdb.stop();
				await helia.stop();
			}
		};
	} catch (error) {
		await helia.stop().catch(() => {});
		throw error;
	}
}

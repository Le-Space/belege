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
	getWebAuthnConfig,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import * as dagCbor from '@ipld/dag-cbor';

import { createEphemeralPeerKey, createOfflineLibp2p } from './network.js';
import {
	deriveBackupKey,
	deriveBlobKey,
	deriveBooksSecret,
	deriveDatabaseKey,
	deriveBridgeAuthBase,
	deriveDeviceAuthKey,
	deriveSealedDatabaseName,
	deriveDevicePeerSeed,
	derivePeerKeySeed,
	deriveReplicationKey
} from './database-keys.js';
import { readPrfOutput } from './passkey-identity.js';
import { addPasskey, adoptNewerVault, openBooksVault } from './books-vault.js';
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
 * @property {import('./books-vault.js').OpenedVault | null} vault the books' vault, open (#406); null for a member (#612)
 * @property {{ books: { did: string, identityId: string, label: string }, writer: string, vaultId: string } | null} member a member's books (#612); null for the owner
 * @property {Uint8Array} ownIndexKey this passkey's index key on Aleph (backup/vault-index.js), in memory
 * @property {string} pointedOwner the paying account a member's index on Aleph named (#613), in memory; '' when none
 * @property {(owner: string | null) => Promise<void>} publishMembership a member's vault on Aleph's index G (#613)
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
 * @property {Uint8Array | null} bridgeAuthBase the base of the bridge's own key (online only), in memory only (database-keys.js)
 * @property {(label: string) => Promise<import('./members/member-vault.js').MemberBundle>} memberBundle what a member gets (#611)
 * @property {(writer: string) => Promise<void>} grantWriter a member's write identity may write to every collection
 * @property {(writer: string) => Promise<string[]>} removeWriter a member taken out of every collection's access list (#614); the devices their settings named
 * @property {{ peerId: string | null, key: Uint8Array | null }} bridgeAuth the books' bridge and its key for this generation: the gate proves with it toward that peer only
 * @property {() => Promise<void>} stop
 * @property {{ signingKey?: Uint8Array, booksSecret: Uint8Array | null, databaseKey: Uint8Array, replicationKey: Uint8Array, blobKey: Uint8Array, peerKey: Uint8Array }} [secretsForE2E]
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
 *   lookupVault?: boolean,
 *   recovered?: { opened: import('./books-vault.js').OpenedVault, owner: string, label: string },
 *   memberOf?: string }} [options]
 *   `lookupVault`: an empty device – ask Aleph's index for the books' vault (#406)
 *   `recovered`: the vault opened with recovery words (session.svelte.js
 *   `recoverWithWords`): this new passkey gets its slot there, and opens it
 *   `memberOf`: a member's books (#612) – the id of the member vault this
 *   passkey opens (members/member-vault.js); the books then open from the
 *   member bundle, never from a root
 * @returns {Promise<Session>}
 * @throws {import('./passkey-identity.js').PrfUnavailableError} before anything is opened
 */
export async function startSession(
	credential,
	{ onStatus, beforePrompt, lookupVault = false, recovered, memberOf } = {}
) {
	onStatus?.({ step: 'keys' });
	await beforePrompt?.('prf');
	// First, and before anything is opened: without PRF there is no key, and
	// without a key nothing is read or written. No plaintext fallback.
	const passkeyPrf = await readPrfOutput(credential);
	// A member's books (#612): the member vault this passkey opens, as chosen
	// at unlock. Its bundle gives every key the books need; the member's own
	// root gives what is this member's – the device's id, the sync log, the
	// write identity. No root of the books, no vault of theirs.
	const membership = memberOf
		? await (async () => {
				const { openMemberships } = await import('./members/member-vault.js');
				const all = await openMemberships({
					prfOutput: passkeyPrf,
					rawCredentialId: credential.rawCredentialId,
					storage: globalThis.localStorage
				});
				const found = all.find((m) => m.record.vault.id === memberOf);
				if (!found) throw new Error('This passkey opens no membership of those books.');
				return found;
			})()
		: null;
	// The root every key is derived from, out of the books' vault (#406): for
	// books made before the vault, the PRF output itself, kept there on this
	// first unlock; for a passkey added later, the founding passkey's, through
	// its own slot. Each key below is derived from it as it always was.
	// An empty device (`lookupVault`): this browser has no vault for the
	// passkey, so its index on Aleph is asked (backup/vault-index.js), then the
	// books' own index for the current record – which may say the passkey was
	// removed there.
	const indexes =
		lookupVault && !recovered && !membership ? await import('./backup/vault-index.js') : null;
	let vault = membership
		? null
		: recovered
			? // Opened with the recovery words: this passkey's slot is added, and from
				// here on it opens the books like any other.
				{
					...(await addPasskey(
						recovered.opened,
						{
							prfOutput: passkeyPrf,
							rawCredentialId: credential.rawCredentialId,
							credentialId: String(credential.credentialId ?? ''),
							label: recovered.label
						},
						globalThis.localStorage
					)),
					kid: await slotIdFor(credential.rawCredentialId)
				}
			: await openBooksVault({
					prfOutput: passkeyPrf,
					rawCredentialId: credential.rawCredentialId,
					credentialId: String(credential.credentialId ?? ''),
					label: String(credential.displayName ?? ''),
					storage: globalThis.localStorage,
					...(indexes ? { find: () => indexes.findVaultOnAleph({ prfOutput: passkeyPrf }) } : {})
				});
	/** The paying Aleph account, as the books' index names it (an empty device). */
	let pointedOwner = recovered?.owner ?? '';
	// An empty device: the memberships of this passkey, on Aleph's index G
	// (#613), kept here and offered at the next unlock.
	if (indexes) {
		const { adoptMemberships } = await import('./members/member-vault.js');
		await indexes
			.findMembershipsOnAleph({ prfOutput: passkeyPrf })
			.then((found) =>
				adoptMemberships({
					found,
					prfOutput: passkeyPrf,
					rawCredentialId: credential.rawCredentialId,
					storage: globalThis.localStorage
				})
			)
			.catch((e) => console.warn('memberships on Aleph:', e));
	}
	// A membership an empty device found there: the pointer, sealed under the member's root.
	if (membership?.record.pointer) {
		const { openPointer } = await import('./backup/vault-index.js');
		pointedOwner =
			(await openPointer(membership.memberRoot, membership.record.pointer))?.owner ?? '';
	}
	if (indexes && vault?.found) {
		const current = await indexes.readRootIndex({ root: vault.root }).catch(() => null);
		pointedOwner = current?.pointer?.owner ?? '';
		if (current?.vault) {
			vault = await adoptNewerVault(
				vault,
				current.vault,
				{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
				globalThis.localStorage,
				current.slots
			);
		}
	}
	// This passkey's index key: kept in memory, so the vault can be published
	// there later without asking the passkey again.
	const { memberIndexKey, passkeyIndexKey } = await import('./backup/vault-index.js');
	const ownIndexKey = await passkeyIndexKey(passkeyPrf);
	/** This passkey's index G key (#613), for a member: kept like `ownIndexKey`. */
	const membershipIndexKey = membership ? await memberIndexKey(passkeyPrf) : null;
	// The books' root – none for a member, whose keys come from the bundle.
	const prfOutput = vault ? vault.root : null;
	const bundleKeys = membership?.bundle.keys ?? null;
	/** What is this device's own: the books' root, or the member's. */
	const ownRoot = /** @type {Uint8Array} */ (membership ? membership.memberRoot : prfOutput);
	/** @param {(root: Uint8Array) => Promise<Uint8Array>} derive */
	const fromRoot = (derive) => derive(/** @type {Uint8Array} */ (prfOutput));
	const encryptionKey = bundleKeys ? bundleKeys.database : await fromRoot(deriveDatabaseKey);
	const blobKey = bundleKeys ? bundleKeys.blob : await fromRoot(deriveBlobKey);
	const backupKey = bundleKeys ? bundleKeys.backup : await fromRoot(deriveBackupKey);
	// The whole entries sealed again (entry-encryption.js sealedEncryption).
	const replicationKey = bundleKeys ? bundleKeys.replication : await fromRoot(deriveReplicationKey);
	// The UCEP node's key (ucep/net.js): the same peer id on every unlock.
	const ucepSeed = await derivePeerKeySeed(ownRoot);
	// The sync log's own key (sync/sync-log.js): never the books'.
	const { SYNC_LOG_INFO } = await import('./sync/sync-log.js');
	const syncLogSealer = await sealer(await deriveDatabaseKey(ownRoot, SYNC_LOG_INFO));

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
		? await generateKeyPairFromSeed('Ed25519', await deriveDevicePeerSeed(ownRoot, deviceSalt()))
		: await createEphemeralPeerKey();
	// Only a device that proves it holds the passkey gets the books (device-gate.js).
	// In "Beides" a device the books do not know yet comes in over the own network only.
	// The bridge's node proves with a key of its own (#575), only as the peer the
	// books name as their bridge, and reaches none of this node's protocols:
	// the device key never leaves the browser. Set once the books are open.
	/** @type {{ peerId: string | null, key: Uint8Array | null }} */
	const bridgeAuth = { peerId: null, key: null };
	const bridgeAuthBase = !online
		? null
		: bundleKeys
			? bundleKeys.bridgeAuth
			: await fromRoot(deriveBridgeAuthBase);
	const deviceAuthKey = !online
		? null
		: bundleKeys
			? bundleKeys.deviceAuth
			: await fromRoot(deriveDeviceAuthKey);
	const deviceGate = deviceAuthKey
		? createDeviceGate({
				keyFor: (peer) =>
					peer === bridgeAuth.peerId && bridgeAuth.key ? bridgeAuth.key : deviceAuthKey,
				limited: (peer) => peer === bridgeAuth.peerId,
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
		// A member writes as their own identity, from their own root (#612),
		// which the books granted write access when they joined (#611).
		const booksSecret = membership ? null : await fromRoot(deriveBooksSecret);
		// E2E builds only: books as they were made before #496, written by the
		// passkey's own identity (its signing key from the PRF answer, its proof
		// one more touch), so a test can watch them move (e2e/books-identity.spec.js).
		const beforeBooksIdentity =
			!membership &&
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
		const { MEMBER_IDENTITY_INFO } = await import('./members/member-vault.js');
		const books = membership
			? await createSecretSigner(membership.memberRoot, { info: MEMBER_IDENTITY_INFO })
			: await createSecretSigner(/** @type {Uint8Array} */ (booksSecret), {
					info: BOOKS_IDENTITY_INFO
				});
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
		// A member's device has never made the books' identity: its block, from
		// the bundle and checked against its hash, so every entry of the books
		// verifies without fetching it first (#612).
		if (membership) {
			const { CID } = await import('multiformats/cid');
			const { sha256 } = await import('multiformats/hashes/sha2');
			const { base58btc } = await import('multiformats/bases/base58');
			const bytes = membership.bundle.books.identity;
			const cid = CID.create(1, dagCbor.code, await sha256.digest(bytes));
			if (cid.toString(base58btc) !== membership.bundle.books.identityHash) {
				throw new Error('The bundle carries another identity than the books name.');
			}
			await helia.blockstore.put(cid, bytes);
		}
		const store = membership
			? await openStore({
					orbitdb,
					encryptionKey,
					replicationKey,
					names: membership.bundle.names,
					expectAddresses: membership.bundle.addresses,
					accessController: booksAccessController(membership.bundle.books.identityId),
					author: did,
					onOpen: (collection) => onStatus?.({ step: 'open', collection })
				})
			: await openStore({
					orbitdb,
					encryptionKey,
					replicationKey,
					prfOutput: /** @type {Uint8Array} */ (prfOutput),
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
		if (!membership) {
			setFlag(moveFlag);
			if (!beforeBooksIdentity) setFlag(booksFlag);
		} else {
			// A member's device learns its grant by sync (#611): until then the
			// access lists refuse what it would write, and OrbitDB drops heads it
			// refused without asking again. Once an access list changes, every
			// collection exchanges its heads once more.
			/** @type {ReturnType<typeof setTimeout> | undefined} */
			let again;
			for (const db of Object.values(store.databases())) {
				/** @type {any} */ (db).access?.events?.on?.('update', () => {
					clearTimeout(again);
					again = setTimeout(() => store.resync().catch(() => {}), 500);
				});
			}
		}
		// An empty device that found the books through the index: the account the
		// backups are kept for, so "Wiederherstellen" lists them at once.
		// A member's device keeps it in memory only (#613): before the books'
		// access list has come, it may not write to them.
		if (pointedOwner && !membership) {
			const { isAddress, loadOwner, saveOwner } = await import('./backup/keeper.js');
			if (isAddress(pointedOwner) && !(await loadOwner(store.settings))) {
				await saveOwner(store.settings, pointedOwner);
			}
		}
		onStatus?.({ step: 'blobs' });
		const blobs = await createBlobStore({ blockstore: helia.blockstore, key: blobKey, online });

		return {
			did,
			booksDid: membership ? membership.bundle.books.did : booksIdentity.id,
			/** A member's books (#612): which books, and the member's write identity; null for the owner. */
			member: membership
				? {
						books: membership.bundle.books,
						writer: booksIdentity.id,
						vaultId: membership.record.vault.id
					}
				: null,
			vault,
			ownIndexKey,
			pointedOwner: membership ? pointedOwner : '',
			/**
			 * A member's vault on Aleph's index G (#613), with the account the
			 * books' backups are kept for: an empty device finds it there.
			 *
			 * @param {string | null} owner
			 */
			async publishMembership(owner) {
				if (!membership || !membershipIndexKey) throw new Error('Not a member’s books.');
				const { publishMembership } = await import('./backup/vault-index.js');
				await publishMembership({
					key: membershipIndexKey,
					memberRoot: membership.memberRoot,
					record: membership.record,
					owner
				});
			},
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
				// A member's books are the sealed ones only: the older ones need the books' root.
				if (prfOutput) {
					for (const [name, dbName] of Object.entries(await oldBooksNames(prfOutput))) {
						const db = await orbitdb.open(dbName, oldOptions);
						oldAddresses[name] = String(db.address);
						await db.close();
					}
				}
				// A backup made before the books' own identity (#496) names the
				// passkey's databases: their addresses, from opening them likewise.
				const passkeyOptions = await passkeyBooksOpenOptions(encryptionKey, replicationKey, did);
				/** @type {Record<string, string>} */
				const passkeyAddresses = {};
				for (const name of prfOutput ? Object.keys(addresses) : []) {
					const db = await orbitdb.open(
						await deriveSealedDatabaseName(/** @type {Uint8Array} */ (prfOutput), name),
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
						...(prfOutput
							? [
									{ name: 'passkey', addresses: passkeyAddresses, open: passkeyOptions },
									{ name: 'old', addresses: oldAddresses, open: oldOptions }
								]
							: [])
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
			bridgeAuthBase,
			bridgeAuth,
			/**
			 * What a member of these books gets (#610, #611): the keys to read,
			 * sync, back up and reach the bridge, and every collection's address –
			 * never R, the books' secret or the vault key. Made from what this
			 * session holds; the device and bridge keys derived here when the
			 * node went online without them.
			 *
			 * @param {string} label how the books are called, for the member
			 */
			async memberBundle(label) {
				if (!prfOutput) throw new Error('Only the owner of the books admits members.');
				const { memberBundle } = await import('./members/member-vault.js');
				return memberBundle({
					books: {
						did: booksIdentity.id,
						identityId: booksIdentity.id,
						label,
						identityHash: booksIdentity.hash,
						identity: Uint8Array.from(booksIdentity.bytes)
					},
					keys: {
						database: encryptionKey,
						replication: replicationKey,
						blob: blobKey,
						deviceAuth: deviceAuthKey ?? (await deriveDeviceAuthKey(prfOutput)),
						backup: backupKey,
						bridgeAuth: bridgeAuthBase ?? (await deriveBridgeAuthBase(prfOutput))
					},
					names: Object.fromEntries(
						await Promise.all(
							Object.keys(store.databases()).map(async (name) => [
								name,
								await deriveSealedDatabaseName(/** @type {Uint8Array} */ (prfOutput), name)
							])
						)
					),
					addresses: Object.fromEntries(
						Object.entries(store.databases()).map(([name, db]) => [name, String(db.address)])
					)
				});
			},
			/**
			 * Let a member's write identity write to every collection (#611): the
			 * books, as the admin of each access list, grant it.
			 *
			 * @param {string} writer did:key
			 */
			async grantWriter(writer) {
				if (!prfOutput) throw new Error('Only the owner of the books admits members.');
				for (const db of Object.values(store.databases())) {
					await /** @type {any} */ (db).access.grant('write', writer);
				}
			},
			/**
			 * Take a member out (#614): in every collection's access list, what
			 * they wrote by now still counts and nothing after (store/books-access.js).
			 * Returns the devices their entries in the settings name.
			 *
			 * @param {string} writer
			 */
			async removeWriter(writer) {
				if (!prfOutput) throw new Error('Only the owner of the books takes members out.');
				/** @type {Set<string>} */
				const devices = new Set();
				for (const [name, db] of Object.entries(store.databases())) {
					const access = /** @type {any} */ (db).access;
					/** @type {string[]} */
					const theirs = [];
					for await (const entry of /** @type {any} */ (db).log.iterator()) {
						if ((await access.writerOf(entry)) !== writer) continue;
						theirs.push(entry.hash);
						const key = String(entry.payload?.key ?? '');
						if (name === 'settings' && key.startsWith('device:')) {
							devices.add(key.slice('device:'.length));
						}
					}
					await access.removeWriter(writer, theirs);
				}
				return [...devices];
			},
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

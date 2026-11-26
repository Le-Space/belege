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
import {
	asking,
	deviceSalt,
	deviceSyncOn,
	knownPeers,
	knownState,
	syncLibp2pConfig
} from './sync/device-sync.js';
import { firstContactPolicy, relayPeerOf } from './sync/first-contact.js';
import { createDeviceGate } from './sync/device-gate.js';
import { lanRelayAddr, networkMode, relaysFor } from './sync/network-mode.js';
import { attachQrSession, closeQrSession, qrPeers } from './sync/qr-link.js';
import { relayAddrs } from './ucep/net.js';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { BLOCKS_PROTOCOL } from '@le-space/bridge-protocol/exchange';
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

// Identity proofs in the provider's first format (before 0.14.0) stay
// accepted: the passkey wrote the books before they had their own identity
// (#496), and those databases and the backups made of them are signed by
// passkey identities with such proofs. Refusing them would leave those books
// unreadable. The books' own databases admit no passkey identity as a writer
// (books-access.js), and Belege never has the passkey sign a value it did not
// make itself. Said here, so the provider does not log it on every unlock.
configureWebAuthn({ acceptLegacyProofs: true });

import { createEphemeralPeerKey, createOfflineLibp2p } from './network.js';
import {
	deriveBackupKey,
	deriveBlobKey,
	deriveBooksSecret,
	deriveDatabaseKey,
	deriveBridgeAuthBase,
	deriveImageBase,
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

/**
 * Who wrote the books' databases before the books' own identity (#496), per
 * books identity, when it is not the passkey unlocking (#555): the DID a
 * restored backup of them names in their access controller – the founding
 * passkey's, while this browser opens the books with a later passkey or one
 * made with the recovery words. The next unlock moves them in under it. A
 * DID, nothing secret.
 */
export const FORMER_WRITER_KEY = 'belege.former-writer';

/** @param {string} booksId @returns {string | null} */
function formerWriterOf(booksId) {
	try {
		const value = localStorage.getItem(`${FORMER_WRITER_KEY}:${booksId}`);
		return value && value.startsWith('did:') ? value : null;
	} catch {
		return null;
	}
}

/** @param {string} booksId @param {string} writer */
function keepFormerWriter(booksId, writer) {
	try {
		localStorage.setItem(`${FORMER_WRITER_KEY}:${booksId}`, writer);
	} catch {
		// Not kept: the next unlock moves them in under this passkey's DID, as before.
	}
}

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

/** A write in a session of a member who only reads (#641). */
export class ReadOnlyError extends Error {
	/** @param {string} [message] in the person's language */
	constructor(message = 'These books are open to read only.') {
		super(message);
		this.name = 'ReadOnlyError';
	}
}

/**
 * @typedef {object} Session
 * @property {string} did the passkey's: shown, and what a record says wrote it
 * @property {string} booksDid the books' own identity, the root writer of every collection (#496)
 * @property {import('./books-vault.js').OpenedVault | null} vault the books' vault, open (#406); null for a member (#612)
 * @property {{ books: { did: string, identityId: string, label: string }, role: 'bookkeeping' | 'reader', writer: string, vaultId: string } | null} member a member's books (#612), and what they may do (#641); null for the owner
 * @property {{ peers: string[] } | { left: true } | null} moved the books have new keys (#627): this passkey took the new vault (`peers`: whom to dial there), or has no slot in it (`left`)
 * @property {Uint8Array} ownIndexKey this passkey's index key on Aleph (backup/vault-index.js), in memory
 * @property {(opened: import('./books-vault.js').OpenedVault) => Promise<{ opened: import('./books-vault.js').OpenedVault, lost: import('./books-vault.js').SlotInfo[] }>} convergeVault before publishing (#555): the vault the books keep on Aleph, taken when it is another one this passkey opens (books-vault.js `convergeOnPublished`)
 * @property {() => Promise<import('./books-vault.js').VaultRecord | null>} otherVault the other books this passkey has on Aleph (#524): asked of its index, checked with its slot; null when none
 * @property {string} pointedOwner the paying account a member's index on Aleph named (#613), in memory; '' when none
 * @property {(owner: string | null) => Promise<void>} publishMembership a member's vault on Aleph's index G (#613)
 * @property {Awaited<ReturnType<typeof openStore>>} store
 * @property {import('./receipts/blob-store.js').BlobStore} blobs receipt files, sealed with the blob key
 * @property {(meta: { appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').buildBackup>>>} makeBackup
 *   everything this browser keeps, as one sealed backup (issue #77)
 * @property {(meta: { chain: import('./backup/archive.js').BackupChain, appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').buildIncrement>>>} makeIncrement
 *   what is new since the chain's last backup, sealed; null when nothing is (#454)
 * @property {(sealed: import('./backup/archive.js').SealedSource, onProgress?: (p: import('./backup/archive.js').RestoreProgress) => void, chain?: { increments?: import('./backup/archive.js').SealedSource[], base?: string, fetchBytes?: (cid: string) => Promise<Uint8Array> }) => Promise<Awaited<ReturnType<typeof import('./backup/archive.js').restoreBackup>>>} restoreBackup
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
 * @property {Uint8Array | null} bridgeAuthBase the base of the bridge's own key, in memory only (database-keys.js)
 * @property {Uint8Array | null} imageBase the base of the passphrases of the books' own bridge images (#777), in memory only; null on a member's device
 * @property {any} devicePeerKey this device's own peer key, in memory only: the books' node's when online, else the one the node to the bridge on this machine uses (#580)
 * @property {(label: string, role?: 'bookkeeping' | 'reader', options?: { bridge?: boolean }) => Promise<import('./members/member-vault.js').MemberBundle>} memberBundle what a member gets (#611), by role and whether they may use the bridge (#641)
 * @property {(writer: string) => Promise<void>} grantWriter a member's write identity may write to every collection
 * @property {(writer: string) => Promise<{ devices: string[], settings: string[] }>} removeWriter a member taken out of every collection's access list (#614): the devices only they wrote, the settings whose newest value is theirs
 * @property {(keys: string[]) => Promise<string[]>} settingsByOthers the settings among these whose newest value a member wrote
 * @property {(key: string) => Promise<any>} booksSetting a setting's newest value as the books themselves wrote it; a member's is passed over
 * @property {{ peerId: string | null, key: Uint8Array | null }} bridgeAuth the books' bridge and its key for this generation: the gate proves with it toward that peer only
 * @property {() => Promise<void>} stop
 * @property {{ signingKey?: Uint8Array, booksSecret: Uint8Array | null, databaseKey: Uint8Array, replicationKey: Uint8Array, blobKey: Uint8Array, peerKey: Uint8Array }} [secretsForE2E]
 *   only in E2E builds
 */

/**
 * Where an unlock is (startSession `onStatus`).
 *
 * @typedef {{ step: 'keys' | 'identity' | 'blobs' }
 *   | { step: 'network', part?: 'storage' | 'relays' | 'node' | 'start' }
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
 *   otherVault?: boolean,
 *   recovered?: { opened: import('./books-vault.js').OpenedVault, owner: string, label: string },
 *   memberOf?: string,
 *   confirmNewBooks?: () => Promise<void> }} [options]
 *   `lookupVault`: an empty device – ask Aleph's index for the books' vault (#406)
 *   `otherVault`: the person chose the other books this passkey has on Aleph
 *   (#524): the index is asked although this browser keeps a vault for it
 *   `recovered`: the vault opened with recovery words (session.svelte.js
 *   `recoverWithWords`): this new passkey gets its slot there, and opens it
 *   `memberOf`: a member's books (#612) – the id of the member vault this
 *   passkey opens (members/member-vault.js); the books then open from the
 *   member bundle, never from a root
 *   `confirmNewBooks`: asked before a new vault is made for this passkey (#555:
 *   a restore that found none); throws to open nothing
 * @returns {Promise<Session>}
 * @throws {import('./passkey-identity.js').PrfUnavailableError} before anything is opened
 */
export async function startSession(
	credential,
	{
		onStatus,
		beforePrompt,
		lookupVault = false,
		otherVault = false,
		recovered,
		memberOf,
		confirmNewBooks
	} = {}
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
		(lookupVault || otherVault) && !recovered && !membership
			? await import('./backup/vault-index.js')
			: null;
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
					...(indexes ? { find: () => indexes.findVaultOnAleph({ prfOutput: passkeyPrf }) } : {}),
					...(otherVault ? { other: true } : {}),
					...(confirmNewBooks ? { confirmNew: confirmNewBooks } : {})
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
	/** None for a member who only reads (#641): they do not back up. */
	const backupKey = bundleKeys ? (bundleKeys.backup ?? null) : await fromRoot(deriveBackupKey);
	const backupKeyOrRefuse = () => {
		if (!backupKey) throw new Error('A member who only reads does not back up.');
		return backupKey;
	};
	// The whole entries sealed again (entry-encryption.js sealedEncryption).
	const replicationKey = bundleKeys ? bundleKeys.replication : await fromRoot(deriveReplicationKey);
	// The UCEP node's key (ucep/net.js): the same peer id on every unlock.
	const ucepSeed = await derivePeerKeySeed(ownRoot);
	// The sync log's own key (sync/sync-log.js): never the books'.
	const { SYNC_LOG_INFO } = await import('./sync/sync-log.js');
	const syncLogSealer = await sealer(await deriveDatabaseKey(ownRoot, SYNC_LOG_INFO));

	// A PR #1 build kept the signing key in IndexedDB. Gone before anything opens.
	await forgetLegacyKeystore();

	// The step in its parts, so an unlock that waits says for what (#803): the
	// browser's storage, the relays, the node.
	onStatus?.({ step: 'network', part: 'storage' });

	const blockstore = new LevelBlockstore(STORAGE_PATHS.blockstore);
	const datastore = new LevelDatastore(STORAGE_PATHS.datastore);
	// E2E builds only: a storage that never opens, to watch what the screen says then.
	if (
		import.meta.env.VITE_E2E === 'true' &&
		/** @type {any} */ (globalThis).__belegeStallStorage === true
	) {
		await new Promise(() => {});
	}
	// Opened here, not by the first read inside Helia's start: the browser's
	// IndexedDB has no timeout, and this is where an unlock has been seen to wait.
	await blockstore.open();
	await datastore.open();
	// Device sync (#123), when switched on for this device: online over the
	// relay, on a peer key of this device's own. Else offline, as always.
	// … and not while the network is paused in the header (network-pause.js).
	const online = deviceSyncOn() && !networkPause();
	// Where devices meet (#148), as this browser keeps it: the books are not open yet.
	const mode = networkMode();
	// Aleph is asked for the Le-Space relays only when this device goes online
	// in the public mode; the own network's relay is the bridge's (network-mode.js).
	if (online) onStatus?.({ step: 'network', part: 'relays' });
	const relays = online ? await relaysFor(mode, () => relayAddrs()) : [];
	onStatus?.({ step: 'network', part: 'node' });
	const relayPeers = new Set(
		[...relays, lanRelayAddr()].map((addr) => relayPeerOf(addr)).filter(Boolean)
	);
	// This device's own peer key: the books' node goes online with it; offline
	// it stays for the node that reaches the bridge on this machine (#580,
	// sync/loopback-bridge.js), and the books' node gets a key of this session.
	const devicePeerKey = await generateKeyPairFromSeed(
		'Ed25519',
		await deriveDevicePeerSeed(ownRoot, deviceSalt())
	);
	const peerKey = online ? devicePeerKey : await createEphemeralPeerKey();
	// Only a device that proves it holds the passkey gets the books (device-gate.js).
	// In "Beides" a device the books do not know yet comes in over the own network only.
	// The bridge's node proves with a key of its own (#575), only as the peer the
	// books name as their bridge, and reaches none of this node's protocols:
	// the device key never leaves the browser. Set once the books are open.
	/** @type {{ peerId: string | null, key: Uint8Array | null }} */
	const bridgeAuth = { peerId: null, key: null };
	// Online or not: the bridge on this machine is reached over a stream either way (#580).
	const bridgeAuthBase = bundleKeys
		? (bundleKeys.bridgeAuth ?? null)
		: await fromRoot(deriveBridgeAuthBase);
	// The books' own bridge image opens with a passphrase made from this (#777).
	// A member's bundle carries none: the owner's devices build and unlock it.
	const imageBase = bundleKeys ? null : await fromRoot(deriveImageBase);
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
				// …except the Bitswap on which it hands over big answers (#578), never the books' own.
				reach: [BLOCKS_PROTOCOL],
				// The proof is offered to devices, never to a relay this node dials.
				offer: (peer) => !relayPeers.has(peer),
				admit: firstContactPolicy({
					mode,
					knownPeers,
					state: knownState,
					lanRelayPeer: relayPeerOf(lanRelayAddr()),
					qrPeers,
					onUnknown: (peer) => asking.add(peer)
				})
			})
		: null;
	const libp2p = deviceGate
		? await createLibp2p(syncLibp2pConfig({ privateKey: peerKey, relays, gate: deviceGate, mode }))
		: await createOfflineLibp2p(peerKey);
	// The code exchange builds its connections on this node (qr-link.js).
	if (deviceGate && (mode === 'qr' || mode === 'both')) attachQrSession(libp2p);
	// The node is made; starting it reads the stores for the first time.
	onStatus?.({ step: 'network', part: 'start' });
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
		// Who wrote the databases before #496: the passkey unlocking, unless a
		// restored backup named another – the founding passkey (#555).
		const formerWriter = formerWriterOf(booksIdentity.id) ?? did;
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
					// What a member writes names them by their write identity – the one
					// the owner's member list knows them by (#614).
					author: booksIdentity.id,
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
								formerWriter,
								moveFromPasskey: !flagSet(booksFlag)
							}),
					move: !flagSet(moveFlag),
					onOpen: (collection) => onStatus?.({ step: 'open', collection }),
					onMove: ({ collection, moved, total }) =>
						onStatus?.({ step: 'move', collection, done: moved, total })
				});
		// A member who only reads (#641): every write refused here, before any
		// device's access list would refuse it – with words the person reads.
		if (membership?.bundle.role === 'reader') {
			const { COLLECTIONS } = await import('./store/repository.js');
			const { t } = await import('./i18n/index.js');
			const refuse = async () => {
				throw new ReadOnlyError(t('members.readOnly'));
			};
			for (const name of COLLECTIONS) {
				Object.assign(/** @type {any} */ (store)[name], {
					put: refuse,
					softDelete: refuse,
					restore: refuse
				});
			}
		}
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
		// The vault as the books keep it for every own device (#962): what
		// another device changed in the same vault is merged in (books-vault.js
		// `adoptSyncedVault`); a vault renewed there is taken with this
		// passkey's answer, now that it is at hand.
		if (vault && !membership) {
			const [{ readSharedVaults }, { adoptSyncedVault, adoptNewerVault }] = await Promise.all([
				import('./keys/vault-share.js'),
				import('./books-vault.js')
			]);
			try {
				const shared = await readSharedVaults(
					/** @type {any} */ (store.databases().settings),
					booksIdentity.id
				);
				for (const value of shared) {
					if (value.vault.id === vault.record.vault.id) {
						vault = adoptSyncedVault(vault, value, globalThis.localStorage);
					}
				}
				// A vault renewed on another device: the one that replaces this one.
				const next = shared.find(
					(value) =>
						Array.isArray(value.replaces) && value.replaces.includes(vault?.record.vault.id)
				);
				if (next) {
					vault = await adoptNewerVault(
						vault,
						next.vault,
						{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
						globalThis.localStorage,
						Array.isArray(next.slots) ? next.slots : []
					);
				}
			} catch (e) {
				// Never a reason to keep the books shut: the vault here still opens them.
				console.warn('the vault for the own devices:', e);
			}
		}
		// The books got new keys on another device, or on this one before a
		// reload (#627): their successor is in the settings. This passkey takes
		// the new vault when it has a slot there; the session says so, and the
		// page opens the new books at the next unlock.
		/** @type {{ peers: string[] } | { left: true } | null} */
		let moved = null;
		if (vault && !membership) {
			const [
				{ getSetting },
				{ SUCCESSOR_SETTING, successorWrittenBy },
				{ adoptSuccessorVault, RemovedPasskeyError }
			] = await Promise.all([
				import('./store/settings.js'),
				import('./move/rekey.js'),
				import('./books-vault.js')
			]);
			// Written by the books themselves, never by a member: the newest such
			// entry of the setting counts, any other writer's is passed over.
			let next = (await getSetting(store.settings, SUCCESSOR_SETTING))
				? await successorWrittenBy(
						/** @type {any} */ (store.databases().settings),
						SUCCESSOR_SETTING,
						booksIdentity.id
					)
				: null;
			let fromIndex = false;
			// Not here yet – this device was offline when the new keys were made:
			// the books' index on Aleph names it too, when the vault is kept there.
			if (!next?.vault && online && (await getSetting(store.settings, 'vault/index')) === true) {
				const { readRootSuccessor } = await import('./backup/vault-index.js');
				next = await readRootSuccessor({ root: vault.root }).catch(() => null);
				fromIndex = Boolean(next);
			}
			// A successor that does not open as one is no reason to keep the books shut.
			if (next?.vault) {
				try {
					await adoptSuccessorVault(
						vault,
						next.vault,
						{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
						globalThis.localStorage,
						Array.isArray(next.removed) ? next.removed.map(String) : []
					);
					moved = { peers: Array.isArray(next.peers) ? next.peers.map(String) : [] };
				} catch (e) {
					// Without this passkey's slot: said so only when the books wrote it.
					if (e instanceof RemovedPasskeyError && !fromIndex) moved = { left: true };
					else console.warn('new keys: a successor that does not open', e);
				}
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

		/**
		 * A backup made before new keys (#628): read with the keys of an earlier
		 * root the vault keeps (backup/archive.js `readEarlierBackup`). Only
		 * entries the books of that root signed count – their identity verified,
		 * the signature checked. What they hold is added where these books have
		 * no such record at all; nothing here is overwritten, no setting is taken,
		 * and a receipt keeps a file only when the backup carries it.
		 *
		 * @param {import('./backup/archive.js').SealedSource} sealed read again, whole: this
		 *   way opens a backup without OrbitDB and needs all of it in hand
		 * @param {{ increments?: import('./backup/archive.js').SealedSource[], base?: string } | undefined} chain
		 * @param {Error} refused what the current key said
		 */
		async function restoreEarlier(sealed, chain, refused) {
			const [{ readEarlierBackup, WrongPasskeyError }, { Entry }, { createSecretSigner }] =
				await Promise.all([
					import('./backup/archive.js'),
					import('@orbitdb/core'),
					import('@le-space/orbitdb-identity-provider-webauthn-did')
				]);
			/** @type {Awaited<ReturnType<typeof readEarlierBackup>> | null} */
			let earlier = null;
			for (const root of vault?.previous ?? []) {
				// The books of that root: the only writer whose entries count.
				const then = (
					await createSecretSigner(await deriveBooksSecret(root), { info: BOOKS_IDENTITY_INFO })
				).did;
				try {
					earlier = await readEarlierBackup({
						sealed,
						...(chain?.increments ? { increments: chain.increments, base: chain.base } : {}),
						key: await deriveBackupKey(root),
						dataKey: await deriveDatabaseKey(root),
						replicationKey: await deriveReplicationKey(root),
						blobKey: await deriveBlobKey(root),
						accept: async (entry, identity) =>
							identity.id === then &&
							identity.hash === entry.identity &&
							identity.publicKey === entry.key &&
							(await booksIdentities.verifyIdentity(identity)) &&
							(await Entry.verify(booksIdentities, entry))
					});
					break;
				} catch (e) {
					if (!(e instanceof WrongPasskeyError)) throw e;
				}
			}
			if (!earlier) throw refused;
			/** @type {Map<string, string>} the backup's file CIDs → these books' */
			const cids = new Map();
			for (const [cid, bytes] of earlier.files) cids.set(cid, await blobs.put(bytes));
			/** @param {unknown} cid */
			const file = (cid) => (typeof cid === 'string' && cids.get(cid)) || null;
			const databases = [];
			for (const [collection, list] of Object.entries(earlier.records)) {
				const target = /** @type {any} */ (store)[collection];
				// Settings are this browser's books' own: none from a backup of before.
				if (!target?.restore || collection === 'settings') continue;
				const here = new Set(
					(await target.list({ includeDeleted: true })).map((/** @type {any} */ r) => String(r.id))
				);
				let joined = 0;
				for (const record of list) {
					if (here.has(String(record.id))) continue;
					const moved =
						collection === 'receipts'
							? {
									...record,
									...('fileCid' in record ? { fileCid: file(record.fileCid) } : {}),
									...('emlCid' in record ? { emlCid: file(record.emlCid) } : {}),
									...('xmlCid' in record ? { xmlCid: file(record.xmlCid) } : {})
								}
							: record;
					await target.restore(moved);
					joined++;
				}
				databases.push({ collection, joined, entries: list.length });
			}
			return {
				manifest: earlier.manifest,
				target: 'earlier',
				increments: chain?.increments?.length ?? 0,
				// Read whole, without OrbitDB: no block of it went into the blockstore as it is.
				streamed: false,
				blocks: 0,
				databases
			};
		}

		return {
			did,
			booksDid: membership ? membership.bundle.books.did : booksIdentity.id,
			/** A member's books (#612): which books, and the member's write identity; null for the owner. */
			member: membership
				? {
						books: membership.bundle.books,
						role: membership.bundle.role,
						writer: booksIdentity.id,
						vaultId: membership.record.vault.id
					}
				: null,
			vault,
			moved,
			ownIndexKey,
			/**
			 * Before the vault is published (#555): index M of the books, and the
			 * vault there taken when it is another one this passkey opens
			 * (books-vault.js `convergeOnPublished`). The caller respects the pause.
			 *
			 * @param {import('./books-vault.js').OpenedVault} opened
			 */
			async convergeVault(opened) {
				const [{ readRootIndex }, { convergeOnPublished }] = await Promise.all([
					import('./backup/vault-index.js'),
					import('./books-vault.js')
				]);
				return convergeOnPublished(
					opened,
					await readRootIndex({ root: opened.root }),
					{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
					globalThis.localStorage
				);
			},
			/**
			 * The other books this passkey has on Aleph (#524), for a device that
			 * founded books of its own: its index there is asked, and what it names
			 * counts only when this passkey opens it and it holds other books
			 * (books-vault.js `otherBooks`). Nothing is kept. The caller respects
			 * the pause.
			 *
			 * @returns {Promise<import('./books-vault.js').VaultRecord | null>}
			 */
			async otherVault() {
				if (!vault) return null;
				const [{ findVaultOnAleph }, { loadVaultRecords, otherBooks }] = await Promise.all([
					import('./backup/vault-index.js'),
					import('./books-vault.js')
				]);
				return otherBooks(
					vault,
					await findVaultOnAleph({ prfOutput: passkeyPrf }),
					{ prfOutput: passkeyPrf, rawCredentialId: credential.rawCredentialId },
					loadVaultRecords(globalThis.localStorage)
				);
			},
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
					key: backupKeyOrRefuse(),
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
					key: backupKeyOrRefuse(),
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
			 * @param {import('./backup/archive.js').SealedSource} sealed bytes, a stream, or a
			 *   function that starts one (#512): a function lets the file be asked for again
			 * @param {(p: import('./backup/archive.js').RestoreProgress) => void} [onProgress]
			 * @param {{ increments?: import('./backup/archive.js').SealedSource[], base?: string,
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
				/**
				 * The addresses of databases by name, opened once (without sync) as
				 * `options` open them: they depend on who may write (#555).
				 *
				 * @param {Record<string, string>} names by collection
				 * @param {Record<string, any>} options
				 */
				const addressesFor = async (names, options) => {
					/** @type {Record<string, string>} */
					const out = {};
					for (const [collection, dbName] of Object.entries(names)) {
						const db = await orbitdb.open(dbName, options);
						out[collection] = String(db.address);
						await db.close();
					}
					return out;
				};
				// A member's books are the sealed ones only: the older ones need the books' root.
				// A backup made before the replication layer names the old databases;
				// one made before the books' own identity (#496), the passkey's.
				const oldNames = prfOutput ? await oldBooksNames(prfOutput) : {};
				/** @type {Record<string, string>} */
				const passkeyNames = {};
				for (const name of prfOutput ? Object.keys(addresses) : []) {
					passkeyNames[name] = await deriveSealedDatabaseName(
						/** @type {Uint8Array} */ (prfOutput),
						name
					);
				}
				const oldOptions = await oldBooksOpenOptions(encryptionKey, formerWriter);
				const passkeyOptions = await passkeyBooksOpenOptions(
					encryptionKey,
					replicationKey,
					formerWriter
				);
				const oldAddresses = await addressesFor(oldNames, oldOptions);
				const passkeyAddresses = await addressesFor(passkeyNames, passkeyOptions);
				let closed = false;
				const result = await restoreBackup({
					orbitdb,
					sealed,
					...(chain ? { increments: chain.increments, base: chain.base } : {}),
					...(chain?.fetchBytes ? { fetchBytes: chain.fetchBytes } : {}),
					key: backupKeyOrRefuse(),
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
									// Written by another passkey than this one – the founding one,
									// when this is a later passkey or the recovery words' (#555):
									// fitted by name, the writer read from the backup.
									{
										name: 'passkey',
										addresses: passkeyAddresses,
										open: passkeyOptions,
										names: passkeyNames,
										resolve: async (/** @type {string} */ writer) => {
											const open = await passkeyBooksOpenOptions(
												encryptionKey,
												replicationKey,
												writer
											);
											return { open, addresses: await addressesFor(passkeyNames, open) };
										}
									},
									{
										name: 'old',
										addresses: oldAddresses,
										open: oldOptions,
										names: oldNames,
										resolve: async (/** @type {string} */ writer) => {
											const open = await oldBooksOpenOptions(encryptionKey, writer);
											return { open, addresses: await addressesFor(oldNames, open) };
										}
									}
								]
							: [])
					],
					onProgress,
					// The access lists' sealing (books-access.js): a backup carries them.
					listEncryption: encryption,
					beforeRestore: async () => {
						await store.close();
						closed = true;
					}
				}).catch(async (/** @type {any} */ error) => {
					if (closed && error && typeof error === 'object') error.booksClosed = true;
					// Made before the books got new keys (#628): opened with an earlier root.
					if (error?.name === 'WrongPasskeyError' && !closed && vault?.previous?.length) {
						return restoreEarlier(sealed, chain, error);
					}
					throw error;
				});
				// Written by another passkey: the next unlock moves them in under it.
				// (A restore with an earlier root's keys, #628, names none.)
				const writer = 'writer' in result ? result.writer : undefined;
				if (writer) keepFormerWriter(booksIdentity.id, writer);
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
			imageBase,
			devicePeerKey,
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
			async memberBundle(label, role = 'bookkeeping', { bridge = true } = {}) {
				if (!prfOutput) throw new Error('Only the owner of the books admits members.');
				const { memberBundle } = await import('./members/member-vault.js');
				return memberBundle({
					role,
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
						// Who only reads backs nothing up and reaches no bridge (#641).
						...(role === 'reader'
							? {}
							: {
									backup: backupKeyOrRefuse(),
									// Without the bridge: no key to prove itself to it.
									...(bridge
										? { bridgeAuth: bridgeAuthBase ?? (await deriveBridgeAuthBase(prfOutput)) }
										: {})
								})
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
			 * Returns the devices only they ever wrote into the settings – not one
			 * the books wrote too –, and the settings whose newest value is theirs.
			 *
			 * @param {string} writer
			 */
			async removeWriter(writer) {
				if (!prfOutput) throw new Error('Only the owner of the books takes members out.');
				/** @type {Map<string, Set<string>>} a setting → everyone who wrote it */
				const writersOf = new Map();
				/** @type {Map<string, string>} a setting → who wrote its newest value */
				const newest = new Map();
				for (const [name, db] of Object.entries(store.databases())) {
					const access = /** @type {any} */ (db).access;
					/** @type {string[]} */
					const theirs = [];
					for await (const entry of /** @type {any} */ (db).log.iterator()) {
						const by = await access.writerOf(entry);
						const key = String(entry.payload?.value?.key ?? '');
						if (name === 'settings' && key) {
							if (!newest.has(key)) newest.set(key, by);
							writersOf.set(key, (writersOf.get(key) ?? new Set()).add(by));
						}
						if (by === writer) theirs.push(entry.hash);
					}
					await access.removeWriter(writer, theirs);
				}
				const onlyTheirs = (/** @type {string} */ key) =>
					[...(writersOf.get(key) ?? [])].every((w) => w === writer);
				return {
					devices: [...writersOf.keys()]
						.filter((k) => k.startsWith('device:') && onlyTheirs(k))
						.map((k) => k.slice('device:'.length)),
					settings: [...newest]
						.filter(([k, by]) => by === writer && !/^(device|member):/.test(k))
						.map(([k]) => k)
				};
			},
			/**
			 * A setting's newest value as the books themselves wrote it: on a
			 * member's device too, a member's own entry is passed over.
			 *
			 * @param {string} key
			 */
			async booksSetting(key) {
				const { settingWrittenBy } = await import('./store/settings.js');
				return settingWrittenBy(
					/** @type {any} */ (store.databases().settings),
					key,
					membership ? membership.bundle.books.did : booksIdentity.id
				);
			},
			/**
			 * The settings among `keys` whose newest value the books did not write
			 * themselves – a member did (#627: not carried over to new keys).
			 *
			 * @param {string[]} keys
			 */
			async settingsByOthers(keys) {
				const db = /** @type {any} */ (store.databases().settings);
				/** @type {Set<string>} */
				const seen = new Set();
				/** @type {string[]} */
				const others = [];
				for await (const entry of db.log.iterator()) {
					const key = String(entry.payload?.value?.key ?? '');
					if (!keys.includes(key) || seen.has(key)) continue;
					seen.add(key);
					if ((await db.access.writerOf(entry)) !== booksIdentity.id) others.push(key);
				}
				return others;
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

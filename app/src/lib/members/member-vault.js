// A member of the books (#6, #610): a person with a passkey of their own who
// works on the books – first the in-house bookkeeping, with full access.
//
// What a member gets is a key bundle, never a slot in the books' vault:
//
//   keys      the database key, the replication key, the blob key, the device
//             auth key (the member's devices pass the device gate), the
//             backup key (the bookkeeping backs up and restores) and the base
//             of the bridge's key (database-keys.js `deriveBridgeAuthBase`):
//             the member's devices reach the owner's bridge like the owner's
//             own. A removed member's devices leave the books' device list,
//             which is what the bridge admits by (bridge/src/node.js `devices`).
//   addresses every collection's OrbitDB address, so the member opens the very
//             databases the books write – by address, the books' access lists
//             looked up by their type (store/books-access.js)
//   books     the books' DID and the id of their OrbitDB identity
//
// Not in it: the books' root R, the books' secret (what signs as the books),
// the vault key. A member reads, syncs, backs up and restores; a member never
// writes as the books, and never opens or makes slots in the books' vault. A
// member writes under an identity of their own, which the books grant write
// access (#611): its key comes from the member's own random root, kept beside
// the bundle.
//
// The member vault keeps the bundle and that root: the same format as the
// books' vault (@le-space/orbitdb-identity-provider-webauthn-did `createVault`),
// one slot per passkey of the member, filed in this browser apart from the
// books' vaults (MEMBERSHIPS_STORAGE_KEY). The slot key has a label of its own,
// so a passkey's slot here never opens its slot in a books' vault, nor the
// other way round.

import {
	createVault,
	deriveAesKey,
	openVault,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';

import { COLLECTIONS } from '../store/repository.js';

export const MEMBERSHIPS_STORAGE_KEY = 'belege.memberships.v1';
/** The `info` a member's write identity is derived under from the member's root (`createSecretSigner`). */
export const MEMBER_IDENTITY_INFO = 'belege/member-identity/v1';
/** The member vault's slot key: never the books' vault's (VAULT_SLOT_INFO). */
export const MEMBER_SLOT_INFO = 'belege/member-slot/v1';
export const BUNDLE_VERSION = 1;
const PAYLOAD_VERSION = 1;
const KEY_BYTES = 32;
const KEY_NAMES = /** @type {const} */ ([
	'database',
	'replication',
	'blob',
	'deviceAuth',
	'backup',
	'bridgeAuth'
]);
const ADDRESS = /^\/orbitdb\/zdpu[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const DID = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,80}$/;

export class MemberBundleError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'MemberBundleError';
	}
}

/**
 * @typedef {object} MemberBundle
 * @property {number} version
 * @property {{ did: string, identityId: string, label: string }} books
 * @property {Record<typeof KEY_NAMES[number], Uint8Array>} keys
 * @property {Record<string, string>} addresses by collection
 */

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** @param {unknown} hex @param {number} length @param {string} what */
function fromHex(hex, length, what) {
	if (typeof hex !== 'string' || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(hex)) {
		throw new MemberBundleError(`The bundle's ${what} has the wrong shape.`);
	}
	return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/**
 * The bundle a member gets, from what the open books hold – checked: six
 * keys of 32 bytes, an address for every collection, the books named.
 *
 * @param {{ books: MemberBundle['books'], keys: MemberBundle['keys'], addresses: Record<string, string> }} p
 * @returns {MemberBundle}
 */
export function memberBundle({ books, keys, addresses }) {
	const bundle = { version: BUNDLE_VERSION, books, keys, addresses };
	return decodeBundle(encodeBundle(bundle));
}

/** @param {MemberBundle} bundle @returns {string} */
export function encodeBundle(bundle) {
	for (const name of KEY_NAMES) {
		const key = bundle.keys?.[name];
		if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
			throw new MemberBundleError(`The bundle needs the ${name} key, 32 bytes.`);
		}
	}
	return JSON.stringify({
		version: bundle.version,
		books: {
			did: bundle.books?.did,
			identityId: bundle.books?.identityId,
			label: String(bundle.books?.label ?? '').slice(0, 80)
		},
		keys: Object.fromEntries(KEY_NAMES.map((n) => [n, toHex(bundle.keys[n])])),
		addresses: Object.fromEntries(COLLECTIONS.map((c) => [c, bundle.addresses?.[c]]))
	});
}

/**
 * @param {string} text
 * @returns {MemberBundle}
 */
export function decodeBundle(text) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new MemberBundleError('The bundle is not readable.');
	}
	if (parsed?.version !== BUNDLE_VERSION) {
		throw new MemberBundleError('The bundle has a version this page does not know.');
	}
	const books = parsed.books ?? {};
	if (!DID.test(String(books.did)) || !DID.test(String(books.identityId))) {
		throw new MemberBundleError('The bundle does not name its books.');
	}
	const keys = /** @type {MemberBundle['keys']} */ (
		Object.fromEntries(KEY_NAMES.map((n) => [n, fromHex(parsed.keys?.[n], KEY_BYTES, `${n} key`)]))
	);
	/** @type {Record<string, string>} */
	const addresses = {};
	for (const c of COLLECTIONS) {
		const a = parsed.addresses?.[c];
		if (!ADDRESS.test(String(a)))
			throw new MemberBundleError(`The bundle has no address for ${c}.`);
		addresses[c] = a;
	}
	const extra = Object.keys(parsed).filter(
		(k) => !['version', 'books', 'keys', 'addresses'].includes(k)
	);
	if (extra.length) throw new MemberBundleError('The bundle holds more than it should.');
	return {
		version: BUNDLE_VERSION,
		books: { did: books.did, identityId: books.identityId, label: String(books.label ?? '') },
		keys,
		addresses
	};
}

/**
 * @typedef {{ kid: string, label: string, credentialId: string, addedAt: string }} MemberSlotInfo
 * @typedef {{ vault: any, slots: MemberSlotInfo[], books: { did: string, label: string } }} MemberRecord
 *   `books`: which books this membership opens – public, so the unlock can say it
 */

/** @param {Pick<Storage, 'getItem'>} storage @returns {MemberRecord[]} */
export function loadMemberships(storage) {
	const raw = storage.getItem(MEMBERSHIPS_STORAGE_KEY);
	if (!raw) return [];
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed))
		throw new MemberBundleError('The memberships kept here are not readable.');
	return parsed.filter((r) => r?.vault && Array.isArray(r.vault.slots) && Array.isArray(r.slots));
}

/** @param {Pick<Storage, 'getItem' | 'setItem'>} storage @param {MemberRecord} record */
function saveMembership(storage, record) {
	const all = loadMemberships(storage).filter((r) => r.vault.id !== record.vault.id);
	storage.setItem(MEMBERSHIPS_STORAGE_KEY, JSON.stringify([...all, record]));
}

/** @param {Uint8Array} prfOutput */
const slotKeyOf = (prfOutput) => deriveAesKey(prfOutput, MEMBER_SLOT_INFO);

/** @param {MemberBundle} bundle @param {Uint8Array} memberRoot */
const encodePayload = (bundle, memberRoot) =>
	new TextEncoder().encode(
		JSON.stringify({
			version: PAYLOAD_VERSION,
			memberRoot: toHex(memberRoot),
			bundle: encodeBundle(bundle)
		})
	);

/** @param {Uint8Array} bytes */
function decodePayload(bytes) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new MemberBundleError('The member vault opened, but what it holds is not readable.');
	}
	if (parsed?.version !== PAYLOAD_VERSION) {
		throw new MemberBundleError('The member vault holds a version this page does not know.');
	}
	return {
		memberRoot: fromHex(parsed.memberRoot, KEY_BYTES, 'member root'),
		bundle: decodeBundle(parsed.bundle)
	};
}

/**
 * A member vault for a bundle just received, with the joining passkey's slot
 * and a new random root of the member's own (their write identity, #611).
 *
 * @param {object} p
 * @param {MemberBundle} p.bundle
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array, credentialId: string, label: string }} p.passkey
 * @param {Pick<Storage, 'getItem' | 'setItem'>} p.storage
 * @param {() => Date} [p.now]
 * @param {Uint8Array} [p.memberRoot] the root the join code's write identity came from (join.js)
 */
export async function createMemberVault({
	bundle,
	passkey,
	storage,
	now = () => new Date(),
	memberRoot = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
}) {
	const kid = await slotIdFor(passkey.rawCredentialId);
	const { vault, vaultKey } = await createVault(encodePayload(bundle, memberRoot), {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	/** @type {MemberRecord} */
	const record = {
		vault,
		slots: [
			{
				kid,
				label: passkey.label,
				credentialId: passkey.credentialId,
				addedAt: now().toISOString()
			}
		],
		books: { did: bundle.books.did, label: bundle.books.label }
	};
	saveMembership(storage, record);
	return { record, vaultKey, bundle, memberRoot, kid };
}

/**
 * The memberships this passkey opens here (or, through `find`, on Aleph): each
 * with its bundle and the member's root. None: an empty list – the passkey then
 * opens its own books only.
 *
 * @param {object} p
 * @param {Uint8Array} p.prfOutput
 * @param {Uint8Array} p.rawCredentialId
 * @param {Pick<Storage, 'getItem'>} p.storage
 */
export async function openMemberships({ prfOutput, rawCredentialId, storage }) {
	const kid = await slotIdFor(rawCredentialId);
	const slotKey = await slotKeyOf(prfOutput);
	const opened = [];
	for (const record of loadMemberships(storage)) {
		if (!record.vault.slots.some((/** @type {any} */ s) => s.kid === kid)) continue;
		const { payload, vaultKey } = await openVault(record.vault, { slotKey, rawCredentialId });
		opened.push({ record, vaultKey, kid, ...decodePayload(payload) });
	}
	return opened;
}

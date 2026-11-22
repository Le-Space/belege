// The books' vault (#406): what every passkey of the books opens alike.
//
// Every key Belege uses is derived with HKDF from one root, the PRF output of
// the passkey that made the books (database-keys.js). A second passkey has
// another PRF output, so on its own it derives other keys and opens other,
// empty books. The vault keeps that root once, sealed under a random vault
// key, and gives each registered passkey a slot: the vault key sealed under a
// key only that passkey derives (`deriveAesKey(prfOutput, VAULT_SLOT_INFO)`,
// `createVault` in @le-space/orbitdb-identity-provider-webauthn-did). Any slot
// opens the vault; the root comes out unchanged, and with it every key, the
// books' identity (#496) and every backup made before or after.
//
// Books made before the vault move in without moving anything: the first
// unlock after this update puts exactly the root that passkey derives today
// – its PRF output – into a new vault, under its own slot.
//
// The record is public JSON, sealed where it matters (the package binds every
// ciphertext to the vault and every slot to its passkey). It is kept in this
// origin's localStorage, one per set of books, with a label and the
// credential id of each slot beside it – public, so a renewal can ask each
// passkey that stays. A slot removed here is remembered, so that passkey is
// refused rather than given new, empty books.
//
// Recovery words (stage 2, recovery-words.js) are one more slot: its key
// comes from the words' seed instead of a passkey's PRF output, and it is
// filed under a fixed id (`WORDS_SLOT_ID`, in place of a credential id), so a
// vault has at most one set of words. With them, an empty device opens the
// vault and gives a new passkey its slot (`openWithWords`, `addPasskey`).
//
// What a vault does not do: a removed passkey has seen the root, and the root
// cannot be renewed without sealing the books anew. Renewing the vault key
// keeps what is added to the vault later from it (`renewBooksVault`).

import {
	createVault,
	deriveAesKey,
	openVault,
	addSlot as addVaultSlot,
	slotIdFor
} from '@le-space/orbitdb-identity-provider-webauthn-did';

/** Bumping this gives every passkey a new slot key: no slot would open any more. */
export const VAULT_SLOT_INFO = 'belege/vault-slot/v1';

/** The words' slot key, from their BIP39 seed. */
export const WORDS_SLOT_INFO = 'belege/vault-slot/words/v1';

/**
 * What the words' slot is filed under, in place of a credential id: one set
 * of words per vault. The package's phrase slot (#92 there) will have its own
 * format; a vault moves to it by renewing.
 */
export const WORDS_SLOT_ID = new TextEncoder().encode('belege/recovery-words/v1');

/** Where the vault records are kept: a JSON array, one record per set of books. */
export const VAULTS_STORAGE_KEY = 'belege.vaults.v1';

const PAYLOAD_VERSION = 1;
/** With the roots the books had before new keys (#627). */
const PAYLOAD_VERSION_PREVIOUS = 2;
const ROOT_BYTES = 32;

/**
 * @typedef {{ kid: string, label: string, credentialId: string, addedAt: string, kind?: 'words' }} SlotInfo
 *   what this browser says about a slot, beside the sealed vault: public
 * @typedef {{ vault: any, slots: SlotInfo[], removed: string[], removedAt?: Record<string, string>, aside?: string[], replaces?: string[] }} VaultRecord
 *   `aside`: the passkeys (slot ids) that open other books in this browser now
 *   (#524): their slot here stays, and is passed over at unlock;
 *   `replaces`: the ids of the vaults this one renewed here (#555) – one of
 *   them published on Aleph is this record's own older self, not another device's;
 *   `removedAt`: when each passkey was taken out, so a record that comes by
 *   sync (#962) does not bring a slot back that was removed after it was added
 * @typedef {{ record: VaultRecord, vaultKey: Uint8Array, root: Uint8Array, previous?: Uint8Array[], kid: string, created: boolean, found?: boolean, switched?: boolean }} OpenedVault
 *   `found`: the record came from elsewhere (the index), not this browser;
 *   `switched`: … in place of books this passkey had founded here (#524);
 *   `previous`: the roots before new keys (#627), newest first – for backups made then
 */

/** A vault record that cannot be read: never a reason to make new books. */
export class VaultStorageError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'VaultStorageError';
	}
}

/** A passkey that was removed from the books: it opens nothing, and gets no new books. */
export class RemovedPasskeyError extends Error {
	constructor() {
		super('This passkey was removed from these books.');
		this.name = 'RemovedPasskeyError';
	}
}

/**
 * A passkey without a slot in the vault the books keep on Aleph, where that
 * vault is another than the one this passkey opens (#555): two devices of the
 * same books may each have made a vault, and the one published lacks this
 * passkey. Refused like a removed passkey, but not remembered as removed:
 * once the vault with its slot is published, it opens the books again.
 */
export class NotInPublishedVaultError extends Error {
	constructor() {
		super('This passkey has no slot in the vault these books keep on Aleph.');
		this.name = 'NotInPublishedVaultError';
	}
}

/**
 * Another vault of the same books is published, and the passkey open here
 * has no slot in it (#555): publishing this one would lock out the passkeys
 * that only that one has.
 */
export class PublishedVaultLacksPasskeyError extends Error {
	constructor() {
		super('The vault these books keep on Aleph has no slot for this passkey.');
		this.name = 'PublishedVaultLacksPasskeyError';
	}
}

/**
 * Recovery words the books no longer carry: taken out, or replaced by newer
 * ones. They open nothing, like a removed passkey.
 */
export class RemovedWordsError extends Error {
	constructor() {
		super('These recovery words were removed from these books.');
		this.name = 'RemovedWordsError';
	}
}

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** @param {string} hex @param {number} length */
function fromHex(hex, length) {
	if (typeof hex !== 'string' || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(hex)) {
		throw new VaultStorageError('The vault holds a value of the wrong shape.');
	}
	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
	return bytes;
}

/**
 * The payload: the root, and the roots before new keys (#627).
 *
 * @param {Uint8Array} root
 * @param {Uint8Array[]} [previous]
 */
const encodePayload = (root, previous = []) =>
	new TextEncoder().encode(
		JSON.stringify(
			previous.length
				? { version: PAYLOAD_VERSION_PREVIOUS, root: toHex(root), previous: previous.map(toHex) }
				: { version: PAYLOAD_VERSION, root: toHex(root) }
		)
	);

/** @param {Uint8Array} bytes @returns {Uint8Array} the root */
const decodePayload = (bytes) => decodeRoots(bytes).root;

/** @param {Uint8Array} bytes @returns {{ root: Uint8Array, previous: Uint8Array[] }} */
function decodeRoots(bytes) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new VaultStorageError('The vault opened, but what it holds is not readable.');
	}
	if (parsed?.version !== PAYLOAD_VERSION && parsed?.version !== PAYLOAD_VERSION_PREVIOUS) {
		throw new VaultStorageError('The vault holds a version this page does not know.');
	}
	const previous = parsed.version === PAYLOAD_VERSION_PREVIOUS ? parsed.previous : [];
	if (!Array.isArray(previous))
		throw new VaultStorageError('The vault holds a value of the wrong shape.');
	return {
		root: fromHex(parsed.root, ROOT_BYTES),
		previous: previous.map((/** @type {string} */ h) => fromHex(h, ROOT_BYTES))
	};
}

/**
 * Every vault record this browser keeps. An unreadable store is an error: it
 * may hold books, and is never overwritten.
 *
 * @param {Pick<Storage, 'getItem'>} storage
 * @returns {VaultRecord[]}
 */
export function loadVaultRecords(storage) {
	const text = storage.getItem(VAULTS_STORAGE_KEY);
	if (text === null) return [];
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new VaultStorageError('The vaults kept in this browser are not readable.');
	}
	if (!Array.isArray(parsed)) {
		throw new VaultStorageError('The vaults kept in this browser are not readable.');
	}
	return parsed.map((r) => {
		if (!r || typeof r !== 'object' || !r.vault || !Array.isArray(r.vault.slots)) {
			throw new VaultStorageError('A vault kept in this browser is not readable.');
		}
		return {
			vault: r.vault,
			slots: Array.isArray(r.slots) ? r.slots : [],
			removed: Array.isArray(r.removed) ? r.removed.map(String) : [],
			...(r.removedAt && typeof r.removedAt === 'object' && Object.keys(r.removedAt).length
				? { removedAt: removedAtOf(r.removedAt) }
				: {}),
			...(Array.isArray(r.aside) && r.aside.length ? { aside: r.aside.map(String) } : {}),
			...(Array.isArray(r.replaces) && r.replaces.length
				? { replaces: r.replaces.map(String) }
				: {})
		};
	});
}

/** @param {any} value @returns {Record<string, string>} */
function removedAtOf(value) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [kid, at] of Object.entries(value ?? {})) {
		if (typeof at === 'string') out[String(kid)] = at;
	}
	return out;
}

/** What a record keeps when it is written anew. @param {VaultRecord} record */
const asideOf = (record) => ({
	...(record.removedAt && Object.keys(record.removedAt).length
		? { removedAt: record.removedAt }
		: {}),
	...(record.aside?.length ? { aside: record.aside } : {}),
	...(record.replaces?.length ? { replaces: record.replaces } : {})
});

/** @param {Uint8Array} a @param {Uint8Array} b */
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Keep a record: replaces the one with the same vault id, else adds it.
 *
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {VaultRecord} record
 */
export function saveVaultRecord(storage, record) {
	const records = loadVaultRecords(storage);
	const at = records.findIndex((r) => r.vault.id === record.vault.id);
	if (at >= 0) records[at] = record;
	else records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
}

/** @param {Uint8Array} prfOutput */
const slotKeyOf = (prfOutput) => deriveAesKey(prfOutput, VAULT_SLOT_INFO);

/**
 * Open the books' vault with a passkey's PRF output, or make one.
 *
 * - A record here with a slot for this passkey: opened, its root returned.
 * - A record here that removed this passkey: refused (`RemovedPasskeyError`).
 * - A record found elsewhere (`found`, e.g. the Aleph index on an empty
 *   device): kept here, then opened.
 * - None: a new vault with this passkey's own PRF output as the root – books
 *   made before the vault keep exactly the keys they had.
 * - `other` (#524): a record here, and the person asked for the books this
 *   passkey has elsewhere. `find` is asked all the same; a vault from there
 *   that this passkey opens and that holds other books is kept and opened,
 *   and the record here is set aside for this passkey, not deleted. Anything
 *   else – nothing found, no answer, the same books – opens the record here.
 *
 * @param {object} params
 * @param {Uint8Array} params.prfOutput
 * @param {Uint8Array} params.rawCredentialId
 * @param {string} params.credentialId base64url, kept beside the slot
 * @param {string} [params.label] the passkey's name
 * @param {Pick<Storage, 'getItem' | 'setItem'>} params.storage
 * @param {(kid: string) => Promise<VaultRecord | null>} [params.find] where else to look
 * @param {boolean} [params.other] take the other books `find` names (#524)
 * @param {() => Promise<void>} [params.confirmNew] asked before a new vault is
 *   made (#555: a restore); throws to make none, and nothing is kept then
 * @param {() => Date} [params.now]
 * @returns {Promise<OpenedVault>}
 */
export async function openBooksVault({
	prfOutput,
	rawCredentialId,
	credentialId,
	label = '',
	storage,
	find,
	other = false,
	confirmNew,
	now = () => new Date()
}) {
	const kid = await slotIdFor(rawCredentialId);
	const records = loadVaultRecords(storage);
	let record = records.find(
		(r) => r.vault.slots.some((/** @type {any} */ s) => s.kid === kid) && !r.aside?.includes(kid)
	);
	if (!record && records.some((r) => r.removed.includes(kid))) throw new RemovedPasskeyError();
	let found = false;
	let switched = false;
	if (!record && find) {
		const elsewhere = await find(kid);
		if (
			isVaultRecord(elsewhere) &&
			elsewhere.vault.slots.some((/** @type {any} */ s) => s.kid === kid)
		) {
			record = elsewhere;
			found = true;
		}
	} else if (record && find && other) {
		// Asked for: the record here still opens the books when this fails.
		try {
			const opened = await openRecord(record, { prfOutput, rawCredentialId });
			const there = await otherBooks(
				{ ...opened, record, kid },
				await find(kid),
				{ prfOutput, rawCredentialId },
				records
			);
			if (there) {
				// One write: the other vault kept, and the one here set aside.
				const here = record;
				storage.setItem(
					VAULTS_STORAGE_KEY,
					JSON.stringify([
						...records.map((r) => (r === here ? { ...r, aside: [...(r.aside ?? []), kid] } : r)),
						there
					])
				);
				record = there;
				found = true;
				switched = true;
			}
		} catch (e) {
			console.warn('other books of this passkey:', e);
		}
	}
	const slotKey = await slotKeyOf(prfOutput);
	if (record) {
		const { payload, vaultKey } = await openVault(record.vault, { slotKey, rawCredentialId });
		// Kept here only once it opened with this passkey – with its own name and id.
		if (found) {
			record = {
				...record,
				slots: [
					...record.slots.filter((s) => s.kid !== kid),
					{
						kid,
						label,
						credentialId,
						addedAt: record.slots.find((s) => s.kid === kid)?.addedAt ?? now().toISOString()
					}
				]
			};
			saveVaultRecord(storage, record);
		}
		return {
			record,
			vaultKey,
			...decodeRoots(payload),
			kid,
			created: false,
			found,
			...(switched ? { switched } : {})
		};
	}
	await confirmNew?.();
	const root = Uint8Array.from(prfOutput);
	const { vault, vaultKey } = await createVault(encodePayload(root), { slotKey, rawCredentialId });
	record = {
		vault,
		slots: [{ kid, label, credentialId, addedAt: now().toISOString() }],
		removed: []
	};
	saveVaultRecord(storage, record);
	return { record, vaultKey, root, kid, created: true };
}

/**
 * A vault record from outside (the index): the shape this file reads, before
 * anything is done with it. What it seals is checked by opening it.
 *
 * @param {unknown} record
 * @returns {record is VaultRecord}
 */
function isVaultRecord(record) {
	const r = /** @type {any} */ (record);
	return Boolean(
		r &&
			typeof r === 'object' &&
			r.vault &&
			typeof r.vault === 'object' &&
			typeof r.vault.id === 'string' &&
			r.vault.id &&
			Array.isArray(r.vault.slots) &&
			r.vault.slots.every((/** @type {any} */ s) => s && typeof s.kid === 'string') &&
			Array.isArray(r.slots)
	);
}

/**
 * @param {VaultRecord} record
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} passkey
 */
async function openRecord(record, passkey) {
	const { payload } = await openVault(record.vault, {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	return decodeRoots(payload);
}

/**
 * Whether `candidate` – what the index of this passkey names – is a vault of
 * other books than the ones open (#524): a device that founded books of its
 * own never learns otherwise that its passkey has a slot in a vault made
 * elsewhere. Other books means: another vault, with a slot this passkey
 * opens, whose root is neither the open one nor one before or after it (the
 * same books under new keys move by `adoptSuccessorVault`), and that this
 * browser does not keep already. Nothing is written.
 *
 * @param {Pick<OpenedVault, 'record' | 'root' | 'previous' | 'kid'>} opened
 * @param {unknown} candidate from outside: checked here
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} passkey this one
 * @param {VaultRecord[]} [kept] the records this browser keeps
 * @returns {Promise<VaultRecord | null>} the record to take, or null
 */
export async function otherBooks(opened, candidate, passkey, kept = []) {
	if (!isVaultRecord(candidate)) return null;
	if (candidate.vault.id === opened.record.vault.id) return null;
	if (kept.some((r) => r.vault.id === candidate.vault.id)) return null;
	if (!candidate.vault.slots.some((/** @type {any} */ s) => s.kid === opened.kid)) return null;
	/** @type {{ root: Uint8Array, previous: Uint8Array[] }} */
	let there;
	try {
		there = await openRecord(candidate, passkey);
	} catch {
		// Not a vault this passkey opens, whatever it says.
		return null;
	}
	const mine = [opened.root, ...(opened.previous ?? [])];
	if ([there.root, ...there.previous].some((r) => mine.some((m) => sameBytes(r, m)))) return null;
	return { vault: candidate.vault, slots: candidate.slots, removed: [] };
}

/**
 * Give one more passkey a slot, while the vault is open.
 *
 * @param {OpenedVault} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array, credentialId: string, label: string }} passkey
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {() => Date} [now]
 * @returns {Promise<OpenedVault>}
 */
export async function addPasskey(opened, passkey, storage, now = () => new Date()) {
	const kid = await slotIdFor(passkey.rawCredentialId);
	const vault = await addVaultSlot(opened.record.vault, opened.vaultKey, {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	const record = {
		vault,
		slots: [
			...opened.record.slots,
			{
				kid,
				label: passkey.label,
				credentialId: passkey.credentialId,
				addedAt: now().toISOString()
			}
		],
		removed: opened.record.removed.filter((k) => k !== kid),
		...asideOf(withoutRemovedAt(opened.record, [kid]))
	};
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/**
 * @param {VaultRecord} record
 * @param {string[]} kids no longer removed
 * @returns {VaultRecord}
 */
function withoutRemovedAt(record, kids) {
	if (!record.removedAt) return record;
	const removedAt = { ...record.removedAt };
	for (const kid of kids) delete removedAt[kid];
	return { ...record, removedAt };
}

/**
 * @param {VaultRecord} record
 * @param {string[]} kids taken out now
 * @param {() => Date} now
 * @returns {VaultRecord}
 */
const withRemovedAt = (record, kids, now) => ({
	...record,
	removedAt: {
		...(record.removedAt ?? {}),
		...Object.fromEntries(kids.map((kid) => [kid, now().toISOString()]))
	}
});

/**
 * Take a passkey's slot out, without renewing the vault key: it opens
 * nothing from this record on, but it has seen the root (see above).
 *
 * @param {OpenedVault} opened
 * @param {string} kid
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {OpenedVault}
 */
export function removePasskey(opened, kid, storage, now = () => new Date()) {
	if (kid === opened.kid)
		throw new Error('The passkey that opened the books cannot remove itself.');
	if (!opened.record.vault.slots.some((/** @type {any} */ s) => s.kid === kid)) {
		throw new Error('This passkey has no slot in these books.');
	}
	const record = {
		vault: {
			...opened.record.vault,
			slots: opened.record.vault.slots.filter((/** @type {any} */ s) => s.kid !== kid)
		},
		slots: opened.record.slots.filter((s) => s.kid !== kid),
		removed: [...new Set([...opened.record.removed, kid])],
		...asideOf(withRemovedAt(opened.record, [kid], now))
	};
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/**
 * Renew the vault: a new vault key and a new vault, with a slot for every
 * passkey that stays – each one answers once (`answers`) – and the same root.
 * For a passkey that may be in other hands. The old record is replaced here;
 * copies elsewhere (older backups) still carry the old slots.
 *
 * @param {OpenedVault} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} answers every passkey that stays
 * @param {string[]} removed the slot ids taken out
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} storage
 * @returns {Promise<OpenedVault>}
 */
export async function renewBooksVault(opened, answers, removed, storage) {
	if (!answers.length) throw new Error('At least one passkey has to stay.');
	const kids = await Promise.all(answers.map((a) => slotIdFor(a.rawCredentialId)));
	if (!kids.includes(opened.kid)) throw new Error('The passkey that opened the books has to stay.');
	const [first, ...rest] = answers;
	let { vault, vaultKey } = await createVault(encodePayload(opened.root, opened.previous), {
		slotKey: await slotKeyOf(first.prfOutput),
		rawCredentialId: first.rawCredentialId
	});
	for (const a of rest) {
		vault = await addVaultSlot(vault, vaultKey, {
			slotKey: await slotKeyOf(a.prfOutput),
			rawCredentialId: a.rawCredentialId
		});
	}
	const record = {
		vault,
		slots: opened.record.slots.filter((s) => kids.includes(s.kid)),
		removed: [...new Set([...opened.record.removed, ...removed])],
		...asideOf(opened.record),
		replaces: [...new Set([...(opened.record.replaces ?? []), String(opened.record.vault.id)])]
	};
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id);
	records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
	return { ...opened, record, vaultKey };
}

/**
 * Take a newer record of the same books – the current one from index M – in
 * place of the one opened: only if this passkey's slot opens it and gives the
 * same root. A record without this passkey's slot means it was removed there:
 * refused, and remembered here.
 *
 * @param {OpenedVault} opened
 * @param {any} vault the newer vault record
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} passkey this one
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {SlotInfo[]} [published] slot details published with it (no names)
 * @returns {Promise<OpenedVault>}
 */
export async function adoptNewerVault(opened, vault, passkey, storage, published = []) {
	// The same record (a slot added keeps the vault's id, so the whole record is compared).
	if (!vault || !Array.isArray(vault.slots)) return opened;
	if (JSON.stringify(vault) === JSON.stringify(opened.record.vault)) return opened;
	if (!vault.slots.some((/** @type {any} */ s) => s.kid === opened.kid)) {
		// Another vault (#555): not proof that this passkey was taken out – the
		// two may be two devices' vaults of the same books. Refused all the same,
		// and the record found elsewhere goes again, so a later unlock asks anew.
		if (vault.id !== opened.record.vault.id) {
			if (opened.found) {
				storage.setItem(
					VAULTS_STORAGE_KEY,
					JSON.stringify(
						loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id)
					)
				);
			}
			throw new NotInPublishedVaultError();
		}
		const record = {
			...opened.record,
			removed: [...new Set([...opened.record.removed, opened.kid])]
		};
		record.vault = {
			...opened.record.vault,
			slots: opened.record.vault.slots.filter((/** @type {any} */ s) => s.kid !== opened.kid)
		};
		saveVaultRecord(storage, record);
		throw new RemovedPasskeyError();
	}
	const { payload, vaultKey } = await openVault(vault, {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	const root = decodePayload(payload);
	if (root.length !== opened.root.length || root.some((b, i) => b !== opened.root[i])) {
		throw new VaultStorageError('The newer vault holds other books.');
	}
	const kids = new Set(vault.slots.map((/** @type {any} */ s) => s.kid));
	const here = opened.record.slots.filter((s) => kids.has(s.kid));
	const record = {
		vault,
		slots: [
			...here,
			...published.filter((s) => kids.has(s.kid) && !here.some((h) => h.kid === s.kid))
		],
		removed: opened.record.removed,
		...asideOf(opened.record)
	};
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id);
	records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
	return { ...opened, record, vaultKey };
}

/**
 * Before this browser publishes its vault (#555): the vault the books keep on
 * Aleph (index M), when it is another one. Two devices of the same books may
 * each have made a vault – one set up before the vault was published, or
 * while the network was paused – and the one published last would lock out
 * the passkeys only the other has. So the published one is taken, when this
 * passkey's slot opens it and it holds the same root: with what this browser
 * knows of its slots. The record here stays, set aside for every passkey the
 * published vault has, so a passkey only this record has still opens the
 * same books here (`lost`); it is added again to be in the published vault.
 *
 * @param {OpenedVault} opened
 * @param {{ vault: any, slots?: SlotInfo[] } | null} published index M, as read
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} passkey this one
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {Promise<{ opened: OpenedVault, lost: SlotInfo[] }>} `lost`: the
 *   passkeys of the record here the published vault lacks
 * @throws {PublishedVaultLacksPasskeyError} it has no slot for this passkey
 * @throws {VaultStorageError} it holds other books
 */
export async function convergeOnPublished(opened, published, passkey, storage) {
	const vault = published?.vault;
	if (!vault || !Array.isArray(vault.slots) || typeof vault.id !== 'string') {
		return { opened, lost: [] };
	}
	if (vault.id === opened.record.vault.id) return { opened, lost: [] };
	// This record's own vault before it was renewed here: replaced by publishing.
	if (opened.record.replaces?.includes(vault.id)) return { opened, lost: [] };
	if (!vault.slots.some((/** @type {any} */ s) => s.kid === opened.kid)) {
		throw new PublishedVaultLacksPasskeyError();
	}
	const { payload, vaultKey } = await openVault(vault, {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	const { root, previous } = decodeRoots(payload);
	if (!sameBytes(root, opened.root))
		throw new VaultStorageError('The newer vault holds other books.');
	const kids = new Set(vault.slots.map((/** @type {any} */ s) => String(s.kid)));
	const here = opened.record.slots.filter((s) => kids.has(s.kid));
	const record = {
		vault,
		slots: [
			...here,
			...(published?.slots ?? []).filter(
				(s) => kids.has(s.kid) && !here.some((h) => h.kid === s.kid)
			)
		],
		removed: opened.record.removed
	};
	const lost = opened.record.slots.filter((s) => !kids.has(s.kid));
	const old = opened.record.vault.id;
	const records = loadVaultRecords(storage);
	const kept = records
		.filter((r) => r.vault.id !== vault.id)
		.map((r) =>
			r.vault.id === old
				? {
						...r,
						aside: [
							...new Set([
								...(r.aside ?? []),
								...r.vault.slots
									.map((/** @type {any} */ s) => String(s.kid))
									.filter((/** @type {string} */ k) => kids.has(k))
							])
						]
					}
				: r
		);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify([...kept, record]));
	return { opened: { ...opened, record, vaultKey, root, previous }, lost };
}

/** The id of the words' slot. */
export const wordsSlotId = () => slotIdFor(WORDS_SLOT_ID);

/** Whether the vault has recovery words. @param {VaultRecord} record */
export async function hasRecoveryWords(record) {
	const kid = await wordsSlotId();
	return record.vault.slots.some((/** @type {any} */ s) => s.kid === kid);
}

/** @param {Uint8Array} seed the words' BIP39 seed */
const wordsSlotKey = (seed) => deriveAesKey(seed, WORDS_SLOT_INFO);

/**
 * Give the vault recovery words, while it is open: one more slot, sealed
 * under a key from their seed. Words the vault had are replaced.
 *
 * @param {OpenedVault} opened
 * @param {Uint8Array} seed from `seedFromWords`
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {() => Date} [now]
 * @returns {Promise<OpenedVault>}
 */
export async function addRecoveryWords(opened, seed, storage, now = () => new Date()) {
	const kid = await wordsSlotId();
	const without = withoutSlot(opened.record, kid);
	const vault = await addVaultSlot(without.vault, opened.vaultKey, {
		slotKey: await wordsSlotKey(seed),
		rawCredentialId: WORDS_SLOT_ID
	});
	const record = {
		vault,
		slots: [
			...without.slots,
			{
				kid,
				label: '',
				credentialId: '',
				addedAt: now().toISOString(),
				kind: /** @type {const} */ ('words')
			}
		],
		removed: opened.record.removed,
		...asideOf(withoutRemovedAt(opened.record, [kid]))
	};
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/**
 * Take the recovery words out: they open nothing from this record on (but
 * whoever has them has seen the root, as with a passkey).
 *
 * @param {OpenedVault} opened
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {Promise<OpenedVault>}
 */
export async function removeRecoveryWords(opened, storage, now = () => new Date()) {
	const kid = await wordsSlotId();
	const record = withoutSlot(withRemovedAt(opened.record, [kid], now), kid);
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/** @param {VaultRecord} record @param {string} kid @returns {VaultRecord} */
const withoutSlot = (record, kid) => ({
	vault: {
		...record.vault,
		slots: record.vault.slots.filter((/** @type {any} */ s) => s.kid !== kid)
	},
	slots: record.slots.filter((s) => s.kid !== kid),
	removed: record.removed,
	...asideOf(record)
});

/**
 * Open the vault with recovery words, without any passkey: a record this
 * browser keeps with a words slot, else one found elsewhere (the Aleph index
 * of the words, on an empty device). Every vault files its words slot under
 * the same id, so each record here with one is tried in turn (#555): with two
 * sets of books in this browser, the words of the second are not taken for
 * wrong ones by the first. Nothing is kept here until a passkey has its slot
 * (`addPasskey`), so the next unlock is a passkey's as always.
 *
 * @param {object} params
 * @param {Uint8Array} params.seed from `seedFromWords`
 * @param {Pick<Storage, 'getItem'>} params.storage
 * @param {() => Promise<VaultRecord | null>} [params.find] where else to look
 * @returns {Promise<OpenedVault | null>} null: no vault with these words
 * @throws an error with `code: 'VAULT_LOCKED'` when vaults with words were
 *   found but these words open none of them
 */
export async function openWithWords({ seed, storage, find }) {
	const kid = await wordsSlotId();
	const has = (/** @type {VaultRecord | null | undefined} */ r) =>
		Boolean(r?.vault?.slots?.some((/** @type {any} */ s) => s.kid === kid));
	const slotKey = await wordsSlotKey(seed);
	/** @type {unknown} the first refusal, said when nothing else opens */
	let locked = null;
	/** @param {VaultRecord} record @param {boolean} found */
	const attempt = async (record, found) => {
		try {
			const { payload, vaultKey } = await openVault(record.vault, {
				slotKey,
				rawCredentialId: WORDS_SLOT_ID
			});
			return { record, vaultKey, ...decodeRoots(payload), kid, created: false, found };
		} catch (e) {
			if (/** @type {any} */ (e)?.code !== 'VAULT_LOCKED') throw e;
			locked ??= e;
			return null;
		}
	};
	for (const record of loadVaultRecords(storage).filter(has)) {
		const opened = await attempt(record, false);
		if (opened) return opened;
	}
	if (find) {
		const elsewhere = await find();
		if (has(elsewhere)) {
			const opened = await attempt(/** @type {VaultRecord} */ (elsewhere), true);
			if (opened) return opened;
		}
	}
	if (locked) throw locked;
	return null;
}

/**
 * The same books' newer record (index M), opened with the words: taken when
 * the words still have their slot there and it gives the same root. A record
 * without the words' slot means they were taken out or replaced there; the
 * index under the words' own seed cannot be cleared (the seed is never kept),
 * so this is where removed words are refused, as a removed passkey is in
 * `adoptNewerVault`.
 *
 * @param {OpenedVault} opened by `openWithWords`
 * @param {any} vault the newer vault record
 * @param {Uint8Array} seed
 * @param {SlotInfo[]} [published] slot details published with it
 * @returns {Promise<OpenedVault>}
 */
export async function newerWithWords(opened, vault, seed, published = []) {
	if (!vault || !Array.isArray(vault.slots)) return opened;
	if (!vault.slots.some((/** @type {any} */ s) => s.kid === opened.kid)) {
		throw new RemovedWordsError();
	}
	// A words slot that these words do not open: newer words took their place.
	const { payload, vaultKey } = await openVault(vault, {
		slotKey: await wordsSlotKey(seed),
		rawCredentialId: WORDS_SLOT_ID
	}).catch((/** @type {any} */ e) => {
		if (e?.code === 'VAULT_LOCKED') throw new RemovedWordsError();
		throw e;
	});
	const root = decodePayload(payload);
	if (root.length !== opened.root.length || root.some((b, i) => b !== opened.root[i])) {
		throw new VaultStorageError('The newer vault holds other books.');
	}
	// Merged as in `adoptNewerVault` (#555): what this browser knows of the
	// slots – names, credential ids – and the passkeys it removed stay; only
	// the slots new there are added.
	const kids = new Set(vault.slots.map((/** @type {any} */ s) => s.kid));
	const here = (opened.record.slots ?? []).filter((s) => kids.has(s.kid));
	return {
		...opened,
		record: {
			vault,
			slots: [
				...here,
				...published.filter((s) => kids.has(s.kid) && !here.some((h) => h.kid === s.kid))
			],
			removed: Array.isArray(opened.record.removed) ? opened.record.removed : [],
			...asideOf(opened.record)
		},
		vaultKey
	};
}

/**
 * New keys for the books (#627): a new random root, sealed in a new vault with
 * the roots before it (so backups made then still open), and a slot for every
 * passkey that answered. The recovery words are not carried over; the old
 * record goes from this browser. What the books hold moves separately
 * (move/rekey.js).
 *
 * @param {OpenedVault} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} answers every passkey that stays
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {Promise<OpenedVault>}
 */
export async function rekeyBooksVault(opened, answers, storage) {
	const next = await newBooksVault(opened, answers);
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id);
	records.push(next.record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
	return next;
}

/**
 * The new vault of `rekeyBooksVault`, made but not kept: the device that
 * makes it takes it as its successor like every other (move/rekey.js).
 *
 * @param {OpenedVault} opened
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} answers every passkey that stays
 * @param {Uint8Array} [root] the new root; random when not given
 * @returns {Promise<OpenedVault>}
 */
export async function newBooksVault(
	opened,
	answers,
	root = crypto.getRandomValues(new Uint8Array(ROOT_BYTES))
) {
	if (!answers.length) throw new Error('At least one passkey has to stay.');
	const kids = await Promise.all(answers.map((a) => slotIdFor(a.rawCredentialId)));
	if (!kids.includes(opened.kid)) throw new Error('The passkey that opened the books has to stay.');
	const previous = [opened.root, ...(opened.previous ?? [])];
	const [first, ...rest] = answers;
	let { vault, vaultKey } = await createVault(encodePayload(root, previous), {
		slotKey: await slotKeyOf(first.prfOutput),
		rawCredentialId: first.rawCredentialId
	});
	for (const a of rest) {
		vault = await addVaultSlot(vault, vaultKey, {
			slotKey: await slotKeyOf(a.prfOutput),
			rawCredentialId: a.rawCredentialId
		});
	}
	// A passkey that did not answer is told so here, rather than given books of its own.
	const left = opened.record.vault.slots
		.map((/** @type {any} */ s) => String(s.kid))
		.filter((/** @type {string} */ kid) => !kids.includes(kid));
	const record = {
		vault,
		slots: opened.record.slots.filter((s) => kids.includes(s.kid)),
		removed: [...new Set([...opened.record.removed, ...left])],
		...asideOf(opened.record)
	};
	return { ...opened, record, vaultKey, root, previous, created: false, found: false };
}

/**
 * The books' successor, as another device of the owner finds it in the old
 * books (#627): the new vault, taken when this passkey's slot opens it and
 * its roots before name the root opened here. The old record goes from this
 * browser; the device opens the new books at the next unlock.
 *
 * @param {OpenedVault} opened
 * @param {any} vault the new vault record
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }} passkey this one
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {string[]} [removed] the passkeys that did not answer there
 * @returns {Promise<OpenedVault>}
 */
export async function adoptSuccessorVault(opened, vault, passkey, storage, removed = []) {
	if (!vault || !Array.isArray(vault.slots)) throw new VaultStorageError('No new vault.');
	if (!vault.slots.some((/** @type {any} */ s) => s.kid === opened.kid)) {
		throw new RemovedPasskeyError();
	}
	const { payload, vaultKey } = await openVault(vault, {
		slotKey: await slotKeyOf(passkey.prfOutput),
		rawCredentialId: passkey.rawCredentialId
	});
	const { root, previous } = decodeRoots(payload);
	const same = (/** @type {Uint8Array} */ a) =>
		a.length === opened.root.length && a.every((b, i) => b === opened.root[i]);
	if (!previous.some(same)) throw new VaultStorageError('The new vault holds other books.');
	const kids = new Set(vault.slots.map((/** @type {any} */ s) => s.kid));
	const record = {
		vault,
		slots: opened.record.slots.filter((s) => kids.has(s.kid)),
		removed: removed.map(String),
		...asideOf(opened.record)
	};
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id);
	records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
	return { ...opened, record, vaultKey, root, previous, created: false, found: false };
}

/**
 * Keep `record` in place of the record with `oldId` (#627: the new vault, on
 * the device that made it).
 *
 * @param {string} oldId
 * @param {VaultRecord} record
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 */
export function replaceVaultRecord(oldId, record, storage) {
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== oldId);
	records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
}

/**
 * The same JSON, whatever the order of the keys (#962): a record read back
 * from the sealed settings has its keys in the codec's order, not in the
 * order they were written, and is the same record all the same.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export const sameJson = (a, b) => canonicalJson(a) === canonicalJson(b);

/** @param {unknown} value */
export function canonicalJson(value) {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]])
				)
			: v
	);
}

/**
 * The record as the books keep it for every own device (#962): what is
 * public about the vault, without what only this browser decides (`aside`).
 *
 * @param {VaultRecord} record
 * @returns {{ vault: any, slots: SlotInfo[], removed: string[], removedAt?: Record<string, string>, replaces?: string[] }}
 */
export const sharedRecordOf = (record) => ({
	vault: record.vault,
	slots: record.slots,
	removed: record.removed,
	...(record.removedAt && Object.keys(record.removedAt).length
		? { removedAt: record.removedAt }
		: {}),
	...(record.replaces?.length ? { replaces: record.replaces } : {})
});

/**
 * Two records of the same vault (same id, same payload), merged (#962): what
 * each device added, what each took out. A slot is in the result when either
 * has it and it was not taken out after it was added; for a slot both have
 * (the recovery words, made anew), the later one counts. Slots are sealed
 * each on its own, bound to the vault's id and their slot id, so slots from
 * two copies of one vault go together. Pure: nothing is kept.
 *
 * @param {VaultRecord} local
 * @param {{ vault: any, slots?: SlotInfo[], removed?: string[], removedAt?: Record<string, string> }} incoming
 * @returns {VaultRecord} `local` itself when nothing changes
 */
export function mergeVaultRecords(local, incoming) {
	const vault = incoming?.vault;
	if (!vault || vault.id !== local.vault.id || !Array.isArray(vault.slots)) return local;
	if (!sameJson(vault.payload, local.vault.payload)) return local;
	const theirs = new Map(
		(Array.isArray(incoming.slots) ? incoming.slots : []).map((s) => [String(s.kid), s])
	);
	const mine = new Map(local.slots.map((s) => [s.kid, s]));
	/** @type {Record<string, string>} */
	const removedAt = { ...removedAtOf(incoming.removedAt) };
	for (const [kid, at] of Object.entries(local.removedAt ?? {})) {
		if (!removedAt[kid] || at > removedAt[kid]) removedAt[kid] = at;
	}
	const removedSet = new Set([
		...local.removed,
		...(Array.isArray(incoming.removed) ? incoming.removed.map(String) : [])
	]);
	/** @param {string} kid */
	const addedAt = (kid) => {
		const a = mine.get(kid)?.addedAt ?? '';
		const b = theirs.get(kid)?.addedAt ?? '';
		return a > b ? a : b;
	};
	/** @param {string} kid */
	const gone = (kid) => {
		const at = removedAt[kid];
		if (at) return !(addedAt(kid) > at);
		// Taken out before removal times were kept: it stays out.
		return removedSet.has(kid);
	};
	/** @type {Map<string, any>} */
	const slots = new Map();
	for (const s of local.vault.slots) slots.set(String(s.kid), s);
	for (const s of vault.slots) {
		const kid = String(s.kid);
		const here = slots.get(kid);
		const later = (theirs.get(kid)?.addedAt ?? '') > (mine.get(kid)?.addedAt ?? '');
		if (!here || (later && !sameJson(here, s))) slots.set(kid, s);
	}
	const kept = [...slots.values()].filter((s) => !gone(String(s.kid)));
	const kids = new Set(kept.map((s) => String(s.kid)));
	/** @type {SlotInfo[]} */
	const info = [];
	for (const kid of kids) {
		const a = mine.get(kid);
		const b = theirs.get(kid);
		const newer = b && (!a || (b.addedAt ?? '') > (a.addedAt ?? '')) ? b : a;
		if (!newer) continue;
		info.push({ ...newer, label: a?.label || b?.label || '' });
	}
	const removed = [...new Set([...removedSet, ...Object.keys(removedAt)])].filter(
		(kid) => gone(kid) && !kids.has(kid) && removedSet.has(kid)
	);
	/** @type {VaultRecord} */
	const merged = {
		vault: { ...local.vault, slots: kept },
		slots: info,
		removed,
		...(Object.keys(removedAt).length ? { removedAt } : {}),
		...(local.aside?.length ? { aside: local.aside } : {}),
		...(local.replaces?.length ? { replaces: local.replaces } : {})
	};
	return sameJson(merged, local) ? local : merged;
}

/**
 * A record of the same vault that came by sync, merged into the open one and
 * kept here (#962). Another vault (renewed, new keys) is not taken here: that
 * wants this passkey's answer, at the next unlock (`adoptNewerVault`).
 *
 * @param {OpenedVault} opened
 * @param {Parameters<typeof mergeVaultRecords>[1] | null} incoming
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {OpenedVault} `opened` itself when nothing changes
 */
export function adoptSyncedVault(opened, incoming, storage) {
	if (!incoming) return opened;
	const record = mergeVaultRecords(opened.record, incoming);
	if (record === opened.record) return opened;
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/**
 * The vault another own device handed over (#962, sync/vault-handover.js):
 * this passkey gets its slot in it, with the vault key that came along, and
 * the record is kept here – from now on this passkey opens the books here like
 * any other. Checked before it is kept: the new slot opens the vault, and the
 * vault holds a root.
 *
 * @param {{ record: any, vaultKey: Uint8Array }} handed
 * @param {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array, credentialId: string, label: string }} passkey
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {() => Date} [now]
 * @returns {Promise<VaultRecord>}
 */
export async function joinWithVault(handed, passkey, storage, now = () => new Date()) {
	const given = handed.record;
	if (!given?.vault || !Array.isArray(given.vault.slots)) {
		throw new VaultStorageError('That is no vault.');
	}
	const kid = await slotIdFor(passkey.rawCredentialId);
	const slotKey = await slotKeyOf(passkey.prfOutput);
	const vault = given.vault.slots.some((/** @type {any} */ s) => s.kid === kid)
		? given.vault
		: await addVaultSlot(given.vault, handed.vaultKey, {
				slotKey,
				rawCredentialId: passkey.rawCredentialId
			});
	const { payload } = await openVault(vault, { slotKey, rawCredentialId: passkey.rawCredentialId });
	decodeRoots(payload);
	/** @type {VaultRecord} */
	const record = {
		vault,
		slots: [
			...(Array.isArray(given.slots) ? given.slots : []).filter(
				(/** @type {any} */ s) => s?.kid !== kid
			),
			{
				kid,
				label: passkey.label,
				credentialId: passkey.credentialId,
				addedAt: now().toISOString()
			}
		],
		removed: (Array.isArray(given.removed) ? given.removed.map(String) : []).filter(
			(/** @type {string} */ k) => k !== kid
		),
		...(given.removedAt && typeof given.removedAt === 'object'
			? {
					removedAt: Object.fromEntries(
						Object.entries(removedAtOf(given.removedAt)).filter(([k]) => k !== kid)
					)
				}
			: {}),
		...(Array.isArray(given.replaces) && given.replaces.length
			? { replaces: given.replaces.map(String) }
			: {})
	};
	saveVaultRecord(storage, record);
	return record;
}

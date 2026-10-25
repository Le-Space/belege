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

/** Where the vault records are kept: a JSON array, one record per set of books. */
export const VAULTS_STORAGE_KEY = 'belege.vaults.v1';

const PAYLOAD_VERSION = 1;
const ROOT_BYTES = 32;

/**
 * @typedef {{ kid: string, label: string, credentialId: string, addedAt: string }} SlotInfo
 *   what this browser says about a slot, beside the sealed vault: public
 * @typedef {{ vault: any, slots: SlotInfo[], removed: string[] }} VaultRecord
 * @typedef {{ record: VaultRecord, vaultKey: Uint8Array, root: Uint8Array, kid: string, created: boolean, found?: boolean }} OpenedVault
 *   `found`: the record came from elsewhere (the index), not this browser
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

/** The payload: the root, as bytes. @param {Uint8Array} root */
const encodePayload = (root) =>
	new TextEncoder().encode(JSON.stringify({ version: PAYLOAD_VERSION, root: toHex(root) }));

/** @param {Uint8Array} bytes @returns {Uint8Array} the root */
function decodePayload(bytes) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new VaultStorageError('The vault opened, but what it holds is not readable.');
	}
	if (parsed?.version !== PAYLOAD_VERSION) {
		throw new VaultStorageError('The vault holds a version this page does not know.');
	}
	return fromHex(parsed.root, ROOT_BYTES);
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
			removed: Array.isArray(r.removed) ? r.removed.map(String) : []
		};
	});
}

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
 *
 * @param {object} params
 * @param {Uint8Array} params.prfOutput
 * @param {Uint8Array} params.rawCredentialId
 * @param {string} params.credentialId base64url, kept beside the slot
 * @param {string} [params.label] the passkey's name
 * @param {Pick<Storage, 'getItem' | 'setItem'>} params.storage
 * @param {(kid: string) => Promise<VaultRecord | null>} [params.find] where else to look
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
	now = () => new Date()
}) {
	const kid = await slotIdFor(rawCredentialId);
	const records = loadVaultRecords(storage);
	let record = records.find((r) => r.vault.slots.some((/** @type {any} */ s) => s.kid === kid));
	if (!record && records.some((r) => r.removed.includes(kid))) throw new RemovedPasskeyError();
	let found = false;
	if (!record && find) {
		const elsewhere = await find(kid);
		if (elsewhere && elsewhere.vault.slots.some((/** @type {any} */ s) => s.kid === kid)) {
			record = elsewhere;
			found = true;
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
		return { record, vaultKey, root: decodePayload(payload), kid, created: false, found };
	}
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
		removed: opened.record.removed.filter((k) => k !== kid)
	};
	saveVaultRecord(storage, record);
	return { ...opened, record };
}

/**
 * Take a passkey's slot out, without renewing the vault key: it opens
 * nothing from this record on, but it has seen the root (see above).
 *
 * @param {OpenedVault} opened
 * @param {string} kid
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @returns {OpenedVault}
 */
export function removePasskey(opened, kid, storage) {
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
		removed: [...new Set([...opened.record.removed, kid])]
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
	let { vault, vaultKey } = await createVault(encodePayload(opened.root), {
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
		removed: [...new Set([...opened.record.removed, ...removed])]
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
		removed: opened.record.removed
	};
	const records = loadVaultRecords(storage).filter((r) => r.vault.id !== opened.record.vault.id);
	records.push(record);
	storage.setItem(VAULTS_STORAGE_KEY, JSON.stringify(records));
	return { ...opened, record, vaultKey };
}

// The books' vault for every own device (#962): its record is kept in the
// sealed settings as well, written by the books themselves, and every device
// of the owner merges it into its own (books-vault.js `mergeVaultRecords`).
// So a passkey added on one device opens the books on the others after the
// next sync, and one taken out is refused there – without Aleph. The record
// holds nothing secret in the clear: the vault is sealed, and only a passkey
// with a slot opens it. Read as the books wrote it, never a member's entry
// (as `books/successor`, move/rekey.js).

import { getSetting, setSetting } from '../store/settings.js';
import { canonicalJson, sameJson, sharedRecordOf } from '../books-vault.js';

export const VAULT_RECORD_SETTING = 'books/vault';

/** @param {unknown} value */
const isRecord = (value) =>
	Boolean(value && typeof value === 'object' && /** @type {any} */ (value).vault);

/**
 * Every record the books wrote, oldest or newest alike: two devices may write
 * before either has the other's, and the log's order says nothing about which
 * knows more. Merging is the same in any order (books-vault.js
 * `mergeVaultRecords`), so all are taken. Never a member's entry.
 *
 * @param {any} settingsDb the settings database (`store.databases().settings`)
 * @param {string} booksId the books' identity
 * @returns {Promise<any[]>}
 */
export async function readSharedVaults(settingsDb, booksId) {
	/** @type {Map<string, any>} */
	const found = new Map();
	for await (const entry of settingsDb.log.iterator()) {
		const value = await sharedVaultOf(settingsDb, entry, booksId);
		if (value) found.set(canonicalJson(value), value);
	}
	return [...found.values()];
}

/**
 * The record in one entry of the settings, when the books wrote it; else null.
 *
 * @param {any} settingsDb
 * @param {any} entry a log entry, as read or as it came by sync
 * @param {string} booksId
 */
export async function sharedVaultOf(settingsDb, entry, booksId) {
	const record = entry?.payload?.value;
	if (entry?.payload?.op !== 'PUT' || record?.key !== VAULT_RECORD_SETTING) return null;
	if (record.deleted || !isRecord(record.value)) return null;
	if ((await settingsDb.access.writerOf(entry)) !== booksId) return null;
	return record.value;
}

/**
 * Keep this device's record for the others, when it says something the
 * settings do not.
 *
 * Every record the books wrote is read (`readSharedVaults`), not only the
 * newest. So a record already in the log is not written again because
 * another device wrote after it. Two devices with two vaults of the same
 * books cannot merge (`mergeVaultRecords` takes one vault only). Compared
 * with the newest record alone, each found the other's there and wrote its
 * own back, again and again, a few times a second.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {import('../books-vault.js').VaultRecord} record
 * @param {{ settingsDb?: any, booksId?: string }} [log] the settings database and the
 *   books' identity, to look through every record the books wrote
 * @returns {Promise<boolean>} whether it was written
 */
export async function shareVault(settings, record, { settingsDb, booksId } = {}) {
	const value = sharedRecordOf(record);
	const kept = await getSetting(settings, VAULT_RECORD_SETTING);
	// Read back from the sealed settings, its keys come in the codec's order.
	if (sameJson(kept, value)) return false;
	if (settingsDb && booksId) {
		const written = await readSharedVaults(settingsDb, booksId);
		if (written.some((v) => sameJson(v, value))) return false;
	}
	await setSetting(settings, VAULT_RECORD_SETTING, value);
	return true;
}

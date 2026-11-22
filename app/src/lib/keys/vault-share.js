// The books' vault for every own device (#962): its record is kept in the
// sealed settings as well, written by the books themselves, and every device
// of the owner merges it into its own (books-vault.js `mergeVaultRecords`).
// So a passkey added on one device opens the books on the others after the
// next sync, and one taken out is refused there – without Aleph. The record
// holds nothing secret in the clear: the vault is sealed, and only a passkey
// with a slot opens it. Read as the books wrote it, never a member's entry
// (as `books/successor`, move/rekey.js).

import { getSetting, setSetting } from '../store/settings.js';
import { successorWrittenBy } from '../move/rekey.js';
import { sharedRecordOf } from '../books-vault.js';

export const VAULT_RECORD_SETTING = 'books/vault';

/**
 * The record the books keep, as the books wrote it; null when there is none.
 *
 * @param {any} settingsDb the settings database (`store.databases().settings`)
 * @param {string} booksId the books' identity
 */
export async function readSharedVault(settingsDb, booksId) {
	const value = await successorWrittenBy(settingsDb, VAULT_RECORD_SETTING, booksId);
	return value && typeof value === 'object' && value.vault ? value : null;
}

/**
 * Keep this device's record for the others, when it says something the
 * settings do not.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {import('../books-vault.js').VaultRecord} record
 * @returns {Promise<boolean>} whether it was written
 */
export async function shareVault(settings, record) {
	const value = sharedRecordOf(record);
	const kept = await getSetting(settings, VAULT_RECORD_SETTING);
	if (JSON.stringify(kept) === JSON.stringify(value)) return false;
	await setSetting(settings, VAULT_RECORD_SETTING, value);
	return true;
}

// The backups made so far (issue #77), in the sealed settings (key `backups`):
// when, where, how large, the CID to get it back by, and what Aleph said. So
// they travel with the books to own devices, and into the next backup.
//
// A restore into an empty browser cannot read this list – it is in the books.
// The CID is shown to copy, and the bridge's Aleph account lists its STORE
// messages (channel BELEGE-BACKUP) for when it is lost.

import { getSetting, setSetting } from '../store/settings.js';

export const BACKUPS_KEY = 'backups';
/** The newest this many are kept in the list; older backups stay where they are. */
export const KEEP = 50;

/**
 * @typedef {object} BackupRecord
 * @property {string} at ISO
 * @property {'aleph'} provider
 * @property {string} cid what the backup is fetched by
 * @property {number} size bytes, sealed
 * @property {string} status Aleph's: `processed` is kept, `pending` not yet
 * @property {string} [itemHash] the STORE message
 * @property {string} [address] the Aleph account that pays
 * @property {number} entries log entries in it, all databases
 * @property {{ collection: string, entries: number }[]} [databases] per database
 * @property {number} files receipt files in it
 * @property {number} [blocks] blocks in it, all told
 * @property {number} missing receipt-file blocks this browser did not have
 */

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<BackupRecord[]>} */
export async function loadBackups(settings) {
	const list = await getSetting(settings, BACKUPS_KEY);
	return Array.isArray(list) ? list : [];
}

/**
 * Newest first, at most KEEP.
 *
 * @param {BackupRecord[]} list
 * @param {BackupRecord} record
 */
export const withBackup = (list, record) => [record, ...list].slice(0, KEEP);

/** @param {import('../store/repository.js').Collection} settings @param {BackupRecord} record */
export async function rememberBackup(settings, record) {
	const list = withBackup(await loadBackups(settings), record);
	await setSetting(settings, BACKUPS_KEY, list);
	return list;
}

/** The file name a backup goes up as. @param {Date} at */
export const backupName = (at) =>
	`belege-${at.toISOString().slice(0, 16).replace(/[:]/g, '').replace('T', '-')}.backup`;

/**
 * Where the browser may upload: Aleph's IPFS host over https, or a fake on
 * 127.0.0.1 that a test's bridge names. Anything else is refused.
 *
 * @param {unknown} url
 * @returns {string | null}
 */
export function ingestUrlOf(url) {
	try {
		const u = new URL(String(url));
		if (u.protocol === 'https:') return u.toString();
		if (u.protocol === 'http:' && u.hostname === '127.0.0.1') return u.toString();
	} catch {
		// not a URL
	}
	return null;
}

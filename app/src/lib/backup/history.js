// The backups made so far (issue #77), in the sealed settings (key `backups`):
// when, where, how large, the CID to get it back by, and what Aleph said. So
// they travel with the books to own devices, and into the next backup.
//
// A restore into an empty browser cannot read this list – it is in the books.
// The CID is shown to copy, and Aleph lists the STORE messages kept for the
// paying account (channel BELEGE-BACKUP, keeper.js) for when it is lost.

import { getSetting, setSetting } from '../store/settings.js';

export const BACKUPS_KEY = 'backups';
/**
 * Of the chains backups no longer go on with, the newest this many rows are
 * kept in the list; older backups stay where they are. The chain a record
 * continues keeps every row: a restore fetches the chain's increments by this
 * list (and Aleph's), and a chain that backs up by itself has more than fifty
 * within weeks.
 */
export const KEEP = 50;

/**
 * @typedef {object} BackupRecord
 * @property {string} at ISO
 * @property {'aleph'} provider
 * @property {string} cid what the backup is fetched by
 * @property {number} size bytes, sealed
 * @property {string} status Aleph's: `processed` is kept, `pending` not yet,
 *   `rejected`, or `unknown` when Aleph does not know the STORE (keeper.js `storeStatus`)
 * @property {string} [itemHash] the STORE message
 * @property {string} [address] the Aleph account that pays
 * @property {string} [sender] who signed the STORE: this browser's key, or the bridge's
 * @property {string} [by] made by a member (#613): their write identity; absent: by the owner
 * @property {number} entries log entries in it, all databases (an increment's: the new ones)
 * @property {{ collection: string, entries: number }[]} [databases] per database
 * @property {number} files receipt files in it
 * @property {number} [blocks] blocks in it, all told
 * @property {number} missing receipt-file blocks this browser did not have
 * @property {'full' | 'increment'} [kind] `full` when absent (before #454)
 * @property {string} [base] an increment's: the full backup it builds on
 * @property {number} [sequence] an increment's number in its chain, from 1
 */

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<BackupRecord[]>} */
export async function loadBackups(settings) {
	const list = await getSetting(settings, BACKUPS_KEY);
	return Array.isArray(list) ? list : [];
}

/** The chain a row belongs to: its full backup's CID. @param {BackupRecord} b */
const chainOf = (b) => (b.kind === 'increment' ? b.base : b.cid);

/**
 * Newest first: every row of the record's chain, and at most KEEP of the others.
 *
 * @param {BackupRecord[]} list
 * @param {BackupRecord} record
 */
export const withBackup = (list, record) => {
	const chain = chainOf(record);
	let others = 0;
	return [record, ...list].filter((b) => chainOf(b) === chain || others++ < KEEP);
};

/** @param {import('../store/repository.js').Collection} settings @param {BackupRecord} record */
export async function rememberBackup(settings, record) {
	const list = withBackup(await loadBackups(settings), record);
	await setSetting(settings, BACKUPS_KEY, list);
	return list;
}

/**
 * The file name a backup goes up as; an increment's says its number.
 *
 * @param {Date} at @param {number} [sequence] 0 for a full backup
 */
export const backupName = (at, sequence = 0) =>
	`belege-${at.toISOString().slice(0, 16).replace(/[:]/g, '').replace('T', '-')}${sequence ? `-${sequence}` : ''}.backup`;

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

/**
 * Change one backup in the list, found by when it was made and its CID.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {Pick<BackupRecord, 'at' | 'cid'>} which
 * @param {Partial<BackupRecord>} patch
 */
export async function updateBackup(settings, which, patch) {
	const list = (await loadBackups(settings)).map((b) =>
		b.at === which.at && b.cid === which.cid ? { ...b, ...patch } : b
	);
	await setSetting(settings, BACKUPS_KEY, list);
	return list;
}

/**
 * Take one backup out of the list here – a row for one Aleph has deleted,
 * say. Nothing changes on Aleph.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {Pick<BackupRecord, 'at' | 'cid'>} which
 */
export async function dropBackup(settings, which) {
	const list = (await loadBackups(settings)).filter(
		(b) => !(b.at === which.at && b.cid === which.cid)
	);
	await setSetting(settings, BACKUPS_KEY, list);
	return list;
}

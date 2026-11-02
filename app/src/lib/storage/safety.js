// Whether the books would survive this browser (issue: books lost to storage
// eviction). Everything lies in this browser's IndexedDB; unless the browser
// has granted persistent storage, it may clear that storage when the disk runs
// low – silently, and localStorage stays, so the passkey still unlocks, into
// empty books. A backup or an own device holds a second copy.
//
// The browser is asked for persistent storage on every unlock (a passkey
// click came first, which some browsers weigh). Home warns while nothing
// keeps the books but this browser's goodwill, and reminds when the last
// backup is old.

/** A backup older than this many days is due again. */
export const BACKUP_DUE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Ask the browser to keep this site's storage for good.
 *
 * @param {Pick<StorageManager, 'persist' | 'persisted'> | undefined} [storage]
 * @returns {Promise<boolean | null>} null: the browser cannot say
 */
export async function requestPersistence(storage = globalThis.navigator?.storage) {
	if (!storage?.persisted || !storage.persist) return null;
	try {
		if (await storage.persisted()) return true;
		return await storage.persist();
	} catch {
		return null;
	}
}

/**
 * @typedef {object} BooksSafety
 * @property {'ok' | 'remind' | 'warn'} level
 *   warn: the browser may clear the books and there is no other copy;
 *   remind: kept, but no recent backup and no own device
 * @property {boolean | null} persisted
 * @property {string | null} lastBackup ISO
 * @property {number | null} backupAgeDays
 * @property {number} devices own devices the books know
 */

/**
 * @param {object} p
 * @param {boolean | null} p.persisted what the browser said; null: unknown
 * @param {string | null} p.lastBackup ISO, the newest backup (backup/history.js)
 * @param {number} p.devices own devices the books are synced with
 * @param {boolean} [p.empty] no records yet: nothing to lose
 * @param {Date} [p.now]
 * @returns {BooksSafety}
 */
export function booksSafety({ persisted, lastBackup, devices, empty = false, now = new Date() }) {
	const at = lastBackup ? Date.parse(lastBackup) : NaN;
	const backupAgeDays = Number.isFinite(at)
		? Math.max(0, Math.floor((now.getTime() - at) / DAY))
		: null;
	const recentBackup = backupAgeDays !== null && backupAgeDays < BACKUP_DUE_DAYS;
	const copied = recentBackup || devices > 0;
	/** @type {BooksSafety['level']} */
	let level = 'ok';
	if (!empty && !copied) level = persisted === true ? 'remind' : 'warn';
	return { level, persisted, lastBackup: lastBackup ?? null, backupAgeDays, devices };
}

// What the books take in this browser (issue #212), as figures for the page:
// per database, the receipt files, and what the browser itself reports.
// Pure; the page gathers the numbers.

import { COLLECTIONS } from '../store/repository.js';

/**
 * @typedef {object} DatabaseUsage
 * @property {string} name the collection
 * @property {number} records records a person sees (the newest version of each, deleted ones included)
 * @property {number} entries every version ever written: the log forgets nothing
 * @property {number} bytes about what the log takes
 */

/**
 * @param {object} p
 * @param {Record<string, { entries: number, bytes: number }>} p.logs per collection, from `collection.stats()`
 * @param {Record<string, number>} p.records per collection
 * @param {{ files: number, fileBytes: number }} p.files receipt files, from `booksStats`
 * @param {{ usage: number, quota: number } | null} p.estimate `navigator.storage.estimate()`
 * @returns {{ databases: DatabaseUsage[], databaseBytes: number, files: number, fileBytes: number, otherBytes: number | null, usage: number | null, quota: number | null }}
 */
export function storageSummary({ logs, records, files, estimate }) {
	const databases = COLLECTIONS.map((name) => ({
		name,
		records: records[name] ?? 0,
		entries: logs[name]?.entries ?? 0,
		bytes: logs[name]?.bytes ?? 0
	}));
	const databaseBytes = databases.reduce((n, d) => n + d.bytes, 0);
	const usage = estimate?.usage ?? null;
	return {
		databases,
		databaseBytes,
		files: files.files,
		fileBytes: files.fileBytes,
		// The rest of what the browser counts: indexes, the app shell's cache, blocks of
		// identities and manifests, and the browser's own overhead. Never below zero:
		// the browser's figure is an estimate too.
		otherBytes: usage === null ? null : Math.max(0, usage - databaseBytes - files.fileBytes),
		usage,
		quota: estimate?.quota ?? null
	};
}

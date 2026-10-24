// Where the chain of backups stands (#454): the full backup it starts from,
// the last increment, the heads each database had when last shipped and the
// receipt files shipped so far. Kept in the sealed settings, so it travels
// with the books to own devices: the next backup there continues the chain.
//
// It moves only once Aleph has taken a backup (not refused it): an increment
// Aleph refused is shipped again, in full, by the next one.

import { getSetting, setSetting } from '../store/settings.js';

/** The settings record with the chain. */
export const CHAIN_SETTING = 'backup/chain';

/** @typedef {import('./archive.js').BackupChain} BackupChain */

/**
 * The chain a full backup starts: its databases' heads and its receipt files.
 *
 * @param {import('./archive.js').BackupManifest} manifest
 * @param {string} cid the full backup's
 * @returns {BackupChain}
 */
export function chainFromBase(manifest, cid) {
	/** @type {Record<string, string[]>} */
	const heads = {};
	for (const d of /** @type {any} */ (manifest.metadata).databases ?? []) {
		heads[String(d.address)] = Array.isArray(d.heads) ? d.heads.map(String) : [];
	}
	return { base: cid, sequence: 0, previous: null, heads, files: [...manifest.files] };
}

/**
 * The chain after an increment was taken.
 *
 * @param {BackupChain} chain
 * @param {{ heads: Record<string, string[]>, files: string[] }} increment what `buildIncrement` gave
 * @param {string} cid the increment's
 * @returns {BackupChain}
 */
export const chainAfter = (chain, increment, cid) => ({
	base: chain.base,
	sequence: chain.sequence + 1,
	previous: cid,
	heads: increment.heads,
	files: [...new Set([...chain.files, ...increment.files])]
});

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<BackupChain | null>} */
export async function loadChain(settings) {
	const chain = /** @type {any} */ (await getSetting(settings, CHAIN_SETTING));
	return chain && typeof chain.base === 'string' && chain.heads && Array.isArray(chain.files)
		? chain
		: null;
}

/** @param {import('../store/repository.js').Collection} settings @param {BackupChain | null} chain */
export async function saveChain(settings, chain) {
	await setSetting(settings, CHAIN_SETTING, chain);
	return chain;
}

/**
 * @typedef {object} OlderChain
 * @property {string} base its full backup's CID
 * @property {string} at when the full backup was made ('' when this browser's history lacks it)
 * @property {number} increments how many increments it has here
 * @property {number} bytes what of it Aleph keeps (or is deciding on), sealed
 * @property {import('./history.js').BackupRecord[]} records its rows in the history
 */

/** Aleph keeps it, or has not decided yet. @param {import('./history.js').BackupRecord} b */
const held = (b) => b.status === 'processed' || b.status === 'pending';

/**
 * The chains of backups other than the one backups go on with: each full
 * backup with its increments, from the history, those Aleph still keeps.
 * Without a chain (before #454) the newest full backup Aleph keeps is the one
 * to keep; with none kept, nothing is offered – every chain is someone's
 * last backup then.
 *
 * @param {import('./history.js').BackupRecord[]} backups
 * @param {string | null | undefined} current the chain's full backup's CID
 * @returns {OlderChain[]} newest first
 */
export function olderChains(backups, current) {
	const isFull = (/** @type {import('./history.js').BackupRecord} */ b) => b.kind !== 'increment';
	const keep =
		current ??
		backups
			.filter((b) => isFull(b) && b.status === 'processed')
			.sort((a, b) => (a.at < b.at ? 1 : -1))[0]?.cid;
	if (!keep || !backups.some((b) => b.cid === keep && b.status === 'processed')) return [];
	/** @type {Map<string, import('./history.js').BackupRecord[]>} */
	const byBase = new Map();
	for (const b of backups) {
		const base = isFull(b) ? b.cid : b.base;
		if (!base || base === keep) continue;
		byBase.set(base, [...(byBase.get(base) ?? []), b]);
	}
	return [...byBase.entries()]
		.filter(([, records]) => records.some(held))
		.map(([base, records]) => {
			const full = records.filter(isFull).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
			return {
				base,
				at: full?.at ?? '',
				increments: new Set(records.filter((b) => !isFull(b)).map((b) => b.cid)).size,
				// A backup kept again has two rows and one file.
				bytes: [...new Map(records.filter(held).map((b) => [b.cid, b.size])).values()].reduce(
					(n, size) => n + size,
					0
				),
				records
			};
		})
		.sort((a, b) => (a.at < b.at ? 1 : -1));
}

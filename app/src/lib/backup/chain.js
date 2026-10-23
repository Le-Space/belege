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

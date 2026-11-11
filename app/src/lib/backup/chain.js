// Where the chain of backups stands (#454): the full backup it starts from,
// the last increment, the heads each database had when last shipped and the
// receipt files shipped so far. Kept in the sealed settings, so it travels
// with the books to own devices: the next backup there continues the chain.
//
// It moves once Aleph has taken a backup (not refused it). Aleph may answer
// "pending" first and refuse later – a file it could not fetch, for one – so
// the chain also remembers how far Aleph has *confirmed* it (`kept`) and the
// increments shipped since (`pending`). When one of those turns out refused
// or unknown, the chain goes back to `kept` (`reconcileChain`): the next
// increment ships everything since again, under the next number after the
// last one Aleph keeps, so a restore finds no gap.

import { getSetting, setSetting } from '../store/settings.js';
import { loadBackups } from './history.js';

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
	const files = [...manifest.files];
	return {
		base: cid,
		sequence: 0,
		previous: null,
		heads,
		files,
		kept: { sequence: 0, previous: null, heads, files: files.length },
		pending: []
	};
}

/**
 * The chain after an increment was taken.
 *
 * @param {BackupChain} chain
 * @param {{ heads: Record<string, string[]>, files: string[] }} increment what `buildIncrement` gave
 * @param {string} cid the increment's
 * @returns {BackupChain}
 */
export function chainAfter(chain, increment, cid, status = 'processed') {
	const files = [...new Set([...chain.files, ...increment.files])];
	const point = {
		sequence: chain.sequence + 1,
		previous: cid,
		heads: increment.heads,
		files: files.length
	};
	const pending = chain.pending ?? [];
	// Confirmed, with nothing before it still open: the chain is kept up to here.
	const confirmed = status === 'processed' && !pending.length;
	return {
		base: chain.base,
		sequence: point.sequence,
		previous: cid,
		heads: increment.heads,
		files,
		kept: confirmed ? point : (chain.kept ?? point),
		pending: confirmed ? [] : [...pending, { ...point, cid }]
	};
}

/** What Aleph does not keep. */
const NOT_KEPT = new Set(['rejected', 'unknown', 'forgotten']);

/**
 * The chain as far as Aleph keeps it, from what the history says now:
 * increments Aleph has since confirmed move `kept` on; one it refused, or
 * does not know, sends the chain back to `kept`. Returns the same chain when
 * nothing changed.
 *
 * A chain from before `kept` existed: when every increment of it Aleph
 * holds, it is kept as it stands. When one is refused, the chain goes back
 * to just before the first refused one, with no heads – the next increment
 * ships every entry again, which a restore merges – and with the receipt
 * files shipped up to there; when a refused one carried receipt files that
 * cannot be told apart, all of them go again. If an increment after a
 * refused one is kept, the chain has a gap a restore cannot cross: null,
 * so the next backup is a full one.
 *
 * @param {BackupChain} chain
 * @param {import('./history.js').BackupRecord[]} backups
 * @returns {BackupChain | null}
 */
export function reconcileChain(chain, backups) {
	const byCid = new Map(backups.map((b) => [b.cid, b]));
	if (!chain.kept) {
		const ours = backups
			.filter((b) => b.kind === 'increment' && b.base === chain.base)
			.filter((b) => (b.sequence ?? 0) >= 1 && (b.sequence ?? 0) <= chain.sequence)
			.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
		const firstBad = ours.find((b) => NOT_KEPT.has(b.status));
		// Aleph has not decided on one yet: wait, so a refusal can still send the chain back.
		if (!firstBad && ours.some((b) => b.status === 'pending')) return chain;
		if (!firstBad) {
			const point = {
				sequence: chain.sequence,
				previous: chain.previous,
				heads: chain.heads,
				files: chain.files.length
			};
			return { ...chain, kept: point, pending: [] };
		}
		const back = (firstBad.sequence ?? 1) - 1;
		if (ours.some((b) => (b.sequence ?? 0) > back + 1 && b.status === 'processed')) return null;
		const lost = ours.filter((b) => (b.sequence ?? 0) > back);
		const shipped = lost.reduce((n, b) => n + (b.files ?? 0), 0);
		// Files are appended in order: the last `shipped` ones came with what is lost.
		const files = shipped
			? chain.files.slice(0, Math.max(0, chain.files.length - shipped))
			: chain.files;
		const previous = back ? (ours.find((b) => b.sequence === back)?.cid ?? null) : null;
		const point = { sequence: back, previous, heads: {}, files: files.length };
		return { ...chain, sequence: back, previous, heads: {}, files, kept: point, pending: [] };
	}
	let kept = chain.kept;
	const pending = [...(chain.pending ?? [])];
	let changed = false;
	while (pending.length) {
		const status = byCid.get(pending[0].cid)?.status;
		if (status === 'processed') {
			const p = /** @type {(typeof pending)[number]} */ (pending.shift());
			kept = { sequence: p.sequence, previous: p.previous, heads: p.heads, files: p.files };
			changed = true;
			continue;
		}
		if (status && NOT_KEPT.has(status)) {
			if (pending.slice(1).some((p) => byCid.get(p.cid)?.status === 'processed')) return null;
			return {
				...chain,
				sequence: kept.sequence,
				previous: kept.previous,
				heads: kept.heads,
				files: chain.files.slice(0, kept.files),
				kept,
				pending: []
			};
		}
		break;
	}
	return changed ? { ...chain, kept, pending } : chain;
}

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<BackupChain | null>} */
export async function loadChain(settings) {
	const chain = /** @type {any} */ (await getSetting(settings, CHAIN_SETTING));
	if (!(chain && typeof chain.base === 'string' && chain.heads && Array.isArray(chain.files))) {
		return null;
	}
	// As far as Aleph keeps it, by what the history says now (reconcileChain).
	const now = reconcileChain(chain, await loadBackups(settings));
	if (now !== chain) await setSetting(settings, CHAIN_SETTING, now);
	return now;
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

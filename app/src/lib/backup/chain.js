// Where the chain of backups stands (#454): the full backup it starts from,
// the last increment, the heads each database had when last shipped and the
// receipt files shipped so far – those in a record per backup of the chain
// (#558, CHAIN_FILES_PREFIX). Kept in the sealed settings, so it travels
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
 * The chain after an increment was taken. `processed` with nothing open
 * before it moves `kept` on; any other answer puts the point aside as pending
 * (the storage bridge's `advanceConfirmation`).
 *
 * @param {BackupChain} chain
 * @param {{ heads: Record<string, string[]>, files: string[] }} increment what `buildIncrement` gave
 * @param {string} cid the increment's
 * @param {string} [status] Aleph's answer
 * @returns {Promise<BackupChain>}
 */
export async function chainAfter(chain, increment, cid, status = 'processed') {
	const { advanceConfirmation } = await import('@le-space/orbitdb-storage-bridge/live-backup');
	const files = [...new Set([...chain.files, ...increment.files])];
	const point = {
		sequence: chain.sequence + 1,
		previous: cid,
		heads: increment.heads,
		files: files.length
	};
	const confirmation = /** @type {any} */ (
		advanceConfirmation(
			{ kept: chain.kept ?? null, pending: chain.pending ?? [] },
			point,
			cid,
			status
		)
	);
	return {
		base: chain.base,
		sequence: point.sequence,
		previous: cid,
		heads: increment.heads,
		files,
		// A chain from before, shipped pending: its first point is where it stands now.
		kept: confirmation.kept ?? point,
		pending: confirmation.pending
	};
}

/** What Aleph does not keep. */
const NOT_KEPT = new Set(['rejected', 'unknown', 'forgotten']);

/**
 * A chain from before `kept` existed, by what the history says: when Aleph
 * holds every increment of it, it is kept as it stands; while one is still
 * pending, it is left alone. When one is refused, the chain goes back to
 * just before the first refused one, with no heads – the next increment
 * ships every entry again, which a restore merges – and without the receipt
 * files the refused ones carried. If an increment after a refused one is
 * kept, the chain has a gap a restore cannot cross: null.
 *
 * @param {BackupChain} chain
 * @param {import('./history.js').BackupRecord[]} backups
 * @returns {BackupChain | null}
 */
function adoptChain(chain, backups) {
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

/**
 * The chain as far as Aleph keeps it, from what the history says now (the
 * storage bridge's `reconcileConfirmation`): increments Aleph has since
 * confirmed move `kept` on; one it refused, or does not know, sends the
 * chain back to `kept`. Returns the same chain when nothing changed, and
 * null for a gap a restore cannot cross – the next backup is a full one.
 *
 * @param {BackupChain} chain
 * @param {import('./history.js').BackupRecord[]} backups
 * @returns {Promise<BackupChain | null>}
 */
export async function reconcileChain(chain, backups) {
	if (!chain.kept) return adoptChain(chain, backups);
	const { reconcileConfirmation } = await import('@le-space/orbitdb-storage-bridge/live-backup');
	const byCid = new Map(backups.map((b) => [b.cid, b.status]));
	const now = /** @type {any} */ (
		reconcileConfirmation({ kept: chain.kept, pending: chain.pending ?? [] }, (cid) =>
			byCid.get(cid)
		)
	);
	if (!now.changed) return chain;
	if (now.gap) return null;
	if (!now.rewound) return { ...chain, kept: now.kept, pending: now.pending };
	const kept = /** @type {NonNullable<BackupChain['kept']>} */ (now.rewind ?? chain.kept);
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

/**
 * The receipt files a chain has shipped are not in its record (#558): that
 * record is written with every backup, each write a log entry the next
 * increment ships and every device syncs, and a list of every file ever
 * shipped grew with the books. Each backup of the chain has a record of its
 * own instead, under this prefix, the chain's full backup and its number:
 * the files that backup added, written once. The chain's `files` is put
 * together from them when it is loaded, from its full backup up to its
 * number – so a chain gone back leaves out what the increments after the
 * point it went back to shipped, and the next increment under that number
 * writes its own.
 */
export const CHAIN_FILES_PREFIX = 'backup/chain-files/';

/** @param {string} base @param {number} sequence */
export const chainFilesKey = (base, sequence) => `${CHAIN_FILES_PREFIX}${base}/${sequence}`;

/**
 * The file records of the chain on `base`, by number.
 *
 * @param {import('../store/repository.js').Collection} settings @param {string} base
 * @returns {Promise<Map<number, string[]>>}
 */
async function fileRecords(settings, base) {
	const prefix = `${CHAIN_FILES_PREFIX}${base}/`;
	/** @type {Map<number, string[]>} */
	const out = new Map();
	for (const r of await settings.list({
		where: (r) => typeof r.key === 'string' && r.key.startsWith(prefix)
	})) {
		const sequence = Number(String(r.key).slice(prefix.length));
		if (Number.isInteger(sequence) && sequence >= 0 && Array.isArray(r.value)) {
			out.set(sequence, r.value.map(String));
		}
	}
	return out;
}

/**
 * Every file shipped from the full backup up to `sequence`, in the order shipped.
 *
 * @param {Map<number, string[]>} records @param {number} sequence
 */
function filesUpTo(records, sequence) {
	/** @type {Set<string>} */
	const files = new Set();
	for (const s of [...records.keys()].sort((a, b) => a - b)) {
		if (s > sequence) break;
		for (const f of records.get(s) ?? []) files.add(f);
	}
	return [...files];
}

/** @param {string[]} a @param {string[]} b */
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** @param {import('../store/repository.js').Collection} settings @returns {Promise<BackupChain | null>} */
export async function loadChain(settings) {
	const stored = /** @type {any} */ (await getSetting(settings, CHAIN_SETTING));
	if (!(stored && typeof stored.base === 'string' && stored.heads)) return null;
	// A chain written before #558 carries its files itself; saved again, they
	// move into records of their own.
	const before = Array.isArray(stored.files);
	/** @type {BackupChain} */
	const chain = {
		...stored,
		sequence: Number(stored.sequence ?? 0),
		files: before
			? stored.files.map(String)
			: filesUpTo(await fileRecords(settings, stored.base), Number(stored.sequence ?? 0))
	};
	// As far as Aleph keeps it, by what the history says now (reconcileChain).
	const now = await reconcileChain(chain, await loadBackups(settings));
	if (now !== chain || before) await saveChain(settings, now);
	return now;
}

/**
 * Keep the chain: its record without the files, and the files its newest
 * backup added in that backup's own record (see CHAIN_FILES_PREFIX). A new
 * chain clears the file records of the chains before it.
 *
 * @param {import('../store/repository.js').Collection} settings @param {BackupChain | null} chain
 */
export async function saveChain(settings, chain) {
	if (!chain) {
		await setSetting(settings, CHAIN_SETTING, null);
		return chain;
	}
	const { files, ...record } = chain;
	const records = await fileRecords(settings, chain.base);
	/** @type {[number, string[]][]} */
	const writes = [];
	if (records.size === 0 && chain.sequence > 0) {
		// A chain from before #558: its files split by what each point had shipped.
		const points = [chain.kept, ...(chain.pending ?? [])]
			.filter((p) => p && p.sequence < chain.sequence)
			.sort((a, b) => /** @type {any} */ (a).sequence - /** @type {any} */ (b).sequence);
		let from = 0;
		for (const p of /** @type {import('./archive.js').ChainPoint[]} */ (points)) {
			const to = Math.max(from, Math.min(files.length, p.files ?? 0));
			writes.push([p.sequence, files.slice(from, to)]);
			from = to;
		}
		writes.push([chain.sequence, files.slice(from)]);
	} else {
		const had = new Set(filesUpTo(records, chain.sequence - 1));
		writes.push([chain.sequence, files.filter((f) => !had.has(f))]);
	}
	for (const [sequence, own] of writes) {
		const existing = records.get(sequence);
		if (existing ? sameList(existing, own) : own.length === 0) continue;
		await setSetting(settings, chainFilesKey(chain.base, sequence), own);
	}
	if (chain.sequence === 0) {
		// The chains before this one are not continued: their lists go.
		const own = `${CHAIN_FILES_PREFIX}${chain.base}/`;
		for (const r of await settings.list({
			where: (r) =>
				typeof r.key === 'string' &&
				r.key.startsWith(CHAIN_FILES_PREFIX) &&
				!r.key.startsWith(own) &&
				r.value !== null
		})) {
			await settings.put({ ...r, value: null });
		}
	}
	await setSetting(settings, CHAIN_SETTING, record);
	return chain;
}

/**
 * Aleph refused the newest increment on this full backup – after the run
 * that shipped it, or during it. The chain has gone back to what Aleph keeps
 * (reconcileChain), so the books look unsaved again, and an automatic
 * increment would ship everything since then once more – often refused
 * again, for the same reason. Automatic backup waits for a person then
 * (auto.svelte.js); a later row for the same chain that Aleph keeps or is
 * still deciding on – "Jetzt sichern", or the refused one kept again – ends
 * the wait. A refusal for credits counts the same: another try does not
 * bring credits either.
 *
 * @param {import('./history.js').BackupRecord[]} backups
 * @param {string | null | undefined} base the chain's full backup's CID
 * @returns {import('./history.js').BackupRecord | null} the refused row, or null
 */
export function refusedIncrement(backups, base) {
	if (!base) return null;
	const newest = backups
		.filter((b) => b.kind === 'increment' && b.base === base)
		.sort((a, b) =>
			a.at === b.at ? (b.sequence ?? 0) - (a.sequence ?? 0) : a.at < b.at ? 1 : -1
		)[0];
	return newest?.status === 'rejected' ? newest : null;
}

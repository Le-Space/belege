// The matching runs this device would otherwise miss (#473). The engine runs
// after an import or an action on this device; what comes from another own
// device by sync, and what changed while this device was locked, waited for
// the next click. Two catch-ups:
//   - shortly after entries came by sync (payments, receipts, links, the
//     matching settings): one run, once the burst is over;
//   - once after unlocking, when the books are not as they were at this
//     device's last run (a fingerprint kept in this browser only).
// Both are ordinary automatic runs: logged only when they changed something.

/** Quiet this long after the last entry that came, and the run starts. */
export const SYNC_QUIET_MS = 5000;
/** Where this browser keeps the books' fingerprint at its last run, by DID. */
export const LAST_RUN_KEY = 'belege.matching.lastRun';

/** The collections whose arriving entries can change what matches. */
const MATTERS = new Set(['transactions', 'receipts', 'matches']);

/**
 * Whether an entry that came by sync calls for a run.
 *
 * @param {Pick<import('../sync/sync-log.js').SyncLine, 'direction' | 'collection' | 'what'>} line
 */
export const callsForRun = (line) =>
	line.direction === 'in' &&
	(MATTERS.has(line.collection) ||
		(line.collection === 'settings' && line.what?.key === 'matching'));

/**
 * The books as the engine sees them, in a few characters: how many payments,
 * receipts and links there are and the newest change. An entry that came with
 * an older date still changes the count.
 *
 * @param {{ transactions: { updatedAt?: string }[], receipts: { updatedAt?: string }[], matches: { updatedAt?: string }[] }} books
 */
export function fingerprint({ transactions, receipts, matches }) {
	let newest = '';
	for (const list of [transactions, receipts, matches]) {
		for (const r of list) if (r.updatedAt && r.updatedAt > newest) newest = r.updatedAt;
	}
	return `${transactions.length}/${receipts.length}/${matches.length}/${newest}`;
}

/** @param {Storage | undefined} storage @param {string} did */
export function lastRunOf(storage, did) {
	try {
		return JSON.parse(storage?.getItem(LAST_RUN_KEY) ?? '{}')?.[did] ?? null;
	} catch {
		return null;
	}
}

/** @param {Storage | undefined} storage @param {string} did @param {string} print */
export function noteRun(storage, did, print) {
	try {
		const all = JSON.parse(storage?.getItem(LAST_RUN_KEY) ?? '{}') ?? {};
		storage?.setItem(LAST_RUN_KEY, JSON.stringify({ ...all, [did]: print }));
	} catch {
		// No storage: the next unlock runs once more, which costs nothing.
	}
}

/**
 * A function that runs `run` once, `quietMs` after the last call.
 *
 * @param {() => unknown} run
 * @param {number} [quietMs]
 */
export function debounced(run, quietMs = SYNC_QUIET_MS) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	const call = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			run();
		}, quietMs);
	};
	call.cancel = () => clearTimeout(timer);
	return call;
}

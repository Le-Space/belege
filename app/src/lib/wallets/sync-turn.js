// "Alle Wallets synchronisieren": the wallets one after the other, apart from
// the page that started it (sync-run.svelte.js holds the state, this the
// loop). A wallet that fails is noted and the turn goes on.

/**
 * @typedef {object} TurnSummary what a turn found, for the note and the notification
 * @property {number} wallets wallets asked
 * @property {number} newEntries bookings new to the books
 * @property {number} updated bookings changed
 * @property {number} unpriced bookings without a rate
 * @property {number} failed wallets that could not be read
 * @property {number} withNew wallets that brought new bookings
 */

/**
 * @template W, R
 * @param {object} p
 * @param {W[]} p.wallets in the order to ask them
 * @param {(wallet: W) => Promise<R>} p.syncOne one wallet's sync; throws on failure
 * @param {(result: R) => { new: number, updated: number, unpriced: number }} p.countsOf
 * @param {(progress: { done: number, count: number, current: W | null }) => void} [p.onProgress]
 * @param {() => boolean} [p.stopped] asked before each wallet
 * @returns {Promise<TurnSummary>}
 */
export async function syncInTurn({
	wallets,
	syncOne,
	countsOf,
	onProgress = () => {},
	stopped = () => false
}) {
	/** @type {TurnSummary} */
	const summary = { wallets: 0, newEntries: 0, updated: 0, unpriced: 0, failed: 0, withNew: 0 };
	const count = wallets.length;
	for (const [done, wallet] of wallets.entries()) {
		if (stopped()) break;
		onProgress({ done, count, current: wallet });
		summary.wallets += 1;
		try {
			const counts = countsOf(await syncOne(wallet));
			summary.newEntries += counts.new;
			summary.updated += counts.updated;
			summary.unpriced += counts.unpriced;
			if (counts.new > 0) summary.withNew += 1;
		} catch {
			summary.failed += 1;
		}
	}
	onProgress({ done: summary.wallets, count, current: null });
	return summary;
}

/** @param {{ done: number, count: number } | null} progress */
export const percentOf = (progress) =>
	progress && progress.count > 0 ? Math.round((100 * progress.done) / progress.count) : 0;

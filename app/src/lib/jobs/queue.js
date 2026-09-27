// One queue for the AI runs – "Alle neuen auslesen" (receipts/extract-queue)
// and "KI-Vorschläge für alle offenen Rückfragen" (matching/ai-suggest): a few
// workers take ids one at a time, so 2 (up to 4) requests go at once. When the
// provider limits requests (HTTP 429 from the bridge) the id goes back and
// every worker pauses, 2 s doubling to 30 s, instead of the id counting as
// failed. "Abbrechen" and locking the books stop the workers after the id in
// hand. After every id, and at the end, the caller learns which ids are left,
// to keep them for "weitermachen" after a reload (jobs/pending.js).
//
// Plain JS: the caller hands in its own `$state` object for the progress.

/** @typedef {{ progress: { done: number, count: number } | null, cancelling: boolean, failed: number }} RunState */

export const MIN_WORKERS = 1;
export const MAX_WORKERS = 4;
export const DEFAULT_WORKERS = 2;
const MAX_RETRIES = 6;
const MAX_PAUSE_MS = 30_000;

/** Whether an error says: too many requests, try again later. @param {any} error */
export const isRateLimit = (error) => error?.status === 429;

/**
 * @param {object} params
 * @param {string[]} params.ids
 * @param {(id: string) => Promise<unknown>} params.handle one id; throws to fail, a 429 to retry later
 * @param {RunState} params.state the caller's progress state
 * @param {number} [params.workers] requests at once (1–4)
 * @param {() => boolean} [params.isOpen] false once the books are locked
 * @param {(left: string[]) => unknown} [params.onProgress] ids not done yet, after each one
 * @param {(left: string[], how: 'done' | 'cancelled' | 'closed') => unknown} [params.onEnd]
 * @param {(ms: number) => Promise<void>} [params.sleep]
 * @returns {Promise<boolean>} false when a run of this state is going already
 */
export async function runQueue({
	ids,
	handle,
	state,
	workers = DEFAULT_WORKERS,
	isOpen = () => true,
	onProgress,
	onEnd,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
	if (state.progress) return false;
	state.progress = { done: 0, count: ids.length };
	state.cancelling = false;
	state.failed = 0;
	const queue = [...ids];
	/** @type {Set<string>} */
	const inFlight = new Set();
	/** @type {Map<string, number>} */
	const retries = new Map();
	let pause = 0;
	let closed = false;
	const left = () => [...inFlight, ...queue];

	const worker = async () => {
		while (queue.length) {
			if (state.cancelling) return;
			if (!isOpen()) {
				closed = true;
				return;
			}
			if (pause) await sleep(pause);
			const id = /** @type {string} */ (queue.shift());
			inFlight.add(id);
			try {
				await handle(id);
				if (state.progress) state.progress.done++;
				pause = Math.floor(pause / 2) < 1000 ? 0 : Math.floor(pause / 2);
			} catch (error) {
				const tries = (retries.get(id) ?? 0) + 1;
				if (isRateLimit(error) && tries <= MAX_RETRIES) {
					retries.set(id, tries);
					queue.push(id);
					pause = Math.min(Math.max(pause * 2, 2000), MAX_PAUSE_MS);
				} else {
					state.failed++;
					if (state.progress) state.progress.done++;
				}
			} finally {
				inFlight.delete(id);
			}
			await onProgress?.(left());
		}
	};

	const n = Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, Math.floor(workers) || DEFAULT_WORKERS));
	try {
		// Kept before the first request: a reload during it loses nothing.
		await onProgress?.(left());
		await Promise.all(Array.from({ length: n }, worker));
	} finally {
		const how = closed || !isOpen() ? 'closed' : state.cancelling ? 'cancelled' : 'done';
		const rest = left();
		state.progress = null;
		state.cancelling = false;
		await onEnd?.(rest, how);
	}
	return true;
}

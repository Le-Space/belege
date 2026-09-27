// How many AI requests a run sends at once (jobs/queue.js), kept in the sealed
// settings (`aiQueue`) and set on the Statistik page: 1 to 4, 2 by default.
// Fewer when the provider limits requests often, more for a local model.
// And whether a run first asks "own transfer?" (`aiQueueTransferFirst`).

import { getSetting, setSetting } from '../store/settings.js';
import { DEFAULT_WORKERS, MAX_WORKERS, MIN_WORKERS } from './queue.js';

const KEY = 'aiQueue';

/** @param {unknown} v */
export const cleanWorkers = (v) => {
	const n = Math.floor(Number(v));
	return Number.isFinite(n) && n >= MIN_WORKERS && n <= MAX_WORKERS ? n : DEFAULT_WORKERS;
};

/** @param {import('../store/repository.js').Collection} settings */
export async function loadWorkers(settings) {
	const v = /** @type {any} */ (await getSetting(settings, KEY));
	return cleanWorkers(v?.workers);
}

/**
 * @param {import('../store/repository.js').Collection} settings
 * @param {number} workers
 */
export function saveWorkers(settings, workers) {
	return setSetting(settings, KEY, { workers: cleanWorkers(workers) });
}

const TRANSFER_KEY = 'aiQueueTransferFirst';

/**
 * Whether a run asks "own transfer?" before it looks for a receipt (issue
 * #109): one more request where a close other side exists. Off by default.
 *
 * @param {import('../store/repository.js').Collection} settings
 */
export async function loadTransferFirst(settings) {
	return (await getSetting(settings, TRANSFER_KEY)) === true;
}

/** @param {import('../store/repository.js').Collection} settings @param {boolean} on */
export function saveTransferFirst(settings, on) {
	return setSetting(settings, TRANSFER_KEY, on === true);
}

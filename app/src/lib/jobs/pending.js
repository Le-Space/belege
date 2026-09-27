// What an AI run had not done yet when the page was reloaded or the books
// were locked: kept in the sealed settings (`pendingJobs`), so the next unlock
// can ask "weitermachen?" (Home). Only ids; a run that ends or is cancelled
// clears its kind. Writes are chained, so two workers never interleave them.

import { getSetting, setSetting } from '../store/settings.js';

/** @typedef {'extract' | 'suggest'} JobKind */

const KEY = 'pendingJobs';
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/**
 * @param {import('../store/repository.js').Collection} settings
 * @returns {Promise<Record<JobKind, string[]>>}
 */
export async function loadPending(settings) {
	const v = /** @type {any} */ (await getSetting(settings, KEY)) ?? {};
	/** @param {unknown} list */
	const ids = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
	return { extract: ids(v.extract), suggest: ids(v.suggest) };
}

/**
 * Keep (or with an empty list, clear) what one kind of run has left.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {JobKind} kind
 * @param {string[]} ids
 */
export function savePending(settings, kind, ids) {
	chain = chain
		.catch(() => {})
		.then(async () => {
			const now = await loadPending(settings);
			const same = now[kind].length === ids.length && now[kind].every((id, i) => id === ids[i]);
			if (same) return;
			await setSetting(settings, KEY, { ...now, [kind]: [...ids] });
		});
	return chain;
}

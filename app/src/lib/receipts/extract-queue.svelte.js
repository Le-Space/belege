// Reading receipts with the model, app-wide rather than on a page: "Alle
// neuen auslesen" keeps running, and keeps showing where it is, when the
// person goes to another page and comes back. One run at a time; a receipt
// being read is never sent again (not by a single "Auslesen" either); a run
// can be cancelled, and stops when the books are locked.
//
// Each receipt is read with extract.js, which writes onto the receipt as it
// is at that moment. The run re-reads every receipt before sending it and
// skips one that was deleted or read meanwhile.

import { SvelteSet } from 'svelte/reactivity';
import { extractReceipt, extractable } from './extract.js';
import { isRateLimit, runQueue } from '../jobs/queue.js';
import { savePending } from '../jobs/pending.js';
import { loadWorkers } from '../jobs/workers.js';

/** Receipt ids being read right now. */
export const reading = new SvelteSet(/** @type {string[]} */ ([]));

export const extractRun = $state({
	/** @type {{ done: number, count: number } | null} the running "Alle neuen auslesen" */
	progress: null,
	/** whether "Abbrechen" was pressed; the receipt being read is finished first */
	cancelling: false,
	/** @type {Record<string, string>} the last error, by receipt id */
	errors: {},
	/** receipts the last run could not read */
	failed: 0
});

/**
 * @typedef {object} Context
 * @property {Parameters<typeof extractReceipt>[0]['client']} client the bridge
 * @property {() => ({ receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection, settings?: import('../store/repository.js').Collection } | null)} store the open books, or null once locked
 * @property {() => (import('./blob-store.js').BlobStore | null)} blobs
 * @property {() => Promise<unknown>} [refresh] after each receipt
 * @property {number} [workers] requests at once; else the setting (jobs/workers.js)
 * @property {import('../store/repository.js').Collection | null} [settings] to keep what is left
 *   for "weitermachen" after a reload (jobs/pending.js)
 */

/**
 * Read one receipt; nothing when it is being read already or the books are
 * locked. Errors are kept in `extractRun.errors`, not thrown.
 *
 * @param {Context} ctx
 * @param {import('../store/repository.js').StoredRecord} record
 * @param {{ rethrowLimit?: boolean }} [options] the queue: a rate limit is thrown, to be tried again
 * @returns {Promise<boolean>} whether it was read (successfully or not)
 */
export async function extractOne(ctx, record, { rethrowLimit = false } = {}) {
	const store = ctx.store();
	const blobs = ctx.blobs();
	if (!store || !blobs || reading.has(record.id)) return false;
	reading.add(record.id);
	const rest = { ...extractRun.errors };
	delete rest[record.id];
	extractRun.errors = rest;
	try {
		await extractReceipt({
			client: ctx.client,
			receipts: store.receipts,
			blobs,
			record,
			events: store.events
		});
	} catch (error) {
		if (rethrowLimit && isRateLimit(error)) throw error;
		extractRun.errors = {
			...extractRun.errors,
			[record.id]: error instanceof Error ? error.message : String(error)
		};
		if (rethrowLimit) throw error;
	} finally {
		reading.delete(record.id);
		await ctx.refresh?.();
	}
	return true;
}

/**
 * "Alle neuen auslesen": the given receipts, a few at a time (jobs/queue.js). Refused (false)
 * while a run is going.
 *
 * @param {Context} ctx
 * @param {string[]} ids the receipts to read, in order
 * @returns {Promise<boolean>} whether this run started (it has ended when this resolves)
 */
export async function extractAll(ctx, ids) {
	const books = ctx.store();
	if (!books) return false;
	const settings = ctx.settings ?? books.settings ?? null;
	const workers = ctx.workers ?? (settings ? await loadWorkers(settings) : undefined);
	return runQueue({
		ids,
		state: extractRun,
		workers,
		// Locked, or other books opened: stop; what is left is kept.
		isOpen: () => ctx.store()?.receipts === books.receipts,
		handle: async (id) => {
			const store = ctx.store();
			if (!store) return;
			const record = await store.receipts.get(id);
			// Deleted, read or no longer waiting meanwhile: skip it.
			if (record && extractable([record]).length) {
				await extractOne(ctx, record, { rethrowLimit: true });
			}
		},
		onProgress: (left) => settings && savePending(settings, 'extract', left),
		onEnd: (left, how) => settings && savePending(settings, 'extract', how === 'closed' ? left : [])
	});
}

/** "Abbrechen": the receipt being read is finished, no further one is sent. */
export function cancelExtractAll() {
	if (extractRun.progress) extractRun.cancelling = true;
}

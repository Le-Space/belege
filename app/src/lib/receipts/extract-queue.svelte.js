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

/** Receipt ids being read right now. */
export const reading = new SvelteSet(/** @type {string[]} */ ([]));

export const extractRun = $state({
	/** @type {{ done: number, count: number } | null} the running "Alle neuen auslesen" */
	progress: null,
	/** whether "Abbrechen" was pressed; the receipt being read is finished first */
	cancelling: false,
	/** @type {Record<string, string>} the last error, by receipt id */
	errors: {}
});

/**
 * @typedef {object} Context
 * @property {Parameters<typeof extractReceipt>[0]['client']} client the bridge
 * @property {() => ({ receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection } | null)} store the open books, or null once locked
 * @property {() => (import('./blob-store.js').BlobStore | null)} blobs
 * @property {() => Promise<unknown>} [refresh] after each receipt
 */

/**
 * Read one receipt; nothing when it is being read already or the books are
 * locked. Errors are kept in `extractRun.errors`, not thrown.
 *
 * @param {Context} ctx
 * @param {import('../store/repository.js').StoredRecord} record
 * @returns {Promise<boolean>} whether it was read (successfully or not)
 */
export async function extractOne(ctx, record) {
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
		extractRun.errors = {
			...extractRun.errors,
			[record.id]: error instanceof Error ? error.message : String(error)
		};
	} finally {
		reading.delete(record.id);
		await ctx.refresh?.();
	}
	return true;
}

/**
 * "Alle neuen auslesen": the given receipts one after another. Refused (false)
 * while a run is going.
 *
 * @param {Context} ctx
 * @param {string[]} ids the receipts to read, in order
 * @returns {Promise<boolean>} whether this run started (it has ended when this resolves)
 */
export async function extractAll(ctx, ids) {
	if (extractRun.progress) return false;
	const books = ctx.store();
	if (!books) return false;
	extractRun.progress = { done: 0, count: ids.length };
	extractRun.cancelling = false;
	try {
		for (const id of ids) {
			const store = ctx.store();
			// Locked, or other books opened: stop.
			if (extractRun.cancelling || store?.receipts !== books.receipts) break;
			const record = await store.receipts.get(id);
			// Deleted, read or no longer waiting meanwhile: skip it.
			if (record && extractable([record]).length) await extractOne(ctx, record);
			extractRun.progress = { done: extractRun.progress.done + 1, count: ids.length };
		}
	} finally {
		extractRun.progress = null;
		extractRun.cancelling = false;
	}
	return true;
}

/** "Abbrechen": the receipt being read is finished, no further one is sent. */
export function cancelExtractAll() {
	if (extractRun.progress) extractRun.cancelling = true;
}

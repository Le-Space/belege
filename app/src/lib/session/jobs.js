// What a click starts over the open books (#844, B10): receipts read again, a
// run taken up, the shared folder checked. Moved out of session.svelte.js
// unchanged.
import { refresh, runMatchingNow } from './refresh.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').pairedClient} pairedClient
 * @property {typeof import('$lib/session.svelte.js').currentStore} currentStore
 * @property {typeof import('$lib/session.svelte.js').currentBlobs} currentBlobs
 */

/** @type {SessionContext} */
let host;

/** @param {SessionContext} context */
export function bindSession(context) {
	host = context;
}

/**
 * "✦ Belege der Reise neu auslesen" (#693): receipts read before, once more,
 * on the app-wide queue (receipts/extract-queue.svelte.js), then matching.
 * Only on a click.
 *
 * @param {string[]} ids
 * @returns {Promise<'started' | 'noBridge' | 'busy'>}
 */
export async function extractAgain(ids) {
	if (!host.session) return 'noBridge';
	const client = await host.pairedClient();
	if (!client) return 'noBridge';
	const { extractAll } = await import('../receipts/extract-queue.svelte.js');
	const ctx = { client, store: host.currentStore, blobs: host.currentBlobs, refresh };
	if (!(await extractAll(ctx, ids, { again: true }))) return 'busy';
	await runMatchingNow();
	return 'started';
}

/**
 * "Weitermachen" (Home): an AI run the page left behind (a reload, the books
 * locked) takes up the ids it had not done yet (jobs/pending.js). Only on a
 * click; nothing starts by itself after an unlock.
 *
 * @param {'extract' | 'suggest'} kind
 * @param {string[]} ids
 * @returns {Promise<boolean>} false without a paired bridge, or while a run goes
 */
export async function resumeJob(kind, ids) {
	if (!host.session) return false;
	const client = await host.pairedClient();
	if (!client) return false;
	if (kind === 'extract') {
		const { extractAll } = await import('../receipts/extract-queue.svelte.js');
		const ctx = { client, store: host.currentStore, blobs: host.currentBlobs, refresh };
		if (!(await extractAll(ctx, ids))) return false;
		await runMatchingNow();
		return true;
	}
	const { suggestAll } = await import('../matching/ai-suggest.svelte.js');
	const ctx = { client, store: () => /** @type {any} */ (host.currentStore()), refresh };
	const started = await suggestAll(ctx, ids);
	await refresh();
	return started;
}

/**
 * "Verwerfen" (Home): what a run left is forgotten.
 *
 * @param {'extract' | 'suggest'} kind
 */
export async function dropPendingJob(kind) {
	if (!host.session) return;
	const { savePending } = await import('../jobs/pending.js');
	await savePending(host.session.store.settings, kind, []);
}

/**
 * The shared folder, checked again (receipts/folder-watch.js): new files are
 * imported, read while "gleich auslesen" is on and a bridge is paired, and matched.
 *
 * @param {{ prompt?: boolean }} [options] `prompt` only from a click: asks for read permission
 * @returns {Promise<{ configured: boolean, permitted: boolean, created: number, counts: any, read?: number, waiting?: number, images?: number } | null>}
 */
export async function checkFolderNow({ prompt = false } = {}) {
	if (!host.session) return null;
	const { savedFolder } = await import('../receipts/folder.js');
	const handle = await savedFolder();
	if (!handle) return { configured: false, permitted: false, created: 0, counts: null };
	const { checkFolder } = await import('../receipts/folder-watch.js');
	const store = host.session.store;
	const blobs = host.session.blobs;
	const r = await checkFolder({ store, blobs, handle, prompt });
	/** @type {{ read: number, waiting: number, images: number }} */
	let reading = { read: 0, waiting: 0, images: 0 };
	if (r.created.length) {
		// Read with the model only while "gleich auslesen" is on, as an upload is (#475).
		const { getSetting } = await import('../store/settings.js');
		const readAfter = (await getSetting(store.settings, 'uploadRead'))?.readAfter !== false;
		const client = readAfter ? await host.pairedClient() : null;
		const { readNewFiles } = await import('../receipts/folder-watch.js');
		const { extractReceipt } = await import('../receipts/extract.js');
		const { needsConfirmation } = await import('../receipts/import.js');
		/** @type {any} only called when there is one (`canRead`) */
		const reader = client;
		reading = await readNewFiles({
			created: r.created,
			readAfter,
			canRead: Boolean(client),
			needsConfirmation,
			read: (record) =>
				extractReceipt({
					client: reader,
					receipts: store.receipts,
					blobs,
					record,
					events: store.events
				})
		});
		await refresh();
		await runMatchingNow();
	}
	return {
		configured: true,
		permitted: r.permitted,
		created: r.created.length,
		counts: r.counts,
		...reading
	};
}

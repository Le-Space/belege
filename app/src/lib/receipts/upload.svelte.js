// Uploading receipts (issue #308): one way in, from every page – the upload
// panel in the app frame, files dropped anywhere on a page, and the shared
// folder on Belege. Each upload is stored like any receipt (import.js: the
// duplicate check, sealed in the blob store), then read with the model at
// once where the bridge has one and the person wants it ("Nach dem
// Hochladen mit KI auslesen", settings key `uploadRead`), then matched.
//
// The state is app-wide, so the panel and Belege show the same last result.

import { createBridgeClient } from '../bridge/client.js';
import { getSetting, setSetting } from '../store/settings.js';
import { t } from '../i18n/index.js';
import { currentBlobs, currentStore, refreshNow, runMatchingNow } from '../session.svelte.js';
import { extractable } from './extract.js';
import { extractAll } from './extract-queue.svelte.js';
import { importFiles } from './import.js';

/** What a browser hands over: PDFs and the images a receipt may be. */
export const ACCEPT = '.pdf,application/pdf,image/png,image/jpeg,image/gif,image/webp';

export const upload = $state({
	busy: false,
	/** @type {string | null} */
	result: null,
	/** @type {string | null} */
	error: null,
	/** The receipts the last upload created, for "Zu den Belegen". */
	/** @type {string[]} */
	created: [],
	/** Read new receipts with the model at once (`uploadRead.readAfter`); on by default. */
	readAfter: true,
	/** Whether the paired bridge has a model to read with. */
	llm: false,
	/** @type {'upload' | 'folder' | null} what the last result was of */
	kind: null
});

/** @type {ReturnType<typeof createBridgeClient> | null} */
let client = null;

/**
 * The person's switch and the bridge's model, read when the books open and
 * when the panel opens (a bridge paired since).
 */
export async function loadUpload() {
	const store = currentStore();
	if (!store) return;
	upload.readAfter = (await getSetting(store.settings, 'uploadRead'))?.readAfter !== false;
	const saved = await getSetting(store.settings, 'bridge');
	if (!saved?.token) {
		client = null;
		upload.llm = false;
		return;
	}
	client = createBridgeClient({ url: saved.url, token: saved.token });
	try {
		upload.llm = Boolean((await client.health()).llm?.configured);
	} catch {
		upload.llm = false;
	}
}

/** @param {boolean} on */
export async function setReadAfter(on) {
	upload.readAfter = on;
	const store = currentStore();
	if (store) await setSetting(store.settings, 'uploadRead', { readAfter: on });
}

/** @param {File[]} files */
export const fromFiles = (files) =>
	files.map((f) => ({
		name: f.name,
		bytes: async () => new Uint8Array(await f.arrayBuffer())
	}));

/**
 * Store the files as receipts, read the new ones (switchable), match.
 *
 * @param {{ name: string, path?: string, bytes: () => Promise<Uint8Array> }[]} files
 * @param {'upload' | 'folder'} [kind]
 */
export async function uploadFiles(files, kind = 'upload') {
	const store = currentStore();
	const blobs = currentBlobs();
	if (!store || !blobs || files.length === 0 || upload.busy) return;
	upload.busy = true;
	upload.kind = kind;
	upload.error = null;
	upload.result = null;
	upload.created = [];
	/** @type {import('../store/repository.js').StoredRecord[]} */
	const created = [];
	try {
		const c = await importFiles({ receipts: store.receipts, blobs, files, source: kind, created });
		upload.result = t('belege.importResult', {
			new: c.new,
			duplicate: c.duplicate,
			unsupported: c.unsupported
		});
		upload.created = created.map((r) => String(r.id));
		await refreshNow();
	} catch (error) {
		upload.error = error instanceof Error ? error.message : String(error);
	} finally {
		upload.busy = false;
	}
	if (!created.length) return;
	// Read the new ones right away (switchable), through the app-wide queue,
	// then match them – as after a mail fetch.
	const toRead = extractable(created).map((r) => r.id);
	if (upload.readAfter && client && upload.llm && toRead.length) {
		await extractAll(
			{ client, store: currentStore, blobs: currentBlobs, refresh: refreshNow },
			toRead
		);
	}
	await runMatchingNow();
}

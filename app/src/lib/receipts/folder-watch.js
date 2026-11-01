// The shared folder (folder.js), checked again: on "Ordner jetzt prüfen" in
// a booking's detail view, and every minute while the app is open and
// visible. Only files whose path is new are read; what is new is imported
// like any folder file (sealed, deduplicated by content).
//
// The periodic check never asks for permission: a browser grants folder
// access only from a click, so without it granted this session the timer does
// nothing until the person clicks a button that asks.
//
// What is new is read with the model only while "gleich auslesen" is on – the
// switch beside the upload (`uploadRead.readAfter`), which the folder follows
// as the upload does (#475). Otherwise the files wait under Belege → Neu for
// "Alle neuen auslesen". A receipt whose sender needs confirming waits for
// that; an image without text is marked by the extraction as unreadable,
// never sent.

import { ensurePermission, listFolderFiles } from './folder.js';
import { importFiles } from './import.js';

export const WATCH_INTERVAL_MS = 60_000;

/**
 * @param {object} params
 * @param {{ receipts: import('../store/repository.js').Collection, events?: import('../store/repository.js').Collection }} params.store
 * @param {import('./blob-store.js').BlobStore} params.blobs
 * @param {any} params.handle the saved FileSystemDirectoryHandle
 * @param {boolean} [params.prompt] ask for permission (only from a click)
 * @param {(handle: any) => Promise<{ name: string, path: string, bytes: () => Promise<Uint8Array> }[]>} [params.list]
 * @returns {Promise<{ permitted: boolean, counts: { new: number, duplicate: number, unsupported: number, known: number } | null, created: import('../store/repository.js').StoredRecord[] }>}
 */
export async function checkFolder({
	store,
	blobs,
	handle,
	prompt = false,
	list = listFolderFiles
}) {
	const permitted = prompt
		? await ensurePermission(handle)
		: (await handle?.queryPermission?.({ mode: 'read' })) === 'granted';
	if (!permitted) return { permitted: false, counts: null, created: [] };
	/** @type {import('../store/repository.js').StoredRecord[]} */
	const created = [];
	const counts = await importFiles({
		receipts: store.receipts,
		blobs,
		files: await list(handle),
		source: 'folder',
		skipKnown: true,
		created,
		events: store.events
	});
	return { permitted: true, counts, created };
}

/**
 * Run `check` every `intervalMs` while the page is visible, one at a time.
 *
 * @param {() => Promise<unknown>} check
 * @param {{ intervalMs?: number, visible?: () => boolean }} [options]
 * @returns {() => void} stops it
 */
export function watchFolder(
	check,
	{
		intervalMs = WATCH_INTERVAL_MS,
		visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
	} = {}
) {
	let running = false;
	const timer = setInterval(async () => {
		if (running || !visible()) return;
		running = true;
		try {
			await check();
		} catch (error) {
			console.error('folder check failed:', error);
		} finally {
			running = false;
		}
	}, intervalMs);
	return () => clearInterval(timer);
}

/**
 * Read what a folder check brought, as the switch says (#475).
 *
 * @param {object} params
 * @param {import('../store/repository.js').StoredRecord[]} params.created
 * @param {boolean} params.readAfter the person's "gleich auslesen"
 * @param {boolean} params.canRead a bridge is paired
 * @param {(record: import('../store/repository.js').StoredRecord) => boolean} params.needsConfirmation
 * @param {(record: import('../store/repository.js').StoredRecord) => Promise<unknown>} params.read
 * @returns {Promise<{ read: number, waiting: number, images: number }>} read: sent to the model;
 *   waiting: left for "Auslesen" (switch off, no bridge, a sender to confirm); images: no text to send
 */
export async function readNewFiles({ created, readAfter, canRead, needsConfirmation, read }) {
	let sent = 0;
	let waiting = 0;
	let images = 0;
	for (const record of created) {
		if (needsConfirmation(record) || !readAfter || !canRead) {
			waiting++;
			continue;
		}
		const image = String(record.mime ?? '').startsWith('image/');
		try {
			// An image is marked unreadable by the extraction itself, without a request.
			await read(record);
			if (image) images++;
			else sent++;
		} catch (error) {
			console.error('reading a folder file failed:', error);
			waiting++;
		}
	}
	return { read: sent, waiting, images };
}

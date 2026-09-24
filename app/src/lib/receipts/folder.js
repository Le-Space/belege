// "Ordner freigeben": a local folder of receipts, read with the File System
// Access API (Chromium browsers only; the button is hidden elsewhere).
//
// The directory handle is kept in a small IndexedDB database of its own
// (`belege/folder`), unencrypted: it is a permission token for one folder the
// browser already knows about, not a secret, and it holds no file contents.
// The folder's name is readable there. Read permission is asked for again in
// every session, from a click.

const DB = 'belege/folder';
const STORE = 'handles';
const KEY = 'receipts';
const MAX_DEPTH = 3;
const EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp)$/i;

export function folderSupported() {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** @returns {Promise<IDBDatabase>} */
function openDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * @param {'readonly' | 'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 */
async function withStore(mode, fn) {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const request = fn(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

/** @returns {Promise<any | null>} the stored FileSystemDirectoryHandle */
export async function savedFolder() {
	if (!folderSupported()) return null;
	try {
		return (await withStore('readonly', (s) => s.get(KEY))) ?? null;
	} catch {
		return null;
	}
}

/** Asks the person for a folder (needs a click) and remembers it. */
export async function pickFolder() {
	const handle = await /** @type {any} */ (window).showDirectoryPicker({
		id: 'belege-receipts',
		mode: 'read'
	});
	await withStore('readwrite', (s) => s.put(handle, KEY));
	return handle;
}

export async function forgetFolder() {
	await withStore('readwrite', (s) => s.delete(KEY));
}

/**
 * Read permission for this session (needs a click the first time).
 *
 * @param {any} handle
 */
export async function ensurePermission(handle) {
	const opts = { mode: 'read' };
	if ((await handle.queryPermission?.(opts)) === 'granted') return true;
	return (await handle.requestPermission?.(opts)) === 'granted';
}

/**
 * The receipt-like files in a folder and its subfolders (3 levels).
 *
 * @param {any} handle a FileSystemDirectoryHandle, or anything with the same `values()`
 * @returns {Promise<{ name: string, path: string, bytes: () => Promise<Uint8Array> }[]>}
 */
export async function listFolderFiles(handle, prefix = '', depth = 0) {
	/** @type {{ name: string, path: string, bytes: () => Promise<Uint8Array> }[]} */
	const out = [];
	for await (const entry of handle.values()) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.kind === 'directory') {
			if (depth + 1 < MAX_DEPTH && !entry.name.startsWith('.')) {
				out.push(...(await listFolderFiles(entry, path, depth + 1)));
			}
		} else if (entry.kind === 'file' && EXTENSIONS.test(entry.name)) {
			out.push({
				name: entry.name,
				path,
				bytes: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer())
			});
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Factory reset of this browser (issue #212): everything Belege keeps for this
// site – every IndexedDB database (the books, the receipt files, the folder
// handle), the app's caches and its service worker, localStorage and
// sessionStorage.
//
// Deleting a database that is still open only waits: OrbitDB, Helia and the
// blockstore hold theirs until the page goes. So the reset is done in two
// steps. `requestReset` leaves a mark in sessionStorage and reloads; the fresh
// page, which has opened nothing yet, finds the mark (`resetPending`), wipes
// (`wipeBrowser`) and starts over at the consent screen. The mark is in
// sessionStorage so it dies with the tab and can never fire in another one.
//
// What a page cannot delete: the passkey (it lives in the password manager),
// copies on other own devices, and what the bridge keeps on the computer.
//
// The environment is passed in, so a test decides what the browser holds.

export const RESET_MARK = 'belege.reset-pending';

/**
 * Whether what was typed is the word to confirm with (`storage.reset.word` in
 * the catalogue); case and spaces around it do not matter.
 *
 * @param {string} typed
 * @param {string} word
 */
export const confirmsReset = (typed, word) =>
	Boolean(word) &&
	String(typed ?? '')
		.trim()
		.toUpperCase() === word.toUpperCase();

/**
 * IndexedDB databases to delete when the browser cannot list them
 * (`indexedDB.databases` is missing): the names Belege is known to use.
 */
export const KNOWN_DATABASES = Object.freeze([
	'belege/helia-blocks',
	'belege/helia-data',
	'belege/orbitdb',
	'belege/folder',
	'level-js-belege/orbitdb/keystore'
]);

/**
 * @typedef {object} BrowserEnv what the wipe touches; `globalThis` in the app
 * @property {IDBFactory} [indexedDB]
 * @property {CacheStorage} [caches]
 * @property {{ serviceWorker?: { getRegistrations: () => Promise<readonly { unregister: () => Promise<boolean> }[]> } }} [navigator]
 * @property {Storage} [localStorage]
 * @property {Storage} [sessionStorage]
 */

/**
 * Leave the mark and reload: the wipe runs on the fresh page.
 *
 * @param {{ sessionStorage: Storage, location: { reload: () => void } }} [env]
 */
export function requestReset(env = globalThis) {
	env.sessionStorage.setItem(RESET_MARK, new Date().toISOString());
	env.location.reload();
}

/** @param {{ sessionStorage?: Storage }} [env] */
export function resetPending(env = globalThis) {
	try {
		return env.sessionStorage?.getItem(RESET_MARK) != null;
	} catch {
		return false;
	}
}

/**
 * @param {IDBFactory} idb
 * @param {string} name
 * @returns {Promise<'deleted' | 'blocked' | 'failed'>}
 */
function deleteDatabase(idb, name) {
	return new Promise((resolve) => {
		const request = idb.deleteDatabase(name);
		request.onsuccess = () => resolve('deleted');
		request.onerror = () => resolve('failed');
		// Still open somewhere (another tab): it goes when that closes.
		request.onblocked = () => resolve('blocked');
	});
}

/**
 * Delete everything this site keeps in this browser.
 *
 * @param {BrowserEnv} [env]
 * @returns {Promise<{ databases: string[], blocked: string[], failed: string[], caches: string[], workers: number, listed: boolean, done: boolean }>}
 *   `blocked`: still open in another tab; `listed`: the browser listed its databases;
 *   `done`: every database went – only then are the storages cleared, the mark with them
 */
export async function wipeBrowser(env = globalThis) {
	const report = {
		databases: /** @type {string[]} */ ([]),
		blocked: /** @type {string[]} */ ([]),
		failed: /** @type {string[]} */ ([]),
		caches: /** @type {string[]} */ ([]),
		workers: 0,
		listed: false,
		done: false
	};

	// The service worker first, so it cannot answer from a cache being deleted.
	try {
		const registrations = (await env.navigator?.serviceWorker?.getRegistrations()) ?? [];
		for (const r of registrations) if (await r.unregister()) report.workers++;
	} catch {
		// No service worker here.
	}
	try {
		for (const name of (await env.caches?.keys()) ?? []) {
			if (await env.caches?.delete(name)) report.caches.push(name);
		}
	} catch {
		// No Cache Storage here.
	}

	const idb = env.indexedDB;
	if (idb) {
		/** @type {string[]} */
		let names = [...KNOWN_DATABASES];
		try {
			if (typeof idb.databases === 'function') {
				names = (await idb.databases()).map((d) => String(d.name ?? '')).filter(Boolean);
				report.listed = true;
			}
		} catch {
			// The list is refused: the known names, then.
		}
		for (const name of names) {
			const outcome = await deleteDatabase(idb, name);
			if (outcome === 'deleted') report.databases.push(name);
			else report[outcome].push(name);
		}
	}

	// A database another tab holds open is not gone yet: keep the mark, so the
	// wipe runs again once that tab is closed.
	if (report.blocked.length || report.failed.length) return report;
	report.done = true;
	// Last: the mark is in sessionStorage, so an interrupted wipe runs again.
	try {
		env.localStorage?.clear();
	} catch {
		// Storage is blocked.
	}
	try {
		env.sessionStorage?.clear();
	} catch {
		// Storage is blocked.
	}
	return report;
}

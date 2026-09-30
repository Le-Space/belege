import { describe, expect, it } from 'vitest';

import {
	KNOWN_DATABASES,
	RESET_MARK,
	confirmsReset,
	requestReset,
	resetPending,
	wipeBrowser
} from './reset.js';
import { storageSummary } from './summary.js';

/** A Storage as the browser has it. @param {Record<string, string>} [initial] */
function fakeStorage(initial = {}) {
	const map = new Map(Object.entries(initial));
	return /** @type {any} */ ({
		getItem: (/** @type {string} */ k) => map.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, String(v)),
		clear: () => map.clear(),
		get length() {
			return map.size;
		}
	});
}

/**
 * An IndexedDB with named databases; `blocked` ones are open in another tab.
 *
 * @param {string[]} names
 * @param {{ blocked?: string[], list?: boolean }} [options]
 */
function fakeIndexedDB(names, { blocked = [], list = true } = {}) {
	const left = new Set(names);
	/** @type {string[]} */
	const asked = [];
	const idb = {
		deleteDatabase(/** @type {string} */ name) {
			asked.push(name);
			/** @type {any} */
			const request = {};
			queueMicrotask(() => {
				if (blocked.includes(name)) return request.onblocked?.();
				left.delete(name);
				request.onsuccess?.();
			});
			return request;
		},
		...(list ? { databases: async () => [...left].map((name) => ({ name, version: 1 })) } : {})
	};
	return { idb: /** @type {any} */ (idb), left, asked };
}

describe('factory reset of this browser (#212)', () => {
	it('the word of the language shown, whatever the case – and nothing else', () => {
		for (const typed of ['LÖSCHEN', ' löschen '])
			expect(confirmsReset(typed, 'LÖSCHEN')).toBe(true);
		expect(confirmsReset('delete', 'DELETE')).toBe(true);
		for (const typed of ['', 'ja', 'LOESCHEN', 'DELETE']) {
			expect(confirmsReset(typed, 'LÖSCHEN'), typed).toBe(false);
		}
		expect(confirmsReset('', '')).toBe(false);
	});

	it('is asked for in one page and done in the next: a mark, a reload', () => {
		const sessionStorage = fakeStorage();
		let reloads = 0;
		expect(resetPending({ sessionStorage })).toBe(false);
		requestReset({ sessionStorage, location: { reload: () => reloads++ } });
		expect(reloads).toBe(1);
		expect(resetPending({ sessionStorage })).toBe(true);
	});

	it('wipes every database, the caches, the service worker and both storages', async () => {
		const { idb, left } = fakeIndexedDB(['belege/helia-blocks', 'belege/orbitdb', 'other-db']);
		const cacheNames = new Set(['belege-shell-v1']);
		let unregistered = 0;
		const localStorage = fakeStorage({ 'belege.consent': 'x', 'belege.locale': 'de' });
		const sessionStorage = fakeStorage({ [RESET_MARK]: 'now' });
		const report = await wipeBrowser({
			indexedDB: idb,
			caches: /** @type {any} */ ({
				keys: async () => [...cacheNames],
				delete: async (/** @type {string} */ n) => cacheNames.delete(n)
			}),
			navigator: {
				serviceWorker: {
					getRegistrations: async () => [{ unregister: async () => (unregistered++, true) }]
				}
			},
			localStorage,
			sessionStorage
		});
		expect(report).toEqual({
			databases: ['belege/helia-blocks', 'belege/orbitdb', 'other-db'],
			blocked: [],
			failed: [],
			caches: ['belege-shell-v1'],
			workers: 1,
			listed: true,
			done: true
		});
		expect(left.size).toBe(0);
		expect([localStorage.length, sessionStorage.length, unregistered]).toEqual([0, 0, 1]);
		expect(resetPending({ sessionStorage })).toBe(false);
	});

	it('a database open in another tab is reported, not silently kept', async () => {
		const { idb } = fakeIndexedDB(['belege/orbitdb', 'belege/folder'], {
			blocked: ['belege/orbitdb']
		});
		const report = await wipeBrowser({ indexedDB: idb });
		const sessionStorage = fakeStorage({ [RESET_MARK]: 'now' });
		const localStorage = fakeStorage({ 'belege.consent': 'x' });
		const again = await wipeBrowser({ indexedDB: idb, sessionStorage, localStorage });
		expect(report.blocked).toEqual(['belege/orbitdb']);
		expect(report.databases).toEqual(['belege/folder']);
		// Not done: the mark stays, so the next load tries again.
		expect([report.done, again.done, resetPending({ sessionStorage })]).toEqual([
			false,
			false,
			true
		]);
		expect(localStorage.length).toBe(1);
	});

	it('a browser that cannot list its databases gets the known names', async () => {
		const { idb, asked } = fakeIndexedDB([], { list: false });
		const report = await wipeBrowser({ indexedDB: idb });
		expect(asked).toEqual([...KNOWN_DATABASES]);
		expect(report.listed).toBe(false);
	});

	it('works without a service worker, caches or storage', async () => {
		expect(await wipeBrowser({})).toMatchObject({ databases: [], caches: [], workers: 0 });
	});
});

describe('what the books take (#212)', () => {
	it('per database, the files, and the rest of what the browser counts', () => {
		const s = storageSummary({
			logs: {
				transactions: { entries: 30, bytes: 60_000 },
				receipts: { entries: 4, bytes: 9_000 }
			},
			records: { transactions: 12, receipts: 2 },
			files: { files: 2, fileBytes: 400_000 },
			estimate: { usage: 1_000_000, quota: 5_000_000_000 }
		});
		expect(s.databases).toHaveLength(8);
		expect(s.databases[0]).toEqual({
			name: 'transactions',
			records: 12,
			entries: 30,
			bytes: 60_000
		});
		expect(s.databases.find((d) => d.name === 'events')).toMatchObject({ records: 0, bytes: 0 });
		expect([s.databaseBytes, s.fileBytes, s.otherBytes]).toEqual([69_000, 400_000, 531_000]);
	});

	it('no estimate from the browser: the rest is unknown, never negative', () => {
		const base = { logs: {}, records: {}, files: { files: 0, fileBytes: 900 } };
		expect(storageSummary({ ...base, estimate: null }).otherBytes).toBeNull();
		expect(storageSummary({ ...base, estimate: { usage: 100, quota: 1 } }).otherBytes).toBe(0);
	});
});

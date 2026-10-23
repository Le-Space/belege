// The catch-up runs (#473, catch-up.js): which entries that came by sync call
// for a run, the books' fingerprint, the marker per DID, and the debounce.
import { describe, expect, it, vi } from 'vitest';

import {
	LAST_RUN_KEY,
	callsForRun,
	debounced,
	fingerprint,
	lastRunOf,
	noteRun
} from './catch-up.js';

/** A Storage in memory. @returns {Storage} */
function memoryStorage() {
	const map = new Map();
	return /** @type {any} */ ({
		getItem: (/** @type {string} */ k) => map.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => map.delete(k)
	});
}

describe('catching up on matching', () => {
	it('runs for payments, receipts, links and the matching settings that came – not for the rest', () => {
		const came = (/** @type {string} */ collection, what = {}) =>
			callsForRun({ direction: 'in', collection, what });
		expect(['transactions', 'receipts', 'matches'].every((c) => came(c))).toBe(true);
		expect(came('settings', { key: 'matching' })).toBe(true);
		expect(came('settings', { key: 'backups' })).toBe(false);
		expect(came('events')).toBe(false);
		expect(came('questions')).toBe(false);
		expect(callsForRun({ direction: 'out', collection: 'transactions', what: {} })).toBe(false);
	});

	it('the fingerprint changes with a new entry, even one dated before the last run', () => {
		const books = {
			transactions: [{ updatedAt: '2026-10-23T10:00:00Z' }],
			receipts: [],
			matches: []
		};
		const before = fingerprint(books);
		expect(fingerprint({ ...books, receipts: [{ updatedAt: '2026-10-01T00:00:00Z' }] })).not.toBe(
			before
		);
		expect(fingerprint({ ...books })).toBe(before);
	});

	it('keeps the marker per DID in this browser', () => {
		const storage = memoryStorage();
		expect(lastRunOf(storage, 'did:key:a')).toBeNull();
		noteRun(storage, 'did:key:a', '1/0/0/x');
		noteRun(storage, 'did:key:b', '2/0/0/y');
		expect(lastRunOf(storage, 'did:key:a')).toBe('1/0/0/x');
		expect(JSON.parse(String(storage.getItem(LAST_RUN_KEY)))).toEqual({
			'did:key:a': '1/0/0/x',
			'did:key:b': '2/0/0/y'
		});
	});

	it('a burst of entries makes one run, once it is quiet', () => {
		vi.useFakeTimers();
		try {
			const run = vi.fn();
			const soon = debounced(run, 5000);
			for (let i = 0; i < 20; i++) {
				soon();
				vi.advanceTimersByTime(100);
			}
			expect(run).not.toHaveBeenCalled();
			vi.advanceTimersByTime(5000);
			expect(run).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

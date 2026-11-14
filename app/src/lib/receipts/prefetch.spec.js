// The background prefetch of receipt files (prefetch.js): what it brings,
// when it waits, and that it brings nothing while it may not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backoff, createFilePrefetcher, filesOf } from './prefetch.js';

/**
 * Blobs in small: `here` is what this device holds, `there` what the own
 * devices could give; `fail` makes the next fetches of a CID throw.
 */
function fakeBlobs(/** @type {string[]} */ here = [], /** @type {string[]} */ there = []) {
	const held = new Set(here);
	const offered = new Set(there);
	/** @type {string[]} */
	const fetched = [];
	let inFlight = 0;
	let most = 0;
	/** @type {Record<string, number>} */
	const sizes = {};
	return {
		held,
		offered,
		fetched,
		sizes,
		most: () => most,
		has: async (/** @type {string} */ cid) => held.has(cid),
		async fetch(/** @type {string} */ cid, /** @type {any} */ { maxBytes = Infinity } = {}) {
			if (held.has(cid)) return /** @type {const} */ ('here');
			if ((sizes[cid] ?? 0) > maxBytes) return /** @type {const} */ ('too-large');
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 10));
			inFlight--;
			fetched.push(cid);
			if (!offered.has(cid)) throw new Error('nobody has it');
			held.add(cid);
			return /** @type {const} */ ('fetched');
		}
	};
}

const receipt = (/** @type {string} */ id, /** @type {Record<string, any>} */ more = {}) => ({
	id,
	fileCid: `cid-${id}`,
	...more
});

describe('filesOf', () => {
	it('the document, an e-invoice’s XML and a mail; nothing of a deleted receipt', () => {
		expect(filesOf({ fileCid: 'a', xmlCid: 'b', emlCid: null })).toEqual(['a', 'b']);
		expect(filesOf({ fileCid: 'a', deleted: true })).toEqual([]);
		expect(filesOf({ excerpt: 'text only' })).toEqual([]);
	});
});

describe('backoff', () => {
	it('doubles from the first wait, up to the most', () => {
		expect([1, 2, 3, 4, 10].map((n) => backoff(n, 30, 200))).toEqual([30, 60, 120, 200, 200]);
	});
});

describe('file prefetch', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	/** Run the timers until the prefetcher is idle. */
	const settle = async (ms = 100) => {
		await vi.advanceTimersByTimeAsync(ms);
	};

	it('brings what the receipts name and this device lacks, and tells what is missing', async () => {
		const blobs = fakeBlobs(['cid-1'], ['cid-2', 'cid-3']);
		/** @type {any[]} */
		const states = [];
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => [
				receipt('1'),
				receipt('2'),
				receipt('3'),
				receipt('4', { deleted: true })
			],
			canFetch: () => true,
			onState: (s) => states.push(s)
		});
		const run = prefetch.run();
		await settle();
		await run;
		expect(blobs.fetched.sort()).toEqual(['cid-2', 'cid-3']);
		expect(states.at(-1)).toEqual({ missing: [], fetching: [] });
		expect(states.some((s) => s.missing.includes('cid-2'))).toBe(true);
		prefetch.stop();
	});

	it('a few at a time', async () => {
		const ids = Array.from({ length: 8 }, (_, i) => String(i));
		const blobs = fakeBlobs(
			[],
			ids.map((i) => `cid-${i}`)
		);
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => ids.map((i) => receipt(i)),
			canFetch: () => true,
			concurrency: 2
		});
		const run = prefetch.run();
		await settle(200);
		await run;
		expect(blobs.fetched).toHaveLength(8);
		expect(blobs.most()).toBe(2);
		prefetch.stop();
	});

	it('brings nothing while it may not – paused, or no own device – but says what is missing', async () => {
		const blobs = fakeBlobs([], ['cid-1']);
		let allowed = false;
		/** @type {any} */
		let last = null;
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => [receipt('1')],
			canFetch: () => allowed,
			onState: (s) => (last = s)
		});
		await prefetch.run();
		expect(blobs.fetched).toEqual([]);
		expect(last.missing).toEqual(['cid-1']);
		// An own device connected.
		allowed = true;
		prefetch.retryAll();
		await settle(2_000);
		expect(blobs.fetched).toEqual(['cid-1']);
		expect(last.missing).toEqual([]);
		prefetch.stop();
	});

	it('a file that does not come is tried again later, each time after a longer wait', async () => {
		const blobs = fakeBlobs([], []);
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => [receipt('1')],
			canFetch: () => true,
			retryMs: 1_000,
			retryMaxMs: 10_000
		});
		await settle(0);
		const run = prefetch.run();
		await settle(20);
		await run;
		expect(blobs.fetched).toHaveLength(1);
		// Asked again soon after (a burst of records): still waiting.
		prefetch.kick();
		await settle(1_100 - 20);
		expect(blobs.fetched).toHaveLength(2); // after 1 s
		await settle(1_500);
		expect(blobs.fetched).toHaveLength(2); // the next one after 2 s
		await settle(600);
		expect(blobs.fetched).toHaveLength(3);
		// Then someone has it.
		blobs.offered.add('cid-1');
		await settle(4_100);
		expect(blobs.fetched).toHaveLength(4);
		expect(blobs.held.has('cid-1')).toBe(true);
		await settle(60_000);
		expect(blobs.fetched).toHaveLength(4);
		prefetch.stop();
	});

	it('a file too large is left for when it is opened, and not asked for again', async () => {
		const blobs = fakeBlobs([], ['cid-1']);
		blobs.sizes['cid-1'] = 100;
		/** @type {any} */
		let last = null;
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => [receipt('1')],
			canFetch: () => true,
			maxBytes: 50,
			onState: (s) => (last = s)
		});
		await prefetch.run();
		await prefetch.run();
		expect(blobs.fetched).toEqual([]);
		expect(last.missing).toEqual(['cid-1']);
		prefetch.stop();
	});

	it('a receipt that came by sync: looked at after the burst', async () => {
		const blobs = fakeBlobs([], ['cid-1', 'cid-2']);
		/** @type {any[]} */
		const list = [];
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => list,
			canFetch: () => true,
			debounceMs: 500
		});
		await prefetch.run();
		list.push(receipt('1'));
		prefetch.kick();
		list.push(receipt('2'));
		prefetch.kick();
		await settle(400);
		expect(blobs.fetched).toEqual([]);
		await settle(200);
		expect(blobs.fetched.sort()).toEqual(['cid-1', 'cid-2']);
		prefetch.stop();
	});

	it('stopped: nothing more', async () => {
		const blobs = fakeBlobs([], ['cid-1']);
		const prefetch = createFilePrefetcher({
			blobs,
			receipts: async () => [receipt('1')],
			canFetch: () => true
		});
		prefetch.stop();
		prefetch.kick();
		await prefetch.run();
		await settle(5_000);
		expect(blobs.fetched).toEqual([]);
	});
});

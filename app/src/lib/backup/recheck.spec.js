// Asking Aleph again after a run left a backup pending: when, and when it
// stops. Made-up CIDs and item hashes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKUPS_KEY, loadBackups } from './history.js';
import { RECHECK_AFTER_MS, anyPending, recheckPending, settlePending } from './recheck.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Let the pending promises of a question settle. */
const settled = () => vi.advanceTimersByTimeAsync(0);

describe('recheckPending', () => {
	it('asks after 15 s, 45 s, 2 min and 5 min, then stops', async () => {
		/** @type {number[]} */
		const at = [];
		const ask = vi.fn(async () => (at.push(Date.now()), true));
		const start = Date.now();
		recheckPending({ ask });
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(at.map((t) => t - start)).toEqual(RECHECK_AFTER_MS);
		expect(RECHECK_AFTER_MS).toEqual([15_000, 45_000, 120_000, 300_000]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('stops once nothing is pending', async () => {
		const answers = [true, false];
		const ask = vi.fn(async () => Boolean(answers.shift()));
		recheckPending({ ask });
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(ask).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('stops when the card is left, and asks nothing after', async () => {
		const ask = vi.fn(async () => true);
		const stop = recheckPending({ ask });
		await vi.advanceTimersByTimeAsync(15_000);
		expect(ask).toHaveBeenCalledTimes(1);
		stop();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(ask).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('stops while a question is out: its answer starts nothing more', async () => {
		/** @type {(v: boolean) => void} */
		let answer = () => {};
		const ask = vi.fn(() => new Promise((resolve) => (answer = resolve)));
		const stop = recheckPending({ ask: /** @type {any} */ (ask) });
		await vi.advanceTimersByTimeAsync(15_000);
		stop();
		answer(true);
		await settled();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(ask).toHaveBeenCalledTimes(1);
	});

	it('asks nothing while the network is paused, and stops', async () => {
		let paused = false;
		const ask = vi.fn(async () => true);
		recheckPending({ ask, stopped: () => paused });
		await vi.advanceTimersByTimeAsync(15_000);
		paused = true;
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(ask).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('a failed question counts as still pending', async () => {
		const ask = vi.fn(async () => {
			throw new Error('offline');
		});
		recheckPending({ ask, after: [1_000, 2_000] });
		await vi.advanceTimersByTimeAsync(5_000);
		expect(ask).toHaveBeenCalledTimes(2);
	});
});

/** The settings collection, in memory. */
function memorySettings() {
	/** @type {any[]} */
	const rows = [];
	return /** @type {any} */ ({
		list: async (/** @type {any} */ { where = () => true } = {}) => rows.filter(where),
		put: async (/** @type {any} */ r) => {
			const i = rows.findIndex((x) => x.key === r.key);
			if (i >= 0) rows[i] = r;
			else rows.push(r);
			return r;
		}
	});
}

/** @param {Partial<import('./history.js').BackupRecord>} b */
const row = (b) =>
	/** @type {import('./history.js').BackupRecord} */ ({
		at: '2026-10-20T10:00:00Z',
		provider: 'aleph',
		size: 1_000,
		status: 'pending',
		entries: 1,
		files: 0,
		missing: 0,
		kind: 'increment',
		base: 'QmFull',
		sequence: 1,
		cid: 'QmOne',
		itemHash: 'a'.repeat(64),
		...b
	});

describe('settlePending', () => {
	it('asks only about pending backups and keeps the answer', async () => {
		const settings = memorySettings();
		await settings.put({
			key: BACKUPS_KEY,
			value: [
				row({ cid: 'QmTwo', sequence: 2, itemHash: 'b'.repeat(64) }),
				row({}),
				row({ cid: 'QmFull', kind: 'full', status: 'processed', itemHash: 'c'.repeat(64) })
			]
		});
		const answer = vi.fn(async ({ itemHash }) =>
			itemHash === 'a'.repeat(64) ? { status: 'processed' } : { status: 'rejected', errorCode: 6 }
		);
		const now = await settlePending(settings, /** @type {any} */ ({}), /** @type {any} */ (answer));
		expect(answer).toHaveBeenCalledTimes(2);
		expect(now.map((b) => [b.cid, b.status, b.errorCode])).toEqual([
			['QmTwo', 'rejected', 6],
			['QmOne', 'processed', undefined],
			['QmFull', 'processed', undefined]
		]);
		expect(await loadBackups(settings)).toEqual(now);
		expect(anyPending(now)).toBe(false);
	});

	it('an unanswered question leaves it pending', async () => {
		const settings = memorySettings();
		await settings.put({ key: BACKUPS_KEY, value: [row({})] });
		const now = await settlePending(settings, /** @type {any} */ ({}), async () => {
			throw new Error('offline');
		});
		expect(anyPending(now)).toBe(true);
	});
});

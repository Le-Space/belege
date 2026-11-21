import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEADS_RETRY_MS, isVerdict, retryLostHeads } from './heads-retry.js';

/** A database as far as the retry looks at it: its events, its log's join, its sync. */
function fakeDb() {
	/** @type {(entry: any) => Promise<boolean>} */
	let join = async () => true;
	const db = {
		events: new EventEmitter(),
		log: { joinEntry: (/** @type {any} */ entry) => join(entry) },
		restarts: 0,
		/** @type {string[]} */
		calls: [],
		sync: {
			stop: async () => void db.calls.push('stop'),
			start: async () => {
				db.calls.push('start');
				db.restarts++;
			}
		},
		/** @param {(entry: any) => Promise<boolean>} fn */
		joins(fn) {
			join = fn;
		}
	};
	return db;
}

const timeout = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
/** What the database does with a head it was given: it swallows a failed join. */
const given = async (/** @type {any} */ db) => {
	try {
		await db.log.joinEntry({ hash: 'zdpuExampleHead' });
	} catch {
		// As database.js does (it logs to the console).
	}
};

describe('a heads exchange that was lost', () => {
	beforeEach(() => void vi.useFakeTimers());
	afterEach(() => void vi.useRealTimers());

	it('is asked for again when the entries behind a head could not be fetched', async () => {
		const db = fakeDb();
		db.joins(async () => {
			throw timeout();
		});
		retryLostHeads(db);
		await given(db);
		// The exchange is reported as done all the same.
		db.events.emit('join', 'peer', []);
		expect(db.restarts).toBe(0);
		await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[0]);
		expect(db.calls).toEqual(['stop', 'start']);
	});

	it('is asked for again when the exchange itself broke', async () => {
		const db = fakeDb();
		retryLostHeads(db);
		db.events.emit('error', Object.assign(new Error('reset'), { name: 'StreamResetError' }));
		await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[0]);
		expect(db.restarts).toBe(1);
	});

	it('waits longer each time in a row, and then stops asking', async () => {
		const db = fakeDb();
		db.joins(async () => {
			throw timeout();
		});
		/** @type {number[]} */
		const attempts = [];
		retryLostHeads(db, { onRetry: (n) => attempts.push(n) });
		for (let i = 0; i < HEADS_RETRY_MS.length; i++) {
			await given(db);
			await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[i] - 1);
			expect(db.restarts).toBe(i);
			await vi.advanceTimersByTimeAsync(1);
			expect(db.restarts).toBe(i + 1);
		}
		expect(attempts).toEqual(HEADS_RETRY_MS.map((_, i) => i + 1));
		// Lost once more: nobody is asked a fifth time in a row.
		await given(db);
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(db.restarts).toBe(HEADS_RETRY_MS.length);
	});

	it('starts the count over after an exchange that ran through', async () => {
		const db = fakeDb();
		let fail = true;
		db.joins(async () => {
			if (fail) throw timeout();
			return true;
		});
		retryLostHeads(db);
		await given(db);
		await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[0]);
		expect(db.restarts).toBe(1);
		// The second exchange brings the entries.
		fail = false;
		await given(db);
		db.events.emit('join', 'peer', [{}]);
		// A later loss is the first of a new row: asked again after the short wait.
		fail = true;
		await given(db);
		await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[0]);
		expect(db.restarts).toBe(2);
	});

	it('several losses before the asking make one asking', async () => {
		const db = fakeDb();
		retryLostHeads(db);
		for (let i = 0; i < 5; i++) db.events.emit('error', timeout());
		await vi.advanceTimersByTimeAsync(HEADS_RETRY_MS[0] + HEADS_RETRY_MS[1]);
		expect(db.restarts).toBe(1);
	});

	it('leaves alone what asking again cannot change', async () => {
		const db = fakeDb();
		retryLostHeads(db);
		// A verdict on the entry, here and from the exchange …
		const refused = new Error(
			'Could not append entry:\nKey "zdpuExampleKey" is not allowed to write to the log'
		);
		expect(isVerdict(refused)).toBe(true);
		db.joins(async () => {
			throw refused;
		});
		await given(db);
		db.events.emit('error', refused);
		// … a dial refused on a relay's limited connection, a peer without this database.
		db.events.emit(
			'error',
			Object.assign(new Error('limited'), { name: 'LimitedConnectionError' })
		);
		db.events.emit('error', Object.assign(new Error('none'), { name: 'UnsupportedProtocolError' }));
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(db.restarts).toBe(0);
	});

	it('passes the join through, its answer and its failure', async () => {
		const db = fakeDb();
		db.joins(async () => false);
		const stop = retryLostHeads(db);
		expect(await db.log.joinEntry({})).toBe(false);
		db.joins(async () => {
			throw timeout();
		});
		await expect(db.log.joinEntry({})).rejects.toThrow('aborted');
		// Stopped: nothing asked any more, the log's own join back in place.
		stop();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(db.restarts).toBe(0);
		expect(db.events.listenerCount('error')).toBe(0);
	});
});

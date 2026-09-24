// The grace period: no "Fehlender Beleg" question until a booking is older
// than graceDays; until then it waits (and still counts as uncovered).
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { setSetting } from '../store/settings.js';
import { tx } from './fixtures.js';
import { runMatching } from './engine.js';
import { bookingAgeDays, graceWait, localDay } from './grace.js';
import { isTxCovered } from './view.js';

const TODAY = '2026-09-24';
/** Local noon of TODAY, so the local day is TODAY in every zone the tests run in. */
const NOW = new Date(2026, 8, 24, 12, 0, 0);

describe('graceWait', () => {
	it('the boundary: 7 days old still waits one day, 8 days old is asked about', () => {
		expect(bookingAgeDays({ bookedOn: '2026-09-17' }, TODAY)).toBe(7);
		expect(graceWait({ bookedOn: '2026-09-17' }, 7, TODAY)).toBe(1);
		expect(graceWait({ bookedOn: '2026-09-16' }, 7, TODAY)).toBeNull();
		expect(graceWait({ bookedOn: TODAY }, 7, TODAY)).toBe(8);
		expect(graceWait({ bookedOn: '2026-09-22' }, 7, TODAY)).toBe(6);
	});

	it('0 turns it off; no date, no wait', () => {
		expect(graceWait({ bookedOn: TODAY }, 0, TODAY)).toBeNull();
		expect(graceWait({ bookedOn: null }, 7, TODAY)).toBeNull();
	});

	it('today is the local calendar day', () => {
		expect(localDay(NOW)).toBe(TODAY);
	});
});

async function books(/** @type {Record<string, any> | null} */ settings = null) {
	/** @type {Record<string, any>} */
	const store = {};
	for (const name of ['transactions', 'receipts', 'matches', 'questions', 'settings', 'accounts']) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
	if (settings) await setSetting(store.settings, 'matching', settings);
	/** @param {string} bookedOn */
	const booking = async (bookedOn) => {
		/** @type {Record<string, any>} */
		const rest = { ...tx({ bookedOn, amountCents: -2242, counterparty: 'Kaffeerösterei Test' }) };
		delete rest.id;
		return store.transactions.put(rest);
	};
	return { store: /** @type {any} */ (store), booking };
}

/** @param {any} store @returns {Promise<Record<string, any>[]>} */
const missing = async (store) =>
	(await store.questions.list()).filter(
		(/** @type {any} */ q) => q.kind === 'missing-receipt' && q.state === 'open'
	);

describe('runMatching with a grace period', () => {
	it('default 7 days: the 7-day-old booking waits, the 8-day-old one is a question', async () => {
		const { store, booking } = await books();
		const young = await booking('2026-09-17');
		const old = await booking('2026-09-16');
		const r = await runMatching({ store, now: NOW });
		expect((await missing(store)).map((q) => q.transactionId)).toEqual([old.id]);
		expect(r.waiting).toBe(1);
		expect(r.created).toBe(1);
		// Waiting is not covered.
		expect(isTxCovered(young, {})).toBe(false);
		// A day later the young one is asked about too.
		const later = await runMatching({ store, now: new Date(2026, 8, 25, 12) });
		expect((await missing(store)).map((q) => q.transactionId).sort()).toEqual(
			[old.id, young.id].sort()
		);
		expect(later.waiting).toBe(0);
	});

	it('configurable in Eigene Anweisungen; 0 asks at once', async () => {
		const { store, booking } = await books({ graceDays: 0 });
		await booking(TODAY);
		const r = await runMatching({ store, now: NOW });
		expect(await missing(store)).toHaveLength(1);
		expect(r.waiting).toBe(0);
		const longer = await books({ graceDays: 14 });
		await longer.booking('2026-09-11');
		await runMatching({ store: longer.store, now: NOW });
		expect(await missing(longer.store)).toHaveLength(0);
	});

	it('an open question is not settled just because the grace was raised', async () => {
		const { store, booking } = await books({ graceDays: 0 });
		await booking('2026-09-22');
		await runMatching({ store, now: NOW });
		expect(await missing(store)).toHaveLength(1);
		await setSetting(store.settings, 'matching', { graceDays: 7 });
		const r = await runMatching({ store, now: NOW });
		expect(await missing(store)).toHaveLength(1);
		expect(r.resolved).toBe(0);
	});
});

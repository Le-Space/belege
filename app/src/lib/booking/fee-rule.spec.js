// The rule for network fees (#305): set once, every wallet network fee not
// confirmed yet takes the account, a bank booking or an exchange fee does
// not; lifted, the rule's bookings lose it again, a hand-confirmed one keeps
// its own. Every hash and amount is made up.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { getSetting } from '../store/settings.js';
import { applyFeeRule, isNetworkFee, setFeeRule } from './fee-rule.js';

/** @type {any} */
let store;
beforeEach(() => {
	store = Object.fromEntries(
		['transactions', 'settings', 'events'].map((name) => [
			name,
			memoryCollection(/** @type {any} */ (name)).collection
		])
	);
});

/** @param {Record<string, any>} t */
const add = (t) =>
	store.transactions.put({
		bookedOn: '2026-07-12',
		amountCents: -1,
		currency: 'EUR',
		...t
	});
const fee = (/** @type {string} */ n) =>
	add({ source: 'akash', movement: 'fee', txRef: n.repeat(64), counterparty: 'Netzwerkgebühr' });

describe('the network fee rule', () => {
	it('knows a wallet’s network fee from a bank fee or an exchange’s', () => {
		expect(isNetworkFee({ source: 'akash', movement: 'fee' })).toBe(true);
		expect(isNetworkFee({ source: 'ethereum', movement: 'fee' })).toBe(true);
		expect(isNetworkFee({ source: 'kraken', movement: 'fee' })).toBe(false);
		expect(isNetworkFee({ source: 'hibiscus', movement: 'fee' })).toBe(false);
		expect(isNetworkFee({ source: 'akash', movement: 'transfer' })).toBe(false);
		expect(isNetworkFee({ source: 'akash', movement: 'fee', deleted: true })).toBe(false);
	});

	it('set once: every open network fee, and later ones, take the account; others are left', async () => {
		const a = await fee('a');
		const b = await fee('b');
		const byHand = await fee('c');
		await store.transactions.put({
			...byHand,
			booking: { account: '4900', taxKey: '', confirmedAt: '2026-07-13T00:00:00Z' }
		});
		const bank = await add({ source: 'hibiscus', movement: 'fee', counterparty: 'Kontoführung' });
		const kraken = await add({ source: 'kraken', movement: 'fee' });

		expect(await setFeeRule(store, '4970')).toBe(2);
		expect((await getSetting(store.settings, 'matching')).networkFeeAccount).toBe('4970');
		for (const t of [a, b]) {
			expect((await store.transactions.get(t.id)).booking).toMatchObject({
				account: '4970',
				taxKey: '',
				via: 'rule'
			});
		}
		expect((await store.transactions.get(byHand.id)).booking.account).toBe('4900');
		expect((await store.transactions.get(bank.id)).booking ?? null).toBeNull();
		expect((await store.transactions.get(kraken.id)).booking ?? null).toBeNull();

		// A fee synced later: the next run gives it the account.
		const later = await fee('d');
		expect(await applyFeeRule(store)).toBe(1);
		expect((await store.transactions.get(later.id)).booking.account).toBe('4970');
		expect(await applyFeeRule(store)).toBe(0);

		const actions = (await store.events.list()).map((/** @type {any} */ e) => e.action);
		expect(actions).toEqual(expect.arrayContaining(['fee-rule-set', 'fee-rule-applied']));
	});

	it('lifted: the rule’s bookings lose the account, a hand-confirmed one keeps it', async () => {
		const a = await fee('a');
		const byHand = await fee('b');
		await setFeeRule(store, '4970');
		await store.transactions.put({
			...(await store.transactions.get(byHand.id)),
			booking: { account: '4900', taxKey: '', confirmedAt: '2026-07-13T00:00:00Z' }
		});
		expect(await setFeeRule(store, null)).toBe(1);
		expect((await store.transactions.get(a.id)).booking).toBeNull();
		expect((await store.transactions.get(byHand.id)).booking.account).toBe('4900');
		expect(await applyFeeRule(store)).toBe(0);
	});

	it('refuses what is no account', async () => {
		await expect(setFeeRule(store, '12')).rejects.toThrow('Not an account');
	});
});

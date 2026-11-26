// Network fees as one row per wallet and month (#1043): the grouping over the
// books' records, the group's "Übernehmen" and its undo. Every wallet, hash
// and amount is made up.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { confirmFeeGroup, undoFeeGroup } from './actions.js';
import {
	isFeeGroup,
	itemConfirmed,
	itemCovered,
	itemMatches,
	withFeeGroups
} from './fee-groups.js';
import { isBookingConfirmed } from './suggest.js';
import { matchesSearch } from '../bank/format.js';

let n = 0;
/** @param {Record<string, any>} [over] */
const fee = (over = {}) => ({
	id: `fee-${++n}`,
	source: 'akash',
	accountId: 'wallet-a',
	movement: 'fee',
	bookedOn: '2026-04-14',
	bookedAt: `2026-04-14T08:${String(n % 60).padStart(2, '0')}:00.000Z`,
	asset: 'AKT',
	decimals: 6,
	quantity: '-1234',
	amountCents: -1,
	currency: 'EUR',
	counterparty: 'Netzwerkgebühr',
	...over
});
const confirmed = (/** @type {string} */ account) => ({
	booking: { account, taxKey: '', confirmedAt: '2026-04-15T00:00:00.000Z' }
});

describe('withFeeGroups', () => {
	it('folds a month with many fees into one group', () => {
		const fees = Array.from({ length: 30 }, () => fee());
		const other = { id: 'bank-1', source: 'hibiscus', bookedOn: '2026-04-14', amountCents: -1234 };
		const items = withFeeGroups([...fees, other]);
		expect(items).toHaveLength(2);
		const group = items.find(isFeeGroup);
		expect(group).toMatchObject({
			kind: 'fee-group',
			accountId: 'wallet-a',
			source: 'akash',
			month: '2026-04',
			bookedOn: '2026-04-14',
			asset: 'AKT',
			quantity: '-37020',
			amountCents: -30,
			booking: 'none',
			cover: 'none',
			accounts: []
		});
		expect(group?.fees).toHaveLength(30);
		expect(group?.open).toHaveLength(30);
		expect(items).toContain(other);
	});

	it('leaves a single fee a row of its own', () => {
		const one = fee();
		expect(withFeeGroups([one])).toEqual([one]);
		expect(withFeeGroups([one, fee({ accountId: 'wallet-b' })]).some(isFeeGroup)).toBe(false);
	});

	it('shows fees confirmed one by one in their group, with the accounts used', () => {
		const items = withFeeGroups([
			fee(confirmed('4970')),
			fee(confirmed('4970')),
			fee(confirmed('4900')),
			fee()
		]);
		const [group] = items.filter(isFeeGroup);
		expect(group.booking).toBe('some');
		expect(group.open).toHaveLength(1);
		expect(group.accounts).toEqual([
			{ account: '4970', count: 2 },
			{ account: '4900', count: 1 }
		]);
		const all = withFeeGroups([fee(confirmed('4970')), fee(confirmed('4970'))]).find(isFeeGroup);
		expect(all?.booking).toBe('all');
		expect(itemConfirmed(/** @type {any} */ (all), isBookingConfirmed)).toBe(true);
		expect(itemConfirmed(group, isBookingConfirmed)).toBe(false);
	});

	it('splits fees across a month boundary, by the booking day', () => {
		const items = withFeeGroups([
			fee({ bookedOn: '2026-03-31' }),
			fee({ bookedOn: '2026-03-31' }),
			fee({ bookedOn: '2026-04-01' }),
			fee({ bookedOn: '2026-04-01' })
		]);
		expect(
			items
				.filter(isFeeGroup)
				.map((g) => [g.month, g.fees.length])
				.sort()
		).toEqual([
			['2026-03', 2],
			['2026-04', 2]
		]);
	});

	it('keeps a storage deposit and a swap’s cost rows of their own', () => {
		const items = withFeeGroups([
			fee(),
			fee(),
			fee({ storageDeposit: { for: 'own' } }),
			fee({ partOf: 'H'.repeat(64) })
		]);
		expect(items.filter(isFeeGroup)[0].fees).toHaveLength(2);
		expect(items.filter((i) => !isFeeGroup(i))).toHaveLength(2);
	});

	it('keeps a swap’s gas with its swap, a row of its own', () => {
		const swap = {
			id: 'swap-1',
			source: 'akash',
			movement: 'trade',
			txRef: 'S1',
			bookedOn: '2026-04-14'
		};
		const items = withFeeGroups([fee(), fee(), fee({ txRef: 'S1' }), swap]);
		expect(items.filter(isFeeGroup)[0].fees).toHaveLength(2);
		expect(items.some((i) => !isFeeGroup(i) && i.txRef === 'S1')).toBe(true);
	});

	it('says how much of a group a receipt covers', () => {
		const a = fee();
		const b = fee();
		const covered = (/** @type {any} */ tx) => tx.id === a.id;
		const [group] = withFeeGroups([a, b], { covered }).filter(isFeeGroup);
		expect(group.cover).toBe('some');
		expect(itemCovered(group, covered)).toBe(false);
		const [all] = withFeeGroups([a, b], { covered: () => true }).filter(isFeeGroup);
		expect(itemCovered(all, () => true)).toBe(true);
	});

	it('is found by its name, its wallet, its asset or any of its fees', () => {
		const [group] = withFeeGroups([fee(), fee({ amountCents: -2 })]).filter(isFeeGroup);
		const words = ['Netzwerkgebühren', 'Wallet AKT akash1example'];
		expect(itemMatches(group, 'netz', matchesSearch, words)).toBe(true);
		expect(itemMatches(group, 'akash1ex', matchesSearch, words)).toBe(true);
		expect(itemMatches(group, 'akt', matchesSearch, words)).toBe(true);
		expect(itemMatches(group, '0,02', matchesSearch, words)).toBe(true);
		expect(itemMatches(group, 'Wolkenfabrik', matchesSearch, words)).toBe(false);
	});
});

describe('confirmFeeGroup', () => {
	/** @type {any} */
	let store;
	beforeEach(() => {
		store = Object.fromEntries(
			['transactions', 'events', 'matches', 'receipts', 'settings'].map((name) => [
				name,
				memoryCollection(/** @type {any} */ (name)).collection
			])
		);
	});
	/** @param {Record<string, any>} [over] */
	const add = (over = {}) => {
		const rest = /** @type {Record<string, any>} */ (fee(over));
		delete rest.id;
		return store.transactions.put(rest);
	};

	it('confirms every open fee in one step, with one event, and undoes all of them', async () => {
		const open = await Promise.all(Array.from({ length: 30 }, () => add()));
		const byHand = await add(confirmed('4900'));
		const ids = [...open, byHand].map((t) => t.id);

		const undo = await confirmFeeGroup(store, ids, { account: '4970' }, { month: '2026-04' });
		expect(undo.changes).toHaveLength(30);
		for (const t of open) {
			expect((await store.transactions.get(t.id)).booking).toMatchObject({
				account: '4970',
				via: 'group'
			});
		}
		expect((await store.transactions.get(byHand.id)).booking.account).toBe('4900');
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => [e.action, e.count])).toEqual([['fee-group', 30]]);

		expect(await undoFeeGroup(store, undo)).toBe(30);
		for (const t of open) {
			expect(isBookingConfirmed(await store.transactions.get(t.id))).toBe(false);
		}
		expect((await store.transactions.get(byHand.id)).booking.account).toBe('4900');
		expect((await store.events.list()).map((/** @type {any} */ e) => e.action).sort()).toEqual([
			'fee-group',
			'fee-group-undone'
		]);
	});

	it('puts every fee on one account when asked, and undo gives each its own back', async () => {
		const a = await add(confirmed('4970'));
		const b = await add(confirmed('4900'));
		const c = await add();
		const undo = await confirmFeeGroup(
			store,
			[a.id, b.id, c.id],
			{ account: '4970' },
			{ only: 'all' }
		);
		expect(undo.changes.map((x) => x.transactionId)).toEqual([b.id, c.id]);
		expect((await store.transactions.get(b.id)).booking.account).toBe('4970');

		await undoFeeGroup(store, undo);
		expect((await store.transactions.get(b.id)).booking.account).toBe('4900');
		expect(isBookingConfirmed(await store.transactions.get(c.id))).toBe(false);
		expect((await store.transactions.get(a.id)).booking.account).toBe('4970');
	});

	it('leaves a fee changed since alone on undo', async () => {
		const a = await add();
		const b = await add();
		const undo = await confirmFeeGroup(store, [a.id, b.id], { account: '4970' });
		const later = await store.transactions.get(b.id);
		await store.transactions.put({ ...later, ...confirmed('4900') });
		expect(await undoFeeGroup(store, undo)).toBe(1);
		expect((await store.transactions.get(b.id)).booking.account).toBe('4900');
	});

	it('refuses what is no account number', async () => {
		const a = await add();
		await expect(confirmFeeGroup(store, [a.id], { account: '49' })).rejects.toThrow();
		expect(isBookingConfirmed(await store.transactions.get(a.id))).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { isTestBooking, removeTestBookings, testBookings } from './test-bookings.js';

describe('test bookings', () => {
	it('marked ones, and older ones by what the button wrote; real bookings never', () => {
		expect(isTestBooking({ testBooking: true, counterparty: 'x' })).toBe(true);
		expect(isTestBooking({ counterparty: 'Testpartner GmbH', purpose: 'Testbuchung' })).toBe(true);
		// From a bank, or with an account: a real booking, whatever it is called.
		expect(
			isTestBooking({
				counterparty: 'Testpartner GmbH',
				purpose: 'Testbuchung',
				source: 'hibiscus'
			})
		).toBe(false);
		expect(
			isTestBooking({ counterparty: 'Testpartner GmbH', purpose: 'Testbuchung', accountId: 'a1' })
		).toBe(false);
		expect(isTestBooking({ counterparty: 'Wolkenfabrik Hosting GmbH', purpose: 'RE-1001' })).toBe(
			false
		);
		expect(isTestBooking({ testBooking: true, deleted: true })).toBe(false);
	});

	it('removed with what points at them; everything else stays', async () => {
		const store = {
			accounts: memoryCollection('accounts').collection,
			transactions: memoryCollection('transactions').collection,
			matches: memoryCollection('matches').collection,
			questions: memoryCollection('questions').collection
		};
		const a = await store.transactions.put({
			counterparty: 'Testpartner GmbH',
			purpose: 'Testbuchung',
			amountCents: -1999
		});
		const b = await store.transactions.put({
			testBooking: true,
			counterparty: 'Testpartner GmbH',
			amountCents: -1999
		});
		const real = await store.transactions.put({
			counterparty: 'Stromwerk Test AG',
			amountCents: -4500,
			accountId: 'a1',
			source: 'camt'
		});
		await store.matches.put({ transactionId: a.id, receiptId: 'r1', state: 'auto' });
		await store.questions.put({ transactionId: b.id, kind: 'missing-receipt' });
		expect(testBookings(await store.transactions.list())).toHaveLength(2);

		const testAccount = await store.accounts.put({
			name: 'Testkonto',
			source: 'test',
			testAccount: true
		});
		const realAccount = await store.accounts.put({ name: 'Girokonto', source: 'camt' });
		expect(await removeTestBookings(store)).toBe(2);
		expect((await store.transactions.list()).map((t) => t.id)).toEqual([real.id]);
		expect(await store.matches.list()).toEqual([]);
		expect(await store.questions.list()).toEqual([]);
		expect((await store.accounts.list()).map((x) => x.id)).toEqual([realAccount.id]);
		expect(testAccount.id).toBeTruthy();
	});
});

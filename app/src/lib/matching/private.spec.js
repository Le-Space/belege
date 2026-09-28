// "Privat (Irrläufer)" (issue #172). Made-up bookings only.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import {
	linkRepayment,
	markPrivate,
	openPrivatePayments,
	privateKind,
	privateNote,
	privateSettlement,
	unlinkRepayment,
	unmarkPrivate
} from './private.js';
import { coverageBadge, isTxCovered } from './view.js';
import { cleanDatevSettings, privateAccounts } from '../booking/settings.js';
import { suggestBooking } from '../booking/suggest.js';

/** @type {any} */
let store;
beforeEach(() => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events'
	]) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
});

const put = (/** @type {Record<string, any>} */ t) =>
	store.transactions.put({ currency: 'EUR', accountId: 'acc-1', source: 'hibiscus', ...t });

describe('a private payment from the business account', () => {
	it('a note to start with, from the booking', () => {
		const note = privateNote({
			amountCents: -4990,
			currency: 'EUR',
			bookedOn: '2026-02-11',
			counterparty: 'Beispiel Zahlungsdienst',
			purpose: 'Ihr Einkauf bei Beispiel Shop'
		});
		expect(note).toContain('11.02.2026');
		expect(note).toContain('Beispiel Shop');
		expect(note).toContain('Kein Betriebsausgabenbeleg');
	});

	it('marked: covered, its receipt link and "Kein Beleg nötig" go; others alike stay', async () => {
		const tx = await put({
			bookedOn: '2026-02-11',
			amountCents: -4990,
			counterparty: 'Beispiel Zahlungsdienst',
			noReceipt: { reason: 'x' }
		});
		const other = await put({
			bookedOn: '2026-02-12',
			amountCents: -1000,
			counterparty: 'Beispiel Zahlungsdienst'
		});
		await store.matches.put({ transactionId: tx.id, receiptId: 'r1', state: 'auto' });
		await markPrivate(store, tx.id, 'Privat, versehentlich.');
		const marked = await store.transactions.get(tx.id);
		expect(marked.privateMistake).toMatchObject({ note: 'Privat, versehentlich.', settledBy: [] });
		expect(marked.noReceipt).toBeNull();
		expect((await store.matches.list())[0].state).toBe('rejected');
		expect(isTxCovered(marked, {})).toBe(true);
		expect(coverageBadge(marked, {})).toBe('private-mistake');
		expect(privateKind(await store.transactions.get(other.id))).toBeNull();
	});

	it('open until paid back; one repayment for two, and two for one', async () => {
		const a = await put({ bookedOn: '2026-02-11', amountCents: -4990 });
		const b = await put({ bookedOn: '2026-02-20', amountCents: -1010 });
		await markPrivate(store, a.id, '');
		await markPrivate(store, b.id, '');
		let all = await store.transactions.list();
		expect(openPrivatePayments(all).map((p) => p.openCents)).toEqual([1010, 4990]);

		const part = await put({ bookedOn: '2026-03-01', amountCents: 3000, accountId: 'acc-2' });
		await linkRepayment(store, a.id, part.id);
		all = await store.transactions.list();
		expect(privateSettlement(await store.transactions.get(a.id), all).openCents).toBe(1990);
		const repaid = await store.transactions.get(part.id);
		expect(coverageBadge(repaid, {})).toBe('private-repayment');

		const rest = await put({ bookedOn: '2026-03-05', amountCents: 3000, accountId: 'acc-2' });
		await linkRepayment(store, a.id, rest.id);
		await linkRepayment(store, b.id, rest.id);
		all = await store.transactions.list();
		// 60,00 back for 49,90 + 10,10 linked together: settled, and nothing open on Home.
		expect(privateSettlement(await store.transactions.get(b.id), all)).toMatchObject({
			openCents: 0,
			paidCents: 6000,
			repaidCents: 6000
		});
		expect(openPrivatePayments(all)).toEqual([]);

		await unlinkRepayment(store, b.id, rest.id);
		all = await store.transactions.list();
		expect(openPrivatePayments(all).map((p) => p.openCents)).toEqual([1010]);
	});

	it('"Doch geschäftlich": a normal booking again, and its repayment lets go', async () => {
		const a = await put({ bookedOn: '2026-02-11', amountCents: -4990 });
		const r = await put({ bookedOn: '2026-03-01', amountCents: 4990, accountId: 'acc-2' });
		await markPrivate(store, a.id, '');
		await linkRepayment(store, a.id, r.id);
		await unmarkPrivate(store, a.id);
		expect(privateKind(await store.transactions.get(a.id))).toBeNull();
		expect(privateKind(await store.transactions.get(r.id))).toBeNull();
		expect(isTxCovered(await store.transactions.get(a.id), {})).toBe(false);
	});
});

describe('the accounts, by the legal form', () => {
	it('stored cleanly; the accounts and whether to settle', () => {
		expect(
			cleanDatevSettings({ legalForm: 'corporation', shareholderAccount: ' 1545 ' })
		).toMatchObject({
			legalForm: 'corporation',
			shareholderAccount: '1545'
		});
		expect(cleanDatevSettings({ legalForm: 'ag', shareholderAccount: 'x' })).toMatchObject({
			legalForm: '',
			shareholderAccount: ''
		});
		const of = (/** @type {any} */ v) => privateAccounts(cleanDatevSettings(v));
		expect(of({ legalForm: 'sole' })).toEqual({
			payment: '1800',
			repayment: '1890',
			settle: false
		});
		expect(of({ legalForm: 'partnership' })).toMatchObject({ payment: '1800' });
		expect(of({ legalForm: 'corporation', shareholderAccount: '1545' })).toEqual({
			payment: '1545',
			repayment: '1545',
			settle: true
		});
		expect(of({ legalForm: 'corporation' })).toEqual({
			payment: null,
			repayment: null,
			settle: true
		});
		expect(of(null)).toMatchObject({ settle: true, payment: null });
	});

	it('the suggestion follows it; a confirmed account still wins', () => {
		const accounts = { payment: '1800', repayment: '1890' };
		const payment = { id: 't', amountCents: -4990, privateMistake: { note: 'x', settledBy: [] } };
		const repayment = { id: 'r', amountCents: 4990, privateRepaymentOf: ['t'] };
		expect(suggestBooking(payment, { privateAccounts: accounts })).toMatchObject({
			account: '1800',
			source: 'private'
		});
		expect(suggestBooking(repayment, { privateAccounts: accounts })).toMatchObject({
			account: '1890'
		});
		expect(
			suggestBooking(
				{ ...payment, booking: { account: '4980', confirmedAt: '2026-02-12T00:00:00Z' } },
				{ privateAccounts: accounts }
			)
		).toMatchObject({ account: '4980', source: 'confirmed' });
	});
});

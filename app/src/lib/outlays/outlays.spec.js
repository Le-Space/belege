// Private outlays (#293): a receipt paid privately becomes a booking on the
// outlay account and is covered by it; another currency in euros at a rate
// with its source; the ledger account from the legal form; undone, the
// receipt is free again and can be booked anew. Every vendor, amount and
// place is made up.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { cleanDatevSettings } from '../booking/settings.js';
import { bookOutlay, euroCents, outlayAmount, undoOutlay } from './outlays.js';

/** @type {any} */
let store;
beforeEach(() => {
	store = Object.fromEntries(
		['accounts', 'transactions', 'matches', 'events', 'receipts', 'settings', 'partners'].map(
			(name) => [name, memoryCollection(/** @type {any} */ (name)).collection]
		)
	);
});

const corporation = cleanDatevSettings({ legalForm: 'corporation', shareholderAccount: '1755' });

describe('amounts and rates', () => {
	it('a receipt’s amount without sign, the direction from its sign; euros at a rate', () => {
		expect(outlayAmount({ amountCents: 1_699_000, currency: 'RUB' })).toEqual({
			amountCents: 1_699_000,
			currency: 'RUB',
			outgoing: true
		});
		expect(outlayAmount({ amountCents: -289_000, currency: 'RUB' })?.outgoing).toBe(false);
		expect(outlayAmount({ extraction: { gross: 12.5 } })).toEqual({
			amountCents: 1250,
			currency: 'EUR',
			outgoing: true
		});
		expect(outlayAmount({ amountCents: 0 })).toBeNull();
		expect(euroCents(1_699_000, '0.0105')).toBe(17_840);
		expect(() => euroCents(100, '0')).toThrow('Kein Kurs');
	});
});

describe('bookOutlay', () => {
	it('a euro receipt paid in cash: a booking on the outlay account, the receipt covered', async () => {
		const receipt = await store.receipts.put({
			vendor: 'Bahn Beispiel AG',
			amountCents: 8_990,
			currency: 'EUR',
			documentDate: '2025-03-04',
			invoiceNumber: 'TK-77'
		});
		const { transaction, account } = await bookOutlay({
			store,
			settings: corporation,
			receipt,
			how: 'cash'
		});
		expect(account).toMatchObject({
			source: 'outlay',
			kind: 'outlay',
			name: 'Auslagen Geschäftsführung',
			ledgerAccount: '1755'
		});
		expect(transaction).toMatchObject({
			accountId: account.id,
			source: 'outlay',
			bookedOn: '2025-03-04',
			amountCents: -8_990,
			counterparty: 'Bahn Beispiel AG',
			purpose: 'Privat ausgelegt (bar) · Rechnung TK-77',
			outlay: { how: 'cash', receiptId: receipt.id }
		});
		const [match] = await store.matches.list();
		expect(match).toMatchObject({
			receiptId: receipt.id,
			transactionId: transaction.id,
			state: 'confirmed'
		});
		expect(match.reasons).toContain('outlay');
		// Twice is refused.
		await expect(
			bookOutlay({ store, settings: corporation, receipt, how: 'cash' })
		).rejects.toThrow('schon als Auslage');
	});

	it('rubles by a rate from a document: the original amount and the rate’s source kept', async () => {
		const receipt = await store.receipts.put({
			vendor: 'Coworking Beispiel',
			amountCents: 1_699_000,
			currency: 'RUB',
			documentDate: '2025-03-03'
		});
		await expect(
			bookOutlay({ store, settings: corporation, receipt, how: 'cash' })
		).rejects.toThrow('Kein Kurs für RUB');
		const { transaction } = await bookOutlay({
			store,
			settings: corporation,
			receipt,
			how: 'cash',
			rate: { rate: '0.0105', source: 'manual', note: 'Wechselbeleg vom 01.03.' }
		});
		expect(transaction).toMatchObject({
			amountCents: -17_840,
			original: { amount: '-16990.00', currency: 'RUB', rate: '0.0105' },
			outlay: {
				how: 'cash',
				rateSource: 'manual',
				rateNote: 'Wechselbeleg vom 01.03.',
				rateAt: '2025-03-03T00:00:00Z'
			}
		});
	});

	it('a sole proprietor’s outlays go against 1890; without a legal form the account waits for one', async () => {
		const receipt = await store.receipts.put({
			vendor: 'Taxi Beispiel',
			amountCents: 2_400,
			documentDate: '2025-05-01'
		});
		const { account } = await bookOutlay({
			store,
			settings: cleanDatevSettings({ legalForm: 'sole' }),
			receipt,
			how: 'card'
		});
		expect(account.ledgerAccount).toBe('1890');

		const other = Object.fromEntries(
			['accounts', 'transactions', 'matches', 'events', 'receipts', 'settings', 'partners'].map(
				(name) => [name, memoryCollection(/** @type {any} */ (name)).collection]
			)
		);
		const r2 = await other.receipts.put({
			vendor: 'Taxi',
			amountCents: 100,
			documentDate: '2025-05-01'
		});
		const { account: waiting } = await bookOutlay({
			store: other,
			settings: cleanDatevSettings({}),
			receipt: r2,
			how: 'other'
		});
		expect(waiting.ledgerAccount ?? null).toBeNull();
	});

	it('undone: the booking gone, the receipt free, and booked anew as a booking of its own', async () => {
		const receipt = await store.receipts.put({
			vendor: 'Hotel Beispiel',
			amountCents: 12_000,
			documentDate: '2025-06-10'
		});
		const first = await bookOutlay({ store, settings: corporation, receipt, how: 'card' });
		await undoOutlay(store, first.transaction.id);
		expect(await store.transactions.list()).toEqual([]);
		expect(
			(await store.matches.list()).every((/** @type {any} */ m) => m.state === 'rejected')
		).toBe(true);
		const again = await bookOutlay({
			store,
			settings: corporation,
			receipt,
			how: 'card',
			amount: '110.00'
		});
		expect(again.transaction.id).not.toBe(first.transaction.id);
		expect(again.transaction.amountCents).toBe(-11_000);
		expect((await store.transactions.list()).map((/** @type {any} */ t) => t.id)).toEqual([
			again.transaction.id
		]);
	});
});

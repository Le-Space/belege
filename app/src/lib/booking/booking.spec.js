// "Konto": the suggested contra account and BU key, the catalogue, the
// settings, and what confirming stores and teaches.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { receipt, tx } from '../matching/fixtures.js';
import { setSetting } from '../store/settings.js';
import { confirmBooking, confirmBookings } from './actions.js';
import {
	accountsInOrder,
	cleanDatevSettings,
	defaultDatevSettings,
	ledgerOf,
	suggestedLedgerAccount
} from './settings.js';
import { accountLabel, catalogueAccount, isAccountNumber, searchAccounts } from './skr03.js';
import { isBookingConfirmed, suggestBooking } from './suggest.js';
import { taxKeyFor, vatRates } from './tax-keys.js';

const KEYS = defaultDatevSettings().taxKeys;

describe('taxKeyFor: the BU key from the receipt', () => {
	const vat = (/** @type {any[]} */ v, extra = {}) => receipt({ vat: v, ...extra });

	it('expenses: 19 % → 9, 7 % → 8', () => {
		expect(taxKeyFor(vat([{ rate: 19, amount: 6.38 }]), { income: false })).toEqual({
			taxKey: '9',
			via: 'vat19',
			rate: 19
		});
		expect(taxKeyFor(vat([{ rate: 7, amount: 0.7 }]), { income: false }).taxKey).toBe('8');
	});
	it('income: 19 % → 3, 7 % → 2', () => {
		expect(taxKeyFor(vat([{ rate: 19, amount: 19 }]), { income: true }).taxKey).toBe('3');
		expect(taxKeyFor(vat([{ rate: 7, amount: 7 }]), { income: true }).taxKey).toBe('2');
	});
	it('reverse charge: the §13b key on an expense, none on income', () => {
		const rc = vat([], { reverse_charge: true });
		expect(taxKeyFor(rc, { income: false })).toEqual({ taxKey: '94', via: 'reverse-charge' });
		expect(taxKeyFor(rc, { income: true })).toEqual({
			taxKey: '',
			via: 'reverse-charge-income'
		});
	});
	it('no VAT, a foreign rate, several rates, no receipt: empty', () => {
		expect(taxKeyFor(vat([]), { income: false })).toEqual({ taxKey: '', via: 'no-vat' });
		expect(taxKeyFor(vat([{ rate: 20, amount: 2 }]), { income: false }).via).toBe('other-rate');
		expect(
			taxKeyFor(
				vat([
					{ rate: 19, amount: 1.9 },
					{ rate: 7, amount: 0.7 }
				]),
				{ income: false }
			).via
		).toBe('mixed');
		expect(taxKeyFor(null, { income: false })).toEqual({ taxKey: '', via: 'no-receipt' });
		// A rate with a zero amount does not count.
		expect(vatRates(vat([{ rate: 19, amount: 0 }]))).toEqual([]);
	});
	it('an Automatikkonto carries no key; overridden keys are used', () => {
		const r = vat([{ rate: 19, amount: 19 }]);
		expect(taxKeyFor(r, { income: true, account: '8400' })).toEqual({
			taxKey: '',
			via: 'automatic'
		});
		expect(taxKeyFor(r, { income: false, keys: { ...KEYS, input19: '90' } }).taxKey).toBe('90');
	});
});

describe('suggestBooking', () => {
	it('an own transfer: 1360 without key; a bank fee: 4970 without key', () => {
		const t = tx({ amountCents: -50000 });
		expect(
			suggestBooking(t, { classification: { kind: 'own-transfer', account: '1360' } })
		).toMatchObject({ account: '1360', taxKey: '', source: 'transfer' });
		expect(suggestBooking(t, { classification: { kind: 'bank-fee' } })).toMatchObject({
			account: '4970',
			taxKey: '',
			source: 'fee'
		});
	});
	it('a learned vendor: its account, the key from this receipt', () => {
		const partners = [
			{
				id: 'P1',
				name: 'Wolkenfabrik GmbH',
				aliases: ['wolkenfabrik'],
				account: '4806',
				taxKey: '9'
			}
		];
		const r = receipt({ vendor: 'Wolkenfabrik GmbH', vat: [{ rate: 7, amount: 1 }] });
		const t = tx({ amountCents: -1500, counterparty: 'Anderer Name' });
		expect(suggestBooking(t, { receipts: [r], partners })).toMatchObject({
			account: '4806',
			taxKey: '8',
			source: 'learned',
			taxVia: 'vat7',
			vendor: 'Wolkenfabrik GmbH'
		});
		// No receipt: found by the counterparty, with the vendor's learned key.
		const byAlias = tx({ amountCents: -1500, counterparty: 'WOLKENFABRIK 4711' });
		expect(suggestBooking(byAlias, { partners })).toMatchObject({
			account: '4806',
			taxKey: '9',
			source: 'learned',
			taxVia: 'learned'
		});
	});
	it('nothing known: no account, the key still from the receipt', () => {
		const r = receipt({ vendor: 'Neu GmbH', vat: [{ rate: 19, amount: 1.9 }] });
		expect(suggestBooking(tx({ amountCents: -1190 }), { receipts: [r] })).toMatchObject({
			account: null,
			taxKey: '9',
			source: null
		});
		expect(
			suggestBooking(tx({ amountCents: 11900 }), { receipts: [r] }).taxKey,
			'income 19 %'
		).toBe('3');
	});
	it('a confirmed booking wins over every rule', () => {
		const t = tx({
			amountCents: -990,
			booking: { account: '4900', taxKey: '', confirmedAt: '2026-09-01T10:00:00Z' }
		});
		expect(isBookingConfirmed(t)).toBe(true);
		expect(suggestBooking(t, { classification: { kind: 'bank-fee' } })).toMatchObject({
			account: '4900',
			source: 'confirmed'
		});
		expect(isBookingConfirmed(tx({ booking: { account: '12', confirmedAt: 'x' } }))).toBe(false);
		expect(isBookingConfirmed(tx({}))).toBe(false);
	});
});

describe('catalogue and settings', () => {
	it('knows the common SKR 03 accounts and takes any 4–8 digit number', () => {
		expect(accountLabel('4930')).toBe('4930 Bürobedarf');
		expect(accountLabel('4711')).toBe('4711');
		expect(catalogueAccount('8400')?.automatic).toBe(19);
		expect(isAccountNumber('1200')).toBe(true);
		expect(isAccountNumber('12345678')).toBe(true);
		expect(isAccountNumber('120')).toBe(false);
		expect(isAccountNumber('12a0')).toBe(false);
		expect(searchAccounts('büro').map((a) => a.number)).toEqual(['4930']);
		expect(searchAccounts('49').every((a) => a.number.startsWith('49'))).toBe(true);
		expect(searchAccounts('', { income: true })[0].kind).toBe('income');
	});
	it('cleans the DATEV settings and falls back to the defaults', () => {
		expect(cleanDatevSettings(null)).toEqual(defaultDatevSettings());
		expect(
			cleanDatevSettings({
				consultantNumber: '12345',
				clientNumber: '7',
				fiscalYearStartMonth: '7',
				accountLength: 5,
				taxKeys: { input19: '90', reverseCharge: '', output7: 'x' }
			})
		).toEqual({
			consultantNumber: '12345',
			clientNumber: '7',
			fiscalYearStartMonth: 7,
			accountLength: 5,
			taxKeys: { input19: '90', input7: '8', output19: '3', output7: '2', reverseCharge: '' }
		});
		expect(cleanDatevSettings({ consultantNumber: '999', accountLength: 9 })).toMatchObject({
			consultantNumber: '1001',
			accountLength: 4
		});
	});
	it('suggests 1200, 1210 for the bank accounts, oldest first', () => {
		expect(suggestedLedgerAccount(0)).toBe('1200');
		expect(suggestedLedgerAccount(1)).toBe('1210');
		expect(accountsInOrder([{ id: 'B' }, { id: 'A' }, { id: 'C', deleted: true }])).toEqual([
			{ id: 'A' },
			{ id: 'B' }
		]);
		expect(ledgerOf({ ledgerAccount: '1234' })).toBe('1234');
		expect(ledgerOf({ ledgerAccount: '' })).toBeNull();
	});
});

describe('confirmBooking', () => {
	/** @type {any} */
	let store;
	beforeEach(async () => {
		store = {};
		for (const name of /** @type {const} */ ([
			'transactions',
			'receipts',
			'matches',
			'questions',
			'settings',
			'accounts',
			'partners',
			'events'
		])) {
			store[name] = memoryCollection(name).collection;
		}
		await setSetting(store.settings, 'matching', { companyNames: ['Muster UG'] });
	});

	/** @param {Record<string, any>} r */
	const without = (r) => {
		const rest = { ...r };
		delete rest.id;
		return rest;
	};

	it('stores the booking, teaches the vendor, and the next booking gets it as learned', async () => {
		const r = await store.receipts.put(
			without(receipt({ vendor: 'Kabelnetz Beispiel GmbH', vat: [{ rate: 19, amount: 6.38 }] }))
		);
		const t = await store.transactions.put(
			without(tx({ amountCents: -3999, counterparty: 'KABELNETZ BEISPIEL' }))
		);
		await store.matches.put({
			transactionId: t.id,
			receiptId: r.id,
			state: 'confirmed',
			score: 100,
			reasons: []
		});
		await confirmBooking(store, t.id, { account: '4925', taxKey: '9' });
		const saved = await store.transactions.get(t.id);
		expect(saved.booking).toMatchObject({ account: '4925', taxKey: '9' });
		expect(typeof saved.booking.confirmedAt).toBe('string');
		const [partner] = await store.partners.list();
		expect(partner).toMatchObject({
			name: 'Kabelnetz Beispiel GmbH',
			account: '4925',
			taxKey: '9',
			aliases: ['kabelnetz beispiel']
		});
		const next = tx({ amountCents: -3999, counterparty: 'KABELNETZ BEISPIEL' });
		expect(suggestBooking(next, { partners: await store.partners.list() })).toMatchObject({
			account: '4925',
			taxKey: '9',
			source: 'learned'
		});
		const [event] = await store.events.list();
		expect(event).toMatchObject({ kind: 'decision', action: 'booking', learned: true });
	});

	it('learns nothing without a receipt or for our own invoices; refuses bad numbers', async () => {
		const t = await store.transactions.put(without(tx({ amountCents: -990 })));
		await confirmBooking(store, t.id, { account: '4970' });
		expect(await store.partners.list()).toEqual([]);
		expect((await store.transactions.get(t.id)).booking.taxKey).toBe('');

		const own = await store.receipts.put(without(receipt({ vendor: 'Muster UG' })));
		const income = await store.transactions.put(without(tx({ amountCents: 11900 })));
		await store.matches.put({
			transactionId: income.id,
			receiptId: own.id,
			state: 'confirmed',
			score: 100,
			reasons: []
		});
		await confirmBooking(store, income.id, { account: '8400' });
		expect(await store.partners.list()).toEqual([]);

		await expect(confirmBooking(store, t.id, { account: '12' })).rejects.toThrow('4 bis 8');
		await expect(confirmBooking(store, t.id, { account: '4970', taxKey: 'x' })).rejects.toThrow(
			'BU-Schlüssel'
		);
	});

	it('confirms several at once with one event', async () => {
		const a = await store.transactions.put(without(tx({ amountCents: -500 })));
		const b = await store.transactions.put(without(tx({ amountCents: -990 })));
		await confirmBookings(store, [
			{ transactionId: a.id, account: '1360', taxKey: '' },
			{ transactionId: b.id, account: '4970', taxKey: '' }
		]);
		expect(isBookingConfirmed(await store.transactions.get(a.id))).toBe(true);
		expect(isBookingConfirmed(await store.transactions.get(b.id))).toBe(true);
		const events = await store.events.list();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ action: 'bookings', count: 2 });
	});
});

// Company credit cards (#382): the issuer's CSV read by its column names, the
// lines as bookings of the card's account. Both statements are made up – no
// issuer's real export, no real card, merchant or amount.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from './test-support.js';
import {
	cardLines,
	chargesPositive,
	detectMapping,
	parseAmount,
	parseDay,
	readCardCsv
} from './card-csv.js';
import { addCard, cleanCard, importCardLines } from './card-import.js';
import { confirmMatch } from '../matching/actions.js';
import { euroOf, paidByGuess } from '../travel/view.js';

// German, with lines about the card above the table; charges positive.
const GERMAN = [
	'Kreditkartenabrechnung;Beispielbank Business Card',
	'Karte;**** **** **** 4242',
	'',
	'Belegdatum;Buchungsdatum;Beschreibung;Betrag (EUR);Originalbetrag;Originalwährung;Kurs',
	'03.05.2026;04.05.2026;"Bahn Beispiel AG, Musterstadt";89,90;;;',
	'05.05.2026;06.05.2026;Hotel Beispiel Wien;210,00;210,00;EUR;',
	'07.05.2026;09.05.2026;Taxi Beispiel Prag;24,73;"612,00";CZK;24,7480',
	'31.05.2026;31.05.2026;Zahlung erhalten - Danke;-1.324,63;;;',
	'Summe;;;1.000,00;;;'
].join('\r\n');

// English, debit and credit apart.
const ENGLISH = [
	'Transaction Date,Posting Date,Description,Debit,Credit,Currency,Reference',
	'2026-05-03,2026-05-04,Example Air,"1,234.50",,EUR,TX-1001',
	'2026-05-08,2026-05-08,Example Air refund,,100.00,EUR,TX-1002',
	'2026-05-09,2026-05-09,Example Shop US,25.00,,USD,TX-1003'
].join('\n');

describe('reading a card statement (#382)', () => {
	it('amounts and days as issuers write them', () => {
		expect(parseAmount('1.324,63')).toBe(132463);
		expect(parseAmount('1,234.50')).toBe(123450);
		expect(parseAmount('-12,3')).toBe(-1230);
		expect(parseAmount('12,30-')).toBe(-1230);
		expect(parseAmount('(9.99)')).toBe(-999);
		expect(parseAmount('24,73 EUR')).toBe(2473);
		expect(parseAmount('')).toBeNull();
		expect(parseAmount('n/a')).toBeNull();
		expect(parseDay('31.05.2026')).toBe('2026-05-31');
		expect(parseDay('31.05.26')).toBe('2026-05-31');
		expect(parseDay('2026-05-31T10:00')).toBe('2026-05-31');
		expect(parseDay('31/05/2026')).toBe('2026-05-31');
		expect(parseDay('31.02.2026')).toBeNull();
		expect(parseDay('Summe')).toBeNull();
	});

	it('the columns by their names, the specific before the general', () => {
		expect(
			detectMapping([
				'Belegdatum',
				'Buchungsdatum',
				'Beschreibung',
				'Betrag (EUR)',
				'Originalbetrag',
				'Originalwährung',
				'Kurs'
			])
		).toEqual({
			date: 0,
			postingDate: 1,
			description: 2,
			amount: 3,
			originalAmount: 4,
			originalCurrency: 5,
			rate: 6
		});
		// A "Kartennummer" column is no amount, and "Credit card" no credit column.
		expect(detectMapping(['Datum', 'Credit card number', 'Umsatz'])).toEqual({
			date: 0,
			amount: 2
		});
	});

	it('a German statement: the table found below its head, charges turned to money out, other currencies kept', () => {
		const table = readCardCsv(GERMAN);
		expect(table.header[0]).toBe('Belegdatum');
		expect(chargesPositive(table)).toBe(true);
		const { lines, skipped } = cardLines(table, { invert: true });
		expect(skipped).toEqual([{ row: 4, why: 'date' }]);
		expect(lines.map((l) => [l.date, l.valueDate, l.counterpartyName, l.amountCents])).toEqual([
			['2026-05-03', '2026-05-04', 'Bahn Beispiel AG, Musterstadt', -8990],
			['2026-05-05', '2026-05-06', 'Hotel Beispiel Wien', -21000],
			['2026-05-07', '2026-05-09', 'Taxi Beispiel Prag', -2473],
			['2026-05-31', '2026-05-31', 'Zahlung erhalten - Danke', 132463]
		]);
		// EUR as "original" is none; CZK is kept with the issuer's rate.
		expect(lines[1].original).toBeUndefined();
		expect(lines[2].original).toEqual({ amount: '612.00', currency: 'CZK', rate: '24.7480' });
		// The bank's payment settling the card.
		expect(lines[3].bookingType).toBe('Kartenausgleich');
		expect(lines[0].bookingType).toBeUndefined();
	});

	it('an English statement: debit and credit apart, a line in another billing currency left out', () => {
		const table = readCardCsv(ENGLISH);
		expect(chargesPositive(table)).toBe(false);
		const { lines, skipped } = cardLines(table);
		expect(lines.map((l) => [l.date, l.amountCents, l.sourceId])).toEqual([
			['2026-05-03', -123450, 'card:TX-1001'],
			['2026-05-08', 10000, 'card:TX-1002']
		]);
		expect(skipped).toEqual([{ row: 2, why: 'currency' }]);
		// A refund is no settlement.
		expect(lines[1].bookingType).toBeUndefined();
	});

	it('no table at all: said', () => {
		expect(() => readCardCsv('Name;Wert\nA;1')).toThrow(/date and an amount/);
	});
});

describe('a card as an account (#382)', () => {
	it('kept with a name and four digits; its lines imported once; its format remembered', async () => {
		expect(() => cleanCard({ name: 'Firmenkarte', last4: '42' })).toThrow();
		expect(() => cleanCard({ name: ' ', last4: '4242' })).toThrow();
		const store = {
			accounts: memoryCollection('accounts').collection,
			transactions: memoryCollection('transactions').collection,
			events: memoryCollection('events').collection
		};
		const card = await addCard(store.accounts, { name: 'Firmenkarte Beispiel', last4: '4242' });
		expect(card).toMatchObject({
			source: 'card',
			kind: 'card',
			ibanLast4: '4242',
			currency: 'EUR'
		});
		// The same card again: the same account.
		expect(
			(await addCard(store.accounts, { name: 'Firmenkarte Beispiel', last4: '4242' })).id
		).toBe(card.id);
		const table = readCardCsv(GERMAN);
		const { lines } = cardLines(table, { invert: true });
		const format = { header: table.header, mapping: table.mapping, invert: true };
		expect(await importCardLines(store, card, lines, format)).toMatchObject({ new: 4 });
		expect(await importCardLines(store, card, lines, format)).toMatchObject({ new: 0, skipped: 4 });
		const stored = await store.transactions.list();
		expect(stored.find((t) => t.counterparty === 'Taxi Beispiel Prag')).toMatchObject({
			source: 'card',
			accountId: card.id,
			amountCents: -2473,
			original: { amount: '612.00', currency: 'CZK', rate: '24.7480' }
		});
		expect((await store.accounts.get(String(card.id)))?.csvFormat).toMatchObject({ invert: true });
		// Both imports in the Verlauf, newest first.
		const syncs = (await store.events.list()).filter((e) => e.kind === 'bank-sync');
		expect(syncs.map((e) => [e.source, e.new])).toEqual([
			['card', 0],
			['card', 4]
		]);
	});
});

describe('a receipt paid by card (#382)', () => {
	it('linked to its card line: paid by the company, in the euros the card charged', async () => {
		const store = {
			accounts: memoryCollection('accounts').collection,
			transactions: memoryCollection('transactions').collection,
			events: memoryCollection('events').collection,
			matches: memoryCollection('matches').collection,
			receipts: memoryCollection('receipts').collection
		};
		const card = await addCard(store.accounts, { name: 'Firmenkarte Beispiel', last4: '4242' });
		const table = readCardCsv(GERMAN);
		await importCardLines(store, card, cardLines(table, { invert: true }).lines, {
			header: table.header,
			mapping: table.mapping,
			invert: true
		});
		// A taxi bill in koruny, on a trip.
		const taxi = await store.receipts.put({
			vendor: 'Taxi Beispiel Prag',
			documentDate: '2026-05-07',
			amountCents: 61200,
			currency: 'CZK',
			status: 'ausgelesen',
			travel: { tripId: 'T1', paidBy: 'company' }
		});
		const line = (await store.transactions.list()).find(
			(t) => t.counterparty === 'Taxi Beispiel Prag'
		);
		await confirmMatch(/** @type {any} */ (store), {
			receiptId: String(taxi.id),
			transactionId: String(line?.id),
			reasons: ['manual']
		});
		const books = {
			transactions: await store.transactions.list(),
			matches: await store.matches.list()
		};
		expect(paidByGuess(taxi, books)).toBe('company');
		expect(euroOf(taxi, books)).toMatchObject({
			cents: 2473,
			via: 'payment',
			originalCents: 61200
		});
	});
});

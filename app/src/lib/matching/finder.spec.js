// "Beleg finden": without a search text only receipts from around the payment;
// a search text looks through every receipt, assigned ones too. Made up.
import { describe, expect, it } from 'vitest';
import {
	FIND_PERIOD,
	assignedElsewhere,
	findPeriod,
	findsAll,
	inFindPeriod,
	receiptSearchText,
	searchWords
} from './finder.js';
import { receiptChoices } from './view.js';

const tx = {
	id: 'T1',
	bookedOn: '2026-03-10',
	amountCents: -1234,
	currency: 'EUR',
	counterparty: 'Wolkenfabrik Hosting GmbH'
};

describe('findPeriod / inFindPeriod', () => {
	it('is 60 days before and 30 days after the booking day', () => {
		expect(FIND_PERIOD).toEqual({ before: 60, after: 30 });
		expect(findPeriod('2026-03-10')).toEqual({ from: '2026-01-09', to: '2026-04-09' });
		expect(findPeriod(null)).toBeNull();
	});

	it('takes a receipt by its date, at the edges too', () => {
		expect(inFindPeriod({ documentDate: '2026-01-09' }, tx.bookedOn)).toBe(true);
		expect(inFindPeriod({ documentDate: '2026-04-09' }, tx.bookedOn)).toBe(true);
		expect(inFindPeriod({ documentDate: '2026-01-08' }, tx.bookedOn)).toBe(false);
		expect(inFindPeriod({ documentDate: '2026-04-10' }, tx.bookedOn)).toBe(false);
		// Half a year away, or another year: not this payment's.
		expect(inFindPeriod({ documentDate: '2025-08-03' }, tx.bookedOn)).toBe(false);
	});

	it('takes a receipt not read yet by the day it came in; one with no day not at all', () => {
		expect(
			inFindPeriod({ source: 'upload', receivedAt: '2026-03-01T08:00:00Z' }, tx.bookedOn)
		).toBe(true);
		expect(
			inFindPeriod({ source: 'upload', receivedAt: '2026-09-01T08:00:00Z' }, tx.bookedOn)
		).toBe(false);
		expect(inFindPeriod({ source: 'upload' }, tx.bookedOn)).toBe(false);
		expect(inFindPeriod({ documentDate: '2026-03-01' }, null)).toBe(false);
	});
});

describe('search text', () => {
	const r = {
		vendor: 'Wolkenfabrik Hosting GmbH',
		from: 'Rechnung <rechnung@example.com>',
		subject: 'Ihre Rechnung',
		fileName: 'rechnung.pdf',
		invoiceNumber: 'RE-0001',
		amountCents: 123456
	};

	it('finds by vendor, sender, invoice number and the amount as typed', () => {
		const text = receiptSearchText(r, ['1.234,56 €', '01.03.2026']);
		for (const q of [
			'wolkenfabrik',
			'hosting wolken',
			'example.com',
			're-0001',
			'1234,56',
			'1234.56',
			'1.234,56',
			'01.03.2026'
		]) {
			expect(findsAll(text, searchWords(q)), q).toBe(true);
		}
		expect(findsAll(text, searchWords('stromwerk'))).toBe(false);
		// Every word must be there.
		expect(findsAll(text, searchWords('wolkenfabrik stromwerk'))).toBe(false);
	});

	it('no words find everything', () => {
		expect(searchWords('  ')).toEqual([]);
		expect(findsAll('', [])).toBe(true);
	});
});

describe('assignedElsewhere', () => {
	const other = {
		id: 'T0',
		bookedOn: '2025-03-10',
		amountCents: -1234,
		currency: 'EUR',
		counterparty: 'Wolkenfabrik Hosting GmbH'
	};
	const third = { id: 'T2', bookedOn: '2026-01-05', amountCents: -5000, currency: 'EUR' };
	const receipts = [
		// Open, from another year: among the choices.
		{
			id: 'R1',
			status: 'ausgelesen',
			vendor: 'Wolkenfabrik Hosting GmbH',
			amountCents: 1234,
			documentDate: '2025-03-05'
		},
		// Fully paid by another payment.
		{
			id: 'R2',
			status: 'ausgelesen',
			vendor: 'Wolkenfabrik Hosting GmbH',
			amountCents: 1234,
			documentDate: '2025-03-01'
		},
		// Partly paid elsewhere: an instalment among the choices, not here.
		{
			id: 'R3',
			status: 'ausgelesen',
			vendor: 'Stromwerk Test AG',
			amountCents: 10000,
			documentDate: '2026-01-01'
		},
		// Assigned to this payment already.
		{
			id: 'R4',
			status: 'ausgelesen',
			vendor: 'Druckerei Beispiel KG',
			amountCents: 1234,
			documentDate: '2026-03-08'
		},
		// Deleted.
		{ id: 'R5', deleted: true, vendor: 'Wolkenfabrik Hosting GmbH', amountCents: 1234 }
	];
	const matches = [
		{ id: 'M2', receiptId: 'R2', transactionId: 'T0', state: 'confirmed' },
		{ id: 'M3', receiptId: 'R3', transactionId: 'T2', state: 'confirmed' },
		{ id: 'M4', receiptId: 'R4', transactionId: 'T1', state: 'confirmed' },
		{ id: 'M5', receiptId: 'R5', transactionId: 'T0', state: 'confirmed' },
		// A rejected pair does not make a receipt assigned.
		{ id: 'M6', receiptId: 'R1', transactionId: 'T0', state: 'rejected' }
	];
	const transactions = [tx, other, third];
	const choices = receiptChoices(tx, receipts, matches, { transactions });

	it('lists the receipts fully assigned to another payment, with that payment', () => {
		expect(choices.map((c) => c.receipt.id).sort()).toEqual(['R1', 'R3']);
		const found = assignedElsewhere(tx, receipts, matches, transactions, choices);
		expect(found.map((c) => c.receipt.id)).toEqual(['R2']);
		expect(found[0].assignedTo.map((t) => t.id)).toEqual(['T0']);
		expect(found[0].suggested).toBe(false);
	});

	it('one assigned to a payment not here yet still shows, with no payment', () => {
		const found = assignedElsewhere(tx, receipts, matches, [tx], choices);
		expect(found.map((c) => c.receipt.id)).toEqual(['R2']);
		expect(found[0].assignedTo).toEqual([]);
	});
});

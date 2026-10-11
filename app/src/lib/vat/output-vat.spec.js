import { describe, expect, it } from 'vitest';

import { invoiceVat, outputVat, smallBusinessLimits } from './output-vat.js';

/** A made-up own invoice as the invoicing app sends it (ucep/issued.js). */
const invoice = (
	/** @type {string} */ id,
	/** @type {string} */ day,
	/** @type {number} */ gross,
	/** @type {any} */ vat
) => ({
	id,
	ownInvoice: true,
	status: 'ausgelesen',
	documentDate: day,
	amountCents: Math.round(gross * 100),
	extraction: { invoice_date: day, gross, ...(vat === undefined ? {} : { vat }) }
});
const pay = (/** @type {string} */ id, /** @type {string} */ day, /** @type {number} */ cents) => ({
	id,
	bookedOn: day,
	amountCents: cents
});
const link = (/** @type {string} */ receiptId, /** @type {string} */ transactionId) => ({
	receiptId,
	transactionId,
	state: 'confirmed'
});

const RECEIPTS = [
	// 1,190 € with 190 € VAT, issued in March, paid in April.
	invoice('R1', '2026-03-20', 1190, [{ rate: 19, amount: 190 }]),
	// 107 € at 7 %, issued and paid in May.
	invoice('R2', '2026-05-02', 107, [{ rate: 7, amount: 7 }]),
	// 238 € with 38 €, half paid in June, the rest open.
	invoice('R3', '2026-06-10', 238, [{ rate: 19, amount: 38 }]),
	// The app sent no VAT: counted as missing, never as zero.
	invoice('R4', '2026-02-01', 500, undefined),
	// No VAT charged (an export, a small business).
	invoice('R5', '2026-02-15', 300, []),
	// Someone else's receipt, no own invoice: not here.
	{
		id: 'X',
		status: 'ausgelesen',
		documentDate: '2026-03-01',
		extraction: { vat: [{ rate: 19, amount: 99 }] }
	}
];
const TRANSACTIONS = [
	pay('T1', '2026-04-03', 119000),
	pay('T2', '2026-05-05', 10700),
	pay('T3', '2026-06-20', 11900),
	pay('T4', '2026-02-20', 50000),
	pay('T5', '2026-02-20', 30000)
];
const MATCHES = [
	link('R1', 'T1'),
	link('R2', 'T2'),
	link('R3', 'T3'),
	link('R4', 'T4'),
	link('R5', 'T5')
];
const base = { receipts: RECEIPTS, matches: MATCHES, transactions: TRANSACTIONS, year: 2026 };
const q = (/** @type {any} */ v, /** @type {string} */ key) =>
	v.periods.find((/** @type {any} */ p) => p.key === key);

describe('output VAT (#195)', () => {
	it('what an invoice says: VAT per rate, none charged, or nothing said', () => {
		expect(invoiceVat(RECEIPTS[0])).toEqual({ kind: 'vat', byRate: { 19: 19000 }, gross: 119000 });
		expect(invoiceVat(RECEIPTS[4])).toEqual({ kind: 'none', gross: 30000 });
		expect(invoiceVat(RECEIPTS[3])).toEqual({ kind: 'missing', gross: 50000 });
	});

	it('Ist: when the money comes in, a part payment its share, the rest open', () => {
		const v = outputVat({ ...base, basis: 'ist' });
		expect(q(v, 'Q1').total).toBe(0); // issued in March, paid in April
		expect(q(v, 'Q2')).toMatchObject({ r19: 19000 + 1900, r7: 700, total: 21600, invoices: 3 });
		expect(v.year).toMatchObject({ r19: 20900, r7: 700, total: 21600 });
		expect(v.open).toEqual({ cents: 1900, invoices: 1 });
		expect(v.missing).toEqual({ cents: 50000, invoices: 1 });
		expect(v.none).toEqual({ cents: 30000, invoices: 1 });
	});

	it('Soll: on the invoice date, paid or not', () => {
		const v = outputVat({ ...base, basis: 'soll' });
		expect(q(v, 'Q1')).toMatchObject({ r19: 19000, total: 19000, invoices: 1 });
		expect(q(v, 'Q2')).toMatchObject({ r19: 3800, r7: 700, total: 4500 });
		expect(v.open.invoices).toBe(0);
		const months = outputVat({ ...base, basis: 'soll', period: 'month' });
		expect(q(months, '2026-03').total).toBe(19000);
	});

	it('a payment in the next year: its VAT belongs there, under Ist', () => {
		const late = {
			...base,
			transactions: [
				...TRANSACTIONS.slice(0, 2),
				pay('T3', '2027-01-10', 23800),
				...TRANSACTIONS.slice(3)
			]
		};
		expect(outputVat({ ...late, basis: 'ist' }).year.r19).toBe(19000);
		expect(outputVat({ ...late, year: 2027, basis: 'ist' }).year.r19).toBe(3800);
	});

	it('turnover is net, for the small-business limit; the limits by year', () => {
		const v = outputVat({ ...base, basis: 'soll' });
		// 1,000 + 100 + 200 net, 500 (VAT unknown, counted as given) and 300 without VAT.
		expect(v.turnover).toBe(100000 + 10000 + 20000 + 50000 + 30000);
		expect(smallBusinessLimits(2026)).toEqual({
			from: 2025,
			previousYear: 25_000,
			currentYear: 100_000
		});
		expect(smallBusinessLimits(2024)).toEqual({
			from: 2020,
			previousYear: 22_000,
			currentYear: 50_000
		});
	});
});

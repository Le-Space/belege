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

	it('Ist: a share paid in another fiscal year is neither open nor counted here (#539)', () => {
		// 2,380 € with 380 € VAT, issued in November: half paid in December, half in January.
		const split = {
			receipts: [invoice('S', '2026-11-20', 2380, [{ rate: 19, amount: 380 }])],
			transactions: [pay('P1', '2026-12-10', 119000), pay('P2', '2027-01-15', 119000)],
			matches: [link('S', 'P1'), link('S', 'P2')],
			basis: /** @type {const} */ ('ist')
		};
		const y2026 = outputVat({ ...split, year: 2026 });
		expect(y2026.year.r19).toBe(19000);
		expect(y2026.open).toEqual({ cents: 0, invoices: 0 });
		expect(y2026.elsewhere).toEqual({ cents: 19000, invoices: 1 });
		const y2027 = outputVat({ ...split, year: 2027 });
		expect(y2027.year.r19).toBe(19000);
		expect(y2027.open).toEqual({ cents: 0, invoices: 0 });
		expect(y2027.elsewhere).toEqual({ cents: 19000, invoices: 1 });
		// Paid only in part, the rest in the next year: the rest of the rest is open.
		const part = outputVat({
			...split,
			year: 2026,
			transactions: [pay('P1', '2026-12-10', 119000), pay('P2', '2027-01-15', 59500)]
		});
		expect(part.open).toEqual({ cents: 9500, invoices: 1 });
		expect(part.elsewhere).toEqual({ cents: 9500, invoices: 1 });
		// Soll: on the invoice date, nothing elsewhere.
		expect(outputVat({ ...split, year: 2026, basis: 'soll' }).elsewhere.invoices).toBe(0);
	});

	it('VAT missing: the gross without the share paid in another fiscal year (#539)', () => {
		const split = {
			receipts: [invoice('M', '2026-11-20', 2000, undefined)],
			transactions: [pay('P1', '2026-12-10', 50000), pay('P2', '2027-01-15', 100000)],
			matches: [link('M', 'P1'), link('M', 'P2')],
			year: 2026
		};
		// Paid in 2026: 500; in 2027: 1,000; open: 500 – the year names 1,000 of the 2,000.
		expect(outputVat({ ...split, basis: 'ist' }).missing).toEqual({ cents: 100000, invoices: 1 });
		expect(outputVat({ ...split, year: 2027, basis: 'ist' }).missing).toEqual({
			cents: 100000 + 50000,
			invoices: 1
		});
		expect(outputVat({ ...split, basis: 'soll' }).missing).toEqual({ cents: 200000, invoices: 1 });
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

describe('output VAT: credit notes, other currencies, rounding, no date (review 16.10.)', () => {
	const run = (/** @type {any} */ p) =>
		outputVat({ year: 2026, period: 'quarter', ...p, receipts: p.receipts ?? [] });

	it('Ist: a refunded credit note takes its VAT off again', () => {
		const out = run({
			basis: 'ist',
			receipts: [
				invoice('I', '2026-04-01', 1190, [{ rate: 19, amount: 190 }]),
				invoice('C', '2026-05-01', -119, [{ rate: 19, amount: -19 }])
			],
			transactions: [pay('P', '2026-04-05', 119000), pay('Q', '2026-05-10', -11900)],
			matches: [link('I', 'P'), link('C', 'Q')]
		});
		expect(out.year.r19).toBe(19000 - 1900);
		expect(out.open.invoices).toBe(0);
		expect(out.turnover).toBe(100000 - 10000);
	});

	it('Ist: another currency counts with the euros that came in, never its dollars as euros', () => {
		const usd = {
			...invoice('U', '2026-04-01', 1000, []),
			currency: 'USD',
			extraction: { invoice_date: '2026-04-01', gross: 1000, currency: 'USD', vat: [] }
		};
		const unpaid = { ...usd, id: 'V' };
		const out = run({
			basis: 'ist',
			receipts: [usd, unpaid],
			transactions: [pay('P', '2026-04-20', 92000)],
			matches: [link('U', 'P')]
		});
		expect(out.turnover).toBe(92000);
		expect(out.none).toEqual({ cents: 92000, invoices: 1 });
		expect(out.foreign).toEqual({ invoices: 1, currencies: ['USD'] });
	});

	it('Soll: another currency without euros known is apart, not summed', () => {
		const gbp = {
			...invoice('G', '2026-04-01', 1190, [{ rate: 19, amount: 190 }]),
			currency: 'GBP',
			extraction: {
				invoice_date: '2026-04-01',
				gross: 1190,
				currency: 'GBP',
				vat: [{ rate: 19, amount: 190 }]
			}
		};
		const out = run({ basis: 'soll', receipts: [gbp], transactions: [], matches: [] });
		expect(out.year.total).toBe(0);
		expect(out.turnover).toBe(0);
		expect(out.foreign).toEqual({ invoices: 1, currencies: ['GBP'] });
	});

	it('Ist: instalments add up to the invoice’s VAT to the cent', () => {
		// 1,01 € VAT, paid in two halves.
		const out = run({
			basis: 'ist',
			receipts: [invoice('H', '2026-04-01', 6.32, [{ rate: 19, amount: 1.01 }])],
			transactions: [pay('A', '2026-04-02', 316), pay('B', '2026-04-03', 316)],
			matches: [link('H', 'A'), link('H', 'B')]
		});
		expect(out.year.r19).toBe(101);
	});

	it('Soll: an own invoice without a date is shown, not lost', () => {
		const undated = invoice('D', '', 119, [{ rate: 19, amount: 19 }]);
		delete (/** @type {any} */ (undated).documentDate);
		delete (/** @type {any} */ (undated.extraction).invoice_date);
		const out = run({ basis: 'soll', receipts: [undated], transactions: [], matches: [] });
		expect(out.undated).toEqual({ cents: 11900, invoices: 1 });
		expect(out.year.total).toBe(0);
	});
});

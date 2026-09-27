// The year switch: which year a payment, a receipt and a question belong to.
// Made-up records only.
import { describe, expect, it } from 'vitest';

import { availableYears, defaultYear, fiscalYearOf, yearIndex, yearLabel } from './year.js';

/** @param {string} id @param {string} bookedOn @param {Record<string, any>} [extra] */
const tx = (id, bookedOn, extra = {}) => ({ id, bookedOn, amountCents: 1000, ...extra });
/** @param {string} id @param {string} documentDate @param {Record<string, any>} [extra] */
const receipt = (id, documentDate, extra = {}) => ({ id, documentDate, ...extra });

describe('fiscal years', () => {
	it('from January, and from July named by the year they start in', () => {
		expect(fiscalYearOf('2026-01-01')).toBe(2026);
		expect(fiscalYearOf('2025-12-31T23:00:00Z')).toBe(2025);
		expect(fiscalYearOf('2026-06-30', 7)).toBe(2025);
		expect(fiscalYearOf('2026-07-01', 7)).toBe(2026);
		expect(fiscalYearOf('')).toBeNull();
		expect(yearLabel(2026)).toBe('2026');
		expect(yearLabel(2025, 7)).toBe('2025/26');
	});
});

describe('the year of a thing is the year of its payment', () => {
	const books = {
		transactions: [
			tx('t-jan', '2026-01-12', { receiptId: 'r-dec-hand' }),
			tx('t-feb', '2026-02-03'),
			tx('t-old', '2025-11-20')
		],
		receipts: [
			receipt('r-dec', '2025-12-18'), // paid in January (match)
			receipt('r-dec-hand', '2025-12-20'), // paid in January (linked by hand)
			receipt('r-open', '2025-12-05'), // unpaid, a February payment is offered
			receipt('r-alone', '2025-10-01'), // unpaid, nothing offered
			{ id: 'r-new', receivedAt: '2026-03-01T08:00:00Z' }, // not read yet
			{ id: 'r-upload', receivedAt: null, createdAt: '2026-04-02T09:00:00Z' } // an image
		],
		matches: [
			{ receiptId: 'r-dec', transactionId: 't-jan', state: 'confirmed' },
			{ receiptId: 'r-alone', transactionId: 't-feb', state: 'rejected' }
		],
		questions: [
			{
				id: 'q-open',
				kind: 'unsure-match',
				state: 'open',
				receiptId: 'r-open',
				candidates: [{ transactionId: 't-feb' }]
			},
			{ id: 'q-old', kind: 'missing-receipt', state: 'open', transactionId: 't-old' },
			{ id: 'q-alone', kind: 'unknown-sender', state: 'open', receiptId: 'r-alone', candidates: [] }
		]
	};
	const index = yearIndex(books);
	const r = (/** @type {string} */ id) =>
		/** @type {any} */ (books.receipts.find((x) => x.id === id));
	const q = (/** @type {string} */ id) =>
		/** @type {any} */ (books.questions.find((x) => x.id === id));

	it('a December invoice paid in January is in the new year, and marked', () => {
		expect([...index.receiptYears(r('r-dec'))]).toEqual([2026]);
		expect([...index.receiptYears(r('r-dec-hand'))]).toEqual([2026]);
		expect(index.otherYear(r('r-dec'), 2026)).toBe(2025);
		expect(index.otherYear(r('r-new'), 2026)).toBeNull();
	});

	it('an unpaid receipt: its own year, and the year of a payment offered for it', () => {
		expect([...index.receiptYears(r('r-open'))].sort()).toEqual([2025, 2026]);
		// A rejected pair is no payment.
		expect([...index.receiptYears(r('r-alone'))]).toEqual([2025]);
		expect([...index.receiptYears(r('r-new'))]).toEqual([2026]);
		expect([...index.receiptYears(r('r-upload'))]).toEqual([2026]);
	});

	it('questions: of their payment, or of their receipt and the payments offered', () => {
		expect([...index.questionYears(q('q-old'))]).toEqual([2025]);
		expect([...index.questionYears(q('q-open'))].sort()).toEqual([2025, 2026]);
		expect([...index.questionYears(q('q-alone'))]).toEqual([2025]);
		const in2026 = books.questions.filter((x) => index.questionYears(x).has(2026));
		expect(in2026.map((x) => x.id)).toEqual(['q-open']);
	});

	it('payments by their booking day, with a fiscal year from July too', () => {
		expect(index.txYear(books.transactions[0])).toBe(2026);
		expect(yearIndex(books, 7).txYear(books.transactions[0])).toBe(2025);
	});

	it('offers the years with records and the current one, newest first', () => {
		expect(availableYears(books, '2027-02-01T00:00:00Z')).toEqual([2027, 2026, 2025]);
		expect(defaultYear(books, '2027-01-02T00:00:00Z')).toBe(2026);
		expect(defaultYear({ transactions: [] }, '2027-01-02T00:00:00Z')).toBe(2027);
		expect(availableYears({ transactions: [], receipts: [] }, '2026-05-01T00:00:00Z')).toEqual([
			2026
		]);
	});
});

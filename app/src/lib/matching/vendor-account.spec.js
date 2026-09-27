// The vendor account (issue #121). A made-up prepaid mobile tariff only.
import { describe, expect, it } from 'vitest';

import { looksPrepaid, vendorTimeline, cleanPrepaidVendors } from './vendor-account.js';
import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';

const NAME = 'Funkmobil Prepaid GmbH';
/** @param {string} id @param {string} bookedOn @param {number} amountCents */
const pay = (id, bookedOn, amountCents) => ({
	id,
	bookedOn,
	amountCents,
	counterparty: 'FUNKMOBIL PREPAID GMBH',
	purpose: 'Aufladung',
	accountId: 'bank',
	currency: 'EUR',
	deleted: false
});
/** @param {string} id @param {string} documentDate @param {number} gross @param {string} [excerpt] */
const stmt = (id, documentDate, gross, excerpt = '') => ({
	id,
	documentDate,
	vendor: NAME,
	extraction: { vendor: NAME, gross },
	excerpt,
	status: 'ausgelesen',
	deleted: false
});

const transactions = [pay('p1', '2026-02-03', -1500), pay('p2', '2026-05-04', -1500)];
const receipts = [
	stmt('s1', '2026-03-15', 1.98, 'Diese Rechnung stellt keine Zahlungsaufforderung dar.'),
	stmt('s2', '2026-04-15', 2.17),
	stmt('s3', '2026-06-15', 16.86)
];

describe('vendorTimeline', () => {
	it('top-ups and statements on one line, with the running balance', () => {
		const tl = vendorTimeline({
			transactions,
			receipts,
			name: NAME,
			from: '2026-01-01',
			until: '2026-12-31',
			openingCents: 0
		});
		expect(tl.rows.map((r) => [r.date, r.kind, r.balanceCents])).toEqual([
			['2026-02-03', 'payment', 1500],
			['2026-03-15', 'receipt', 1302],
			['2026-04-15', 'receipt', 1085],
			['2026-05-04', 'payment', 2585],
			['2026-06-15', 'receipt', 899]
		]);
		expect(tl).toMatchObject({ topUpCents: 3000, usageCents: 2101, closingCents: 899 });
		// May has no statement between April and June.
		expect(tl.findings).toEqual([{ kind: 'gap', month: '2026-05' }]);
	});

	it('up to a day; a negative balance and an unknown opening are found', () => {
		const tl = vendorTimeline({
			transactions: [],
			receipts,
			name: NAME,
			from: '2026-01-01',
			until: '2026-04-30'
		});
		expect(tl.rows).toHaveLength(2);
		expect(tl.findings.map((f) => f.kind)).toEqual(['unknown-opening', 'negative']);
	});

	it('top-ups without any statement; a statement early in January', () => {
		const onlyPay = vendorTimeline({
			transactions,
			receipts: [],
			name: NAME,
			from: '2026-01-01',
			until: '2026-12-31',
			openingCents: 0
		});
		expect(onlyPay.findings).toEqual([{ kind: 'no-statements' }]);
		const jan = vendorTimeline({
			transactions: [pay('p0', '2026-01-02', -1500)],
			receipts: [stmt('s0', '2026-01-15', 3.1)],
			name: NAME,
			from: '2026-01-01',
			until: '2026-12-31',
			openingCents: 0
		});
		expect(jan.findings).toEqual([{ kind: 'january', date: '2026-01-15', cents: 310 }]);
	});

	it('another vendor stays out', () => {
		const other = { ...pay('x', '2026-03-01', -999), counterparty: 'Stromwerk Test AG' };
		const tl = vendorTimeline({
			transactions: [...transactions, other],
			receipts,
			name: NAME,
			from: '2026-01-01',
			until: '2026-12-31',
			openingCents: 0
		});
		expect(tl.rows.some((r) => r.id === 'x')).toBe(false);
	});
});

describe('looksPrepaid', () => {
	it('round top-ups that never pair one to one', () => {
		expect(looksPrepaid({ transactions, receipts, name: NAME })).toBe(true);
	});
	it('not a vendor whose payments pair with its receipts', () => {
		const paired = [pay('a', '2026-03-16', -198), pay('b', '2026-04-16', -217)];
		expect(looksPrepaid({ transactions: paired, receipts, name: NAME })).toBe(false);
	});
});

describe('kept as a prepaid account', () => {
	it('its top-ups need no receipt, its statements are covered; unconfirmed nothing changes', async () => {
		const settings = { prepaidVendors: [{ name: NAME, openings: { 2026: 0 } }] };
		const ctx = await buildMatchingContext({ accounts: [], transactions, settings });
		expect(classifyTransaction(transactions[0], ctx)).toEqual({
			kind: 'prepaid-topup',
			vendor: NAME
		});
		expect(ctx.prepaidReceipt?.(receipts[0])).toBe(true);
		const plain = await buildMatchingContext({ accounts: [], transactions, settings: null });
		expect(classifyTransaction(transactions[0], plain)).toBeNull();
		expect(plain.prepaidReceipt?.(receipts[0])).toBe(false);
	});

	it('the settings keep names and whole-cent openings per year only', () => {
		expect(
			cleanPrepaidVendors([
				{ name: ' Funkmobil ', openings: { 2026: 1200, x: 5, 2025: 1.5 } },
				{ name: '' },
				'junk'
			])
		).toEqual([{ name: 'Funkmobil', openings: { 2026: 1200 } }]);
	});
});

import { describe, expect, it } from 'vitest';

import { inputVat, periodsOf, receiptVat } from './input-vat.js';

// Made-up receipts.
let n = 0;
/** @param {string} day @param {Record<string, any>} extraction @param {Record<string, any>} [more] */
const receipt = (day, extraction, more = {}) => ({
	id: `r${++n}`,
	source: 'upload',
	documentDate: day,
	extraction: { currency: 'EUR', gross: 119, vat: [{ rate: 19, amount: 19 }], ...extraction },
	...more
});

describe('input VAT from the receipts (#195)', () => {
	it('sums 19 % and 7 % per quarter and for the year, by receipt date', () => {
		const a = receipt('2026-01-15', {});
		const b = receipt('2026-03-31', { gross: 107, vat: [{ rate: 7, amount: 7 }] });
		// Mixed rates on one receipt: each line in its column.
		const c = receipt('2026-05-02', {
			gross: 226,
			vat: [
				{ rate: 19, amount: 19.0 },
				{ rate: 7, amount: 7.0 }
			]
		});
		const lastYear = receipt('2025-12-31', {});
		const vat = inputVat({ receipts: [a, b, c, lastYear], matches: [], year: 2026 });
		expect(vat.periods.map((p) => [p.key, p.r19, p.r7, p.total, p.receipts])).toEqual([
			['Q1', 1900, 700, 2600, 2],
			['Q2', 1900, 700, 2600, 1],
			['Q3', 0, 0, 0, 0],
			['Q4', 0, 0, 0, 0]
		]);
		expect(vat.year).toEqual({ r19: 3800, r7: 1400, total: 5200, receipts: 3 });
	});

	it('per month, and a fiscal year that starts in July', () => {
		expect(periodsOf(2026, 7, 'quarter').map((p) => p.months)).toEqual([
			['2026-07', '2026-08', '2026-09'],
			['2026-10', '2026-11', '2026-12'],
			['2027-01', '2027-02', '2027-03'],
			['2027-04', '2027-05', '2027-06']
		]);
		const inYear = receipt('2027-02-10', {});
		const before = receipt('2026-06-30', {});
		const vat = inputVat({
			receipts: [inYear, before],
			matches: [],
			year: 2026,
			startMonth: 7,
			period: 'month'
		});
		expect(vat.periods).toHaveLength(12);
		expect(vat.periods.find((p) => p.key === '2027-02')?.total).toBe(1900);
		expect(vat.year.total).toBe(1900);
	});

	it('a credit note lowers it; cents are rounded once per line', () => {
		const credit = receipt('2026-02-01', { gross: -59.5, vat: [{ rate: 19, amount: -9.5 }] });
		const odd = receipt('2026-02-02', { gross: 12.34, vat: [{ rate: 19, amount: 1.97 }] });
		const vat = inputVat({ receipts: [credit, odd], matches: [], year: 2026 });
		expect(vat.year.r19).toBe(-950 + 197);
	});

	it('foreign VAT, §13b, another currency and no VAT line stay out of the sum, each named', () => {
		const austria = receipt('2026-04-01', { gross: 120, vat: [{ rate: 20, amount: 20 }] });
		// 19 % too, but a foreign VAT ID: not German input VAT.
		const foreignId = receipt('2026-04-02', { vendor_vat_id: 'RO 12345678' });
		const german = receipt('2026-04-03', { vendor_vat_id: 'DE123456789' });
		const reverse = receipt('2026-04-04', { reverse_charge: true, net: 200, gross: 200, vat: [] });
		const dollars = receipt('2026-04-05', { currency: 'USD' });
		const noLine = receipt('2026-04-06', { gross: 50, vat: [] });
		const zeroLine = receipt('2026-04-07', { gross: 50, vat: [{ rate: 0, amount: 0 }] });
		const vat = inputVat({
			receipts: [austria, foreignId, german, reverse, dollars, noLine, zeroLine],
			matches: [],
			year: 2026
		});
		expect(vat.year).toEqual({ r19: 1900, r7: 0, total: 1900, receipts: 1 });
		expect(vat.foreign).toEqual({ cents: 2000 + 1900, receipts: 2 });
		expect(vat.reverse).toEqual({ cents: 20000, receipts: 1 });
		expect(vat.other.receipts).toBe(1);
		expect(vat.noLines.receipts).toBe(2);
		expect(receiptVat(german).kind).toBe('german');
	});

	it('only receipts that count: read, confirmed, not set aside, not our own invoices', () => {
		const ok = receipt('2026-06-01', {});
		const unread = { id: 'u', source: 'upload', documentDate: '2026-06-01' };
		const unconfirmed = receipt('2026-06-02', {}, { source: 'mail', authVerdict: 'fail' });
		const confirmed = receipt(
			'2026-06-03',
			{},
			{ source: 'mail', authVerdict: 'fail', confirmedByUser: true }
		);
		const aside = receipt('2026-06-04', {}, { status: 'ignoriert' });
		const own = receipt('2026-06-05', {}, { ownInvoice: true });
		const sent = receipt('2026-06-06', {}, { source: 'mail', outgoing: true });
		const deleted = receipt('2026-06-07', {}, { deleted: true });
		const undated = receipt('', {}, { documentDate: null });
		const vat = inputVat({
			receipts: [ok, unread, unconfirmed, confirmed, aside, own, sent, deleted, undated],
			matches: [],
			year: 2026
		});
		expect(vat.year.receipts).toBe(2);
		expect(vat.undated).toBe(1);
	});

	it('says how much belongs to receipts not linked to a payment yet', () => {
		const paid = receipt('2026-07-01', {});
		const open = receipt('2026-07-02', { gross: 238, vat: [{ rate: 19, amount: 38 }] });
		const rejected = receipt('2026-07-03', {});
		const vat = inputVat({
			receipts: [paid, open, rejected],
			matches: [
				{ receiptId: paid.id, transactionId: 't1', state: 'confirmed' },
				{ receiptId: rejected.id, transactionId: 't2', state: 'rejected' }
			],
			year: 2026
		});
		expect(vat.year.total).toBe(1900 + 3800 + 1900);
		expect(vat.unlinked).toEqual({ cents: 3800 + 1900, receipts: 2 });
	});
});

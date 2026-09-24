import { describe, expect, it } from 'vitest';

import {
	defaultMailMonths,
	groupReceiptsByMonth,
	mailWindow,
	matchesReceiptSearch,
	receiptDate,
	receiptVendor,
	sourceCounts,
	statusKey
} from './view.js';

const r = (/** @type {Record<string, any>} */ over) => ({ id: '01', source: 'upload', ...over });

describe('receipts view', () => {
	it('the date: the document date once read, else a mail arrival, else none', () => {
		expect(receiptDate(r({ documentDate: '2026-08-15', receivedAt: '2026-08-20T09:00:00Z' }))).toBe(
			'2026-08-15'
		);
		expect(receiptDate(r({ source: 'mail', receivedAt: '2026-08-20T09:00:00Z' }))).toBe(
			'2026-08-20'
		);
		expect(receiptDate(r({ receivedAt: '2026-08-20T09:00:00Z' }))).toBe(null);
	});

	it('groups by month, newest first, "Ohne Datum" last', () => {
		const groups = groupReceiptsByMonth([
			r({ id: '01', documentDate: '2026-07-03' }),
			r({ id: '02' }),
			r({ id: '03', documentDate: '2026-08-15' }),
			r({ id: '04', source: 'mail', receivedAt: '2026-08-20T10:00:00Z' }),
			r({ id: '05', documentDate: '2026-08-01' })
		]);
		expect(groups.map((g) => [g.month, g.label, g.items.map((i) => i.id)])).toEqual([
			['2026-08', 'August 2026', ['04', '03', '05']],
			['2026-07', 'Juli 2026', ['01']],
			['ohne', 'Ohne Datum', ['02']]
		]);
	});

	it('counts per source', () => {
		expect(
			sourceCounts([r({ source: 'mail' }), r({ source: 'mail' }), r({}), r({ source: 'folder' })])
		).toEqual({ all: 4, mail: 2, upload: 1, folder: 1 });
	});

	it('vendor: the extraction, else the sender name, else the file', () => {
		expect(receiptVendor(r({ vendor: 'Stromwerk Test AG', from: 'x <a@b>' }))).toBe(
			'Stromwerk Test AG'
		);
		expect(receiptVendor(r({ from: '"Wolkenfabrik" <rechnung@wolkenfabrik.example>' }))).toBe(
			'Wolkenfabrik'
		);
		expect(receiptVendor(r({ from: 'a@b.example' }))).toBe('a@b.example');
		expect(receiptVendor(r({ fileName: 'scan.pdf' }))).toBe('scan.pdf');
	});

	it('search: vendor, file, amount in both spellings, date both ways, invoice number', () => {
		const x = r({
			vendor: 'Wolkenfabrik Hosting GmbH',
			fileName: 'Rechnung-WF.pdf',
			amountCents: 119000,
			documentDate: '2026-08-15',
			extraction: { invoice_number: 'WF-2026-0815' }
		});
		for (const q of [
			'wolken',
			'rechnung-wf',
			'1190,00',
			'1190.00',
			'1.190,00',
			'15.08.2026',
			'2026-08',
			'wf-2026'
		]) {
			expect(matchesReceiptSearch(x, q), q).toBe(true);
		}
		expect(matchesReceiptSearch(x, 'stromwerk')).toBe(false);
		expect(matchesReceiptSearch(x, '  ')).toBe(true);
	});

	it('status badges: read but not matched is "Nicht zugeordnet"', () => {
		expect(statusKey(r({ status: 'neu' }))).toBe('new');
		expect(statusKey(r({ status: 'ausgelesen' }))).toBe('unassigned');
		expect(statusKey(r({ status: 'rückfrage' }))).toBe('question');
		expect(statusKey(r({ status: 'zugeordnet' }))).toBe('assigned');
		expect(statusKey(r({ status: 'ignoriert' }))).toBe('ignored');
	});

	it('the mail window: two months by default, the end open when it lies ahead', () => {
		const now = new Date('2026-09-24T10:00:00Z');
		expect(defaultMailMonths(now)).toEqual({ from: '2026-08', to: '2026-09' });
		expect(defaultMailMonths(new Date('2026-01-05T00:00:00Z'))).toEqual({
			from: '2025-12',
			to: '2026-01'
		});
		expect(mailWindow('2026-08', '2026-09', now)).toEqual({ since: '2026-08-01', until: null });
		expect(mailWindow('2026-06', '2026-07', now)).toEqual({
			since: '2026-06-01',
			until: '2026-08-01'
		});
		expect(mailWindow('2026-07', '2026-06', now)).toEqual({
			since: '2026-06-01',
			until: '2026-08-01'
		});
		expect(mailWindow('2025-12', '2025-12', now)).toEqual({
			since: '2025-12-01',
			until: '2026-01-01'
		});
	});
});

// "Beleg finden": with no receipt scoring, the list is ordered by how near a
// receipt is in time to the payment, not by which was added last – so a
// payment from January 2025 does not open on receipts from 2026. Made up.
import { describe, expect, it } from 'vitest';
import { receiptChoices, receiptDay } from './view.js';

/** A ULID-like id, in the order the receipts were added. @param {number} n */
const id = (n) => `01J${String(n).padStart(23, '0')}`;
const tx = {
	id: 'T',
	bookedOn: '2025-01-02',
	amountCents: 500000,
	counterparty: 'Beispiel Kredit'
};

describe('receiptChoices: equal points, nearest in time first', () => {
	it('a receipt from around the payment comes before newer ones; undated last', () => {
		const receipts = [
			{
				id: id(1),
				status: 'ausgelesen',
				documentDate: '2024-12-30',
				vendor: 'Alt GmbH',
				amountCents: 1190
			},
			{
				id: id(2),
				status: 'ausgelesen',
				documentDate: '2026-03-01',
				vendor: 'Neu GmbH',
				amountCents: 2380
			},
			// Not read yet: placed by when it came in.
			{
				id: id(3),
				status: 'neu',
				source: 'upload',
				receivedAt: '2026-10-20T08:00:00Z',
				fileName: 'scan.pdf'
			},
			{
				id: id(4),
				status: 'ausgelesen',
				documentDate: '2025-01-15',
				vendor: 'Januar GmbH',
				amountCents: 4760
			},
			// Nothing to place it by at all.
			{ id: id(5), status: 'neu', source: 'upload', fileName: 'ohne.pdf' }
		];
		const order = receiptChoices(/** @type {any} */ (tx), receipts, []).map((c) => c.receipt.id);
		// 30.12.2024 has points (date); then by nearness: 15.1.2025, 1.3.2026,
		// the scan that came in on 20.10.2026, and the one with no day at all.
		expect(order).toEqual([id(1), id(4), id(2), id(3), id(5)]);
	});

	it('receiptDay: its date, else when it came in', () => {
		expect(receiptDay(/** @type {any} */ ({ documentDate: '2025-01-15' }))).toBe('2025-01-15');
		expect(receiptDay(/** @type {any} */ ({ receivedAt: '2026-10-20T08:00:00Z' }))).toBe(
			'2026-10-20'
		);
		expect(receiptDay(/** @type {any} */ ({ createdAt: '2026-10-21T09:00:00Z' }))).toBe(
			'2026-10-21'
		);
		expect(receiptDay(/** @type {any} */ ({}))).toBe(null);
	});
});

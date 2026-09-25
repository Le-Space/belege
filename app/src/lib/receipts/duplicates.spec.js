import { describe, expect, it } from 'vitest';

import { findDuplicates } from './duplicates.js';

const inv = (/** @type {string} */ id, /** @type {Record<string, any>} */ over = {}) => ({
	id,
	vendor: 'Wolkenfabrik Hosting GmbH',
	invoiceNumber: 'WF-2026-0815',
	amountCents: 11900,
	status: 'ausgelesen',
	createdAt: `2026-09-0${id.length}T00:00:00Z`,
	...over
});

describe('findDuplicates', () => {
	it('same vendor and invoice number: the linked one is kept, the other marked', () => {
		const a = inv('A');
		const b = inv('BB');
		const d = findDuplicates([a, b], (id) => (id === 'BB' ? { transactionId: 'T1' } : null));
		expect([...d]).toEqual([['A', { of: 'BB' }]]);
	});
	it('without a link the oldest is kept; separators and case do not matter', () => {
		const d = findDuplicates(
			[inv('BB'), inv('A', { invoiceNumber: 'wf 2026 0815', vendor: 'WOLKENFABRIK HOSTING' })],
			() => null
		);
		expect([...d]).toEqual([['BB', { of: 'A' }]]);
	});
	it('not: other amounts, other vendor, short or no number, set aside already', () => {
		const none = () => null;
		expect(findDuplicates([inv('A'), inv('BB', { amountCents: 5900 })], none).size).toBe(0);
		expect(findDuplicates([inv('A'), inv('BB', { vendor: 'Stromwerk Test AG' })], none).size).toBe(
			0
		);
		expect(
			findDuplicates([inv('A', { invoiceNumber: '12' }), inv('BB', { invoiceNumber: '12' })], none)
				.size
		).toBe(0);
		expect(findDuplicates([inv('A'), inv('BB', { status: 'ignoriert' })], none).size).toBe(0);
	});
});

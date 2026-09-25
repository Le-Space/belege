import { describe, expect, it } from 'vitest';

import { foundByAi, inOrigin, matchOrigin, originCounts } from './origin.js';

const auto = { state: 'auto', score: 100, reasons: ['amount', 'invoice-number', 'date'] };
const learned = { state: 'auto', score: 90, reasons: ['amount', 'vendor-learned', 'date'] };
const confirmed = { state: 'confirmed', score: 70, reasons: ['amount', 'vendor', 'date'] };
const byHand = { state: 'confirmed', score: 40, reasons: ['amount', 'manual'] };

describe('matchOrigin', () => {
	it('automatic with points, learned, confirmed, by hand; none without a match', () => {
		expect(matchOrigin(auto)).toEqual({ kind: 'auto', score: 100 });
		expect(matchOrigin(learned)).toEqual({ kind: 'auto-learned', score: 90 });
		expect(matchOrigin(confirmed)).toEqual({ kind: 'confirmed', score: 70 });
		expect(matchOrigin(byHand)).toEqual({ kind: 'manual', score: 40 });
		expect(matchOrigin({ state: 'confirmed', score: null, reasons: ['manual'] })).toEqual({
			kind: 'manual',
			score: null
		});
		expect(matchOrigin(null)).toBeNull();
	});
});

describe('foundByAi', () => {
	it('only the KI search counts; older receipts have no foundBy', () => {
		expect(
			foundByAi({
				foundBy: { kind: 'mail-assist', confidence: 'high', reason: 'PDF vom Anbieter', model: 'm' }
			})
		).toEqual({ confidence: 'high', reason: 'PDF vom Anbieter', model: 'm' });
		expect(foundByAi({ foundBy: { kind: 'mail-assist' } })).toEqual({
			confidence: null,
			reason: null,
			model: null
		});
		expect(foundByAi({ foundBy: { kind: 'mail-search' } })).toBeNull();
		expect(foundByAi({})).toBeNull();
	});
});

describe('filters and counts', () => {
	const receipts = [
		{ id: 'A', status: 'zugeordnet' },
		{ id: 'B', status: 'zugeordnet', foundBy: { kind: 'mail-assist' } },
		{ id: 'C', status: 'zugeordnet' },
		{ id: 'D', status: 'zugeordnet' },
		{ id: 'E', status: 'ausgelesen' },
		{ id: 'F', status: 'ignoriert' }
	];
	/** @type {Record<string, any>} */
	const matches = { A: auto, B: learned, C: confirmed, D: byHand };
	const matchOf = (/** @type {string} */ id) => matches[id] ?? null;

	it('each linked receipt in exactly one match filter; KI across them', () => {
		expect(originCounts(receipts, matchOf)).toEqual({
			auto: 2,
			confirmed: 1,
			manual: 1,
			ai: 1,
			open: 1,
			ignored: 1
		});
		const c = originCounts(receipts, matchOf);
		expect(c.auto + c.confirmed + c.manual + c.open + c.ignored).toBe(receipts.length);
		expect(inOrigin(receipts[1], matchOf('B'), 'ai')).toBe(true);
		expect(inOrigin(receipts[4], null, 'open')).toBe(true);
		expect(inOrigin(receipts[5], null, 'open')).toBe(false);
	});
});

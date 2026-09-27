// Storage and AI usage: peak time, calls from old and new events, cost,
// periods, tokens per receipt, the price table. Made-up numbers only.
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_PRICES,
	aiUsage,
	booksStats,
	callsOf,
	cleanPrices,
	costOf,
	isPeak,
	periods,
	tokensPerReceipt
} from './usage.js';

describe('peak time (DeepSeek)', () => {
	it('01–04 and 06–10 UTC on weekdays', () => {
		expect(isPeak('2026-09-28T02:30:00Z')).toBe(true); // Monday
		expect(isPeak('2026-09-28T04:00:00Z')).toBe(false);
		expect(isPeak('2026-09-28T09:59:00Z')).toBe(true);
		expect(isPeak('2026-09-28T12:00:00Z')).toBe(false);
		expect(isPeak('2026-09-27T02:30:00Z')).toBe(false); // Sunday
	});
});

describe('calls and cost', () => {
	it('per-call records as they are; an old total as an estimate', () => {
		expect(
			callsOf({
				calls: [{ model: 'deepseek-flash', prompt: 1000, cached: 400, completion: 200 }]
			})
		).toEqual([
			{ model: 'deepseek-flash', prompt: 1000, cached: 400, completion: 200, estimated: false }
		]);
		expect(
			callsOf({ model: 'deepseek-flash', tokensTotal: 1500, tokens: { prompt: 1200 } })
		).toEqual([
			{ model: 'deepseek-flash', prompt: 1200, cached: 0, completion: 300, estimated: true }
		]);
		expect(callsOf({ tokensTotal: 0 })).toEqual([]);
	});

	it('uncached input, cached input and output at their prices; off peak at half', () => {
		const call = {
			model: 'deepseek-flash',
			prompt: 1_000_000,
			cached: 500_000,
			completion: 100_000
		};
		// 0.5M × 0.30 + 0.5M × 0.006 + 0.1M × 1.20 = 0.15 + 0.003 + 0.12
		expect(costOf(call, '2026-09-28T02:00:00Z', DEFAULT_PRICES)).toBeCloseTo(0.273, 6);
		expect(costOf(call, '2026-09-28T12:00:00Z', DEFAULT_PRICES)).toBeCloseTo(0.1365, 6);
		expect(costOf({ ...call, model: 'other' }, '2026-09-28T12:00:00Z', DEFAULT_PRICES)).toBeNull();
	});

	it('sums by purpose since a moment; names models without a price', () => {
		const events = [
			{
				kind: 'extract',
				at: '2026-09-28T12:00:00Z',
				ok: true,
				calls: [{ model: 'deepseek-flash', prompt: 2000, cached: 0, completion: 500 }]
			},
			{
				kind: 'match-assist',
				at: '2026-09-28T12:05:00Z',
				model: 'deepseek-v4-pro',
				tokensTotal: 1000
			},
			{
				kind: 'mail-assist',
				at: '2026-09-28T12:06:00Z',
				calls: [{ model: 'mystery', prompt: 10, completion: 5 }]
			},
			{
				kind: 'extract',
				at: '2026-09-01T12:00:00Z',
				ok: true,
				calls: [{ model: 'deepseek-flash', prompt: 99999, completion: 1 }]
			},
			{ kind: 'bank-sync', at: '2026-09-28T12:00:00Z' }
		];
		const u = aiUsage(events, '2026-09-28T00:00:00Z', DEFAULT_PRICES);
		expect(u).toMatchObject({ calls: 3, tokens: 3515, estimated: true, unpriced: ['mystery'] });
		expect(u.byKind.extract).toMatchObject({ calls: 1, tokens: 2500 });
		expect(u.cost).toBeGreaterThan(0);
		expect(tokensPerReceipt(events, '2026-09-28T00:00:00Z')).toBe(2500);
		expect(tokensPerReceipt([], '2026-09-28T00:00:00Z')).toBeNull();
	});
});

describe('periods and books', () => {
	it('today, the last seven days, this month', () => {
		const p = periods(new Date(2026, 8, 27, 15, 0));
		expect(new Date(p.today).getDate()).toBe(27);
		expect(new Date(p.week).getDate()).toBe(21);
		expect(new Date(p.month).getDate()).toBe(1);
	});

	it('records per collection and the receipt files, deleted ones too', () => {
		const s = booksStats({
			transactions: [{}, {}],
			receipts: [
				{ fileCid: 'a', size: 1000 },
				{ fileCid: 'b', size: 500, deleted: true },
				{ fileCid: null }
			],
			matches: [{}],
			questions: [],
			events: [{}, {}, {}]
		});
		expect(s).toMatchObject({ files: 2, fileBytes: 1500 });
		expect(s.counts).toMatchObject({ transactions: 2, receipts: 3, matches: 1, events: 3 });
	});
});

describe('the price table', () => {
	it('the default when nothing is kept; a kept table cleaned', () => {
		expect(cleanPrices(null)).toBe(DEFAULT_PRICES);
		const t = cleanPrices({
			currency: 'EUR',
			checkedOn: '2026-10-01',
			offPeakFactor: 2,
			models: {
				'x-model': { input: '0.5', cached: 0.1, output: 1 },
				'bad name!': { input: 1, cached: 1, output: 1 },
				neg: { input: -1, cached: 0, output: 0 }
			}
		});
		expect(t).toMatchObject({ currency: 'EUR', checkedOn: '2026-10-01', offPeakFactor: 1 });
		expect(Object.keys(t.models)).toEqual(['x-model']);
		expect(t.models['x-model']).toEqual({ input: 0.5, cached: 0.1, output: 1 });
	});
});

// The shared exact-sum pick of travel payouts and outlay repayments (#539):
// the oldest amounts that add up exactly, else the oldest until used up, and
// a search that stays bounded however many amounts there are.
import { describe, expect, it } from 'vitest';

import { EXACT_SUM_MAX_SUMS, pickBySum } from './exact-sum.js';

describe('pickBySum', () => {
	it('the amounts that add up exactly, the oldest preferred', () => {
		expect(pickBySum(150, [100, 50, 150])).toEqual([0, 1]);
		expect(pickBySum(150, [70, 100, 50])).toEqual([1, 2]);
		expect(pickBySum(70, [70, 100, 50])).toEqual([0]);
	});

	it('without an exact sum: the oldest until the target is used up', () => {
		expect(pickBySum(120, [100, 50, 30])).toEqual([0, 1]);
		expect(pickBySum(1000, [100, 50])).toEqual([0, 1]);
		expect(pickBySum(0, [100])).toEqual([]);
	});

	it('only the oldest of the pool take part in the exact search', () => {
		expect(pickBySum(5, [1, 1, 1, 5], { pool: 3 })).toEqual([0, 1, 2, 3]);
		expect(pickBySum(5, [1, 1, 1, 5], { pool: 4 })).toEqual([3]);
	});

	it('past the cap on partial sums there is no exact match, and the fallback answers', () => {
		expect(pickBySum(6, [1, 2, 4], { maxSums: 3 })).toEqual([0, 1, 2]);
		expect(pickBySum(4, [1, 2, 4], { maxSums: 3 })).toEqual([0, 1, 2]);
		expect(pickBySum(4, [1, 2, 4], { maxSums: 8 })).toEqual([2]);
	});

	it('many distinct amounts keep the search bounded', () => {
		// 24 powers of two reach every sum below 2^24: unbounded, millions of partial sums.
		const amounts = Array.from({ length: 24 }, (_, i) => 2 ** i);
		const started = performance.now();
		const picked = pickBySum(2 ** 23, amounts);
		expect(performance.now() - started).toBeLessThan(500);
		// Bounded: no exact match found, the oldest until used up.
		expect(picked).toEqual(Array.from({ length: 24 }, (_, i) => i));
		expect(EXACT_SUM_MAX_SUMS).toBeLessThan(2 ** 23);
	});
});

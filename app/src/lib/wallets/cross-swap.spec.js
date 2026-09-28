// Swaps across chains, from an IBC memo (issue #170). Made-up addresses and amounts.
import { describe, expect, it } from 'vitest';

import { crossSwapOf, sameKey } from './cross-swap.js';

import { bech, skipMemo } from './cross-swap.fixtures.js';

describe('a swap across chains in an IBC memo', () => {
	it('names the receiver, the least amount, the hops and the fees', () => {
		expect(crossSwapOf(skipMemo())).toEqual({
			router: 'skip-go',
			receiver: bech('akash', 2),
			recover: bech('osmo', 2),
			minAmount: '15000000',
			hops: 2,
			feeBps: 75
		});
	});

	it('any other memo is none', () => {
		for (const memo of ['', 'Miete Mai', '{"forward":{"receiver":"x"}}', '{not json', null, 42]) {
			expect(crossSwapOf(memo)).toBeNull();
		}
		expect(crossSwapOf(skipMemo({ receiver: 'nobody' }))).toBeNull();
		expect(crossSwapOf(skipMemo({ min: '-1' }))).toBeNull();
	});

	it('the same key on two chains, whatever the prefix', () => {
		expect(sameKey(bech('n', 2), bech('akash', 2))).toBe(true);
		expect(sameKey(bech('n', 2), bech('akash', 3))).toBe(false);
	});
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Network fees grouped by wallet and month. Made-up wallets and amounts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupNetworkFees, isNetworkFeeEntry } from '../src/index.js';

/**
 * @param {number} i
 * @param {Partial<import('../src/index.js').LedgerEntry>} [over]
 */
const fee = (i, over = {}) => {
	const time = over.time ?? `2026-04-14T08:${String(i % 60).padStart(2, '0')}:00.000Z`;
	return {
		id: `akash:akash1wallet:H${i}:fee`,
		chain: 'akash',
		network: 'mainnet',
		account: 'akash1wallet',
		hash: `H${i}`,
		time,
		date: time.slice(0, 10),
		type: /** @type {const} */ ('fee'),
		kind: /** @type {const} */ ('fee'),
		asset: 'AKT',
		amount: '-0.001234',
		success: true,
		...over
	};
};

test('a month with many fees is one group', () => {
	const entries = Array.from({ length: 30 }, (_, i) => fee(i));
	const [g, ...rest] = groupNetworkFees(entries);
	assert.equal(rest.length, 0);
	assert.equal(g.key, 'akash|mainnet|akash1wallet|2026-04|AKT');
	assert.equal(g.month, '2026-04');
	assert.equal(g.count, 30);
	assert.equal(g.amount, '-0.03702');
	assert.equal(g.eur, null);
	assert.equal(g.ids.length, 30);
	assert.equal(g.ids[0], 'akash:akash1wallet:H0:fee');
	assert.equal(g.first, '2026-04-14T08:00:00.000Z');
	assert.equal(g.last, '2026-04-14T08:29:00.000Z');
});

test('a single fee stays ungrouped; min sets the fewest', () => {
	assert.deepEqual(groupNetworkFees([fee(1)]), []);
	assert.equal(groupNetworkFees([fee(1)], { min: 1 }).length, 1);
	assert.equal(groupNetworkFees([fee(1), fee(2)], { min: 3 }).length, 0);
});

test('fees across a month boundary land in two months, newest first', () => {
	const groups = groupNetworkFees([
		fee(1, { time: '2026-03-31T23:50:00.000Z' }),
		fee(2, { time: '2026-03-31T23:55:00.000Z' }),
		fee(3, { time: '2026-04-01T00:05:00.000Z' }),
		fee(4, { time: '2026-04-01T00:10:00.000Z' })
	]);
	assert.deepEqual(
		groups.map((g) => [g.month, g.count]),
		[
			['2026-04', 2],
			['2026-03', 2]
		]
	);
});

test('the month follows the entry date the caller hands in', () => {
	// A caller with local booking days hands its own `date`.
	const groups = groupNetworkFees([
		fee(1, { time: '2026-03-31T23:50:00.000Z', date: '2026-04-01' }),
		fee(2, { time: '2026-04-01T08:00:00.000Z' })
	]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].month, '2026-04');
});

test('two wallets and two assets make groups of their own', () => {
	const groups = groupNetworkFees([
		fee(1),
		fee(2),
		fee(3, { account: 'akash1other', id: 'o3' }),
		fee(4, { account: 'akash1other', id: 'o4' }),
		fee(5, { asset: 'ACT', id: 'a5' }),
		fee(6, { asset: 'ACT', id: 'a6' })
	]);
	assert.deepEqual(
		groups.map((g) => `${g.account} ${g.asset} ${g.count}`),
		['akash1other AKT 2', 'akash1wallet ACT 2', 'akash1wallet AKT 2']
	);
});

test('rates give the sum in EUR; tiny fees do not round to zero', () => {
	// 30 fees of 0.001234 AKT at 0.8 EUR: 0.0009872 EUR each, 0.029616 in all.
	const entries = Array.from({ length: 30 }, (_, i) => fee(i));
	const [g] = groupNetworkFees(entries, { rate: () => '0.8' });
	assert.equal(g.eur, '-0.03');
	assert.equal(g.eurMissing, 0);
});

test('a fee without a rate leaves the EUR sum open and says how many', () => {
	const [g] = groupNetworkFees([fee(1), fee(2), fee(3)], {
		rate: (e) => (e.hash === 'H2' ? null : '2.5')
	});
	assert.equal(g.eur, null);
	assert.equal(g.eurMissing, 1);
});

test('only network fees count; failed transactions pay theirs too', () => {
	const sent = fee(1, { type: 'sent', kind: 'transfer', id: 's1' });
	const storage = fee(2, { kind: 'storage', purpose: 'storage', id: 'd2' });
	const failed = fee(3, { success: false });
	assert.equal(isNetworkFeeEntry(sent), false);
	assert.equal(isNetworkFeeEntry(storage), false);
	assert.equal(isNetworkFeeEntry(failed), true);
	const [g] = groupNetworkFees([sent, storage, failed, fee(4)]);
	assert.deepEqual(g.ids, ['akash:akash1wallet:H3:fee', 'akash:akash1wallet:H4:fee']);
});

test('an unknown grouping throws', () => {
	// @ts-expect-error not a grouping
	assert.throws(() => groupNetworkFees([], { by: 'wallet-week' }), /unknown grouping/);
});

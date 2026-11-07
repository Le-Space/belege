// SPDX-License-Identifier: AGPL-3.0-or-later
// A made-up Aleph account and month for the tests (Node and browser): a
// purchase before August at 0.000002 USD per credit, then storage, an
// instance, a transfer in and one out, and a line in September.

export const ACCOUNT = `0x${'a1'.repeat(20)}`;
export const OTHER = `0x${'b2'.repeat(20)}`;
export const VM = 'c3'.repeat(32);
export const BILLING = 'd4'.repeat(32);

/** @returns {import('./aleph-fetch.js').Row[]} */
export function sampleRows() {
	return [
		{
			at: '2026-07-20T08:00:00.000Z',
			amount: 1_000_000,
			price: '0.000002',
			txHash: `0x${'ab'.repeat(32)}`,
			token: 'ALEPH',
			chain: 'ETH'
		},
		{
			at: '2026-08-01T00:30:00.000Z',
			amount: -100,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 3,
			sizeMib: 12.5
		},
		{
			at: '2026-08-01T01:30:00.000Z',
			amount: -100,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 4,
			sizeMib: 13
		},
		{
			at: '2026-08-01T02:00:00.000Z',
			amount: -2000,
			paymentMethod: 'credit_expense',
			originRef: BILLING,
			origin: VM
		},
		{ at: '2026-08-15T12:00:00.000Z', amount: 50_000, origin: OTHER },
		{
			at: '2026-08-20T12:00:00.000Z',
			amount: -5_000,
			paymentMethod: 'credit_transfer',
			origin: OTHER
		},
		{
			at: '2026-09-01T00:30:00.000Z',
			amount: -120,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 4,
			sizeMib: 13
		}
	];
}

/** Balance now: 2,000,000 before July, then every row. */
export const sampleBalance = () => 2_000_000 + sampleRows().reduce((n, r) => n + r.amount, 0);

/** EUR per USD, the same every day. */
export const flatUsd = {
	rate: async (/** @type {string} */ asset, /** @type {string} */ date) => ({
		asset,
		date,
		rate: '0.9',
		source: 'ecb'
	})
};

import { describe, expect, it } from 'vitest';

import { explorerMonthBalances, historyMonthBalances, monthsFromPoints } from './month-balances.js';

// Made-up movements of a made-up wallet.

/** @param {string} time @param {'sent' | 'received' | 'fee'} type @param {string} amount @param {Record<string, any>} [over] */
const entry = (time, type, amount, over = {}) =>
	/** @type {import('../bridge/client.js').WalletEntry} */ ({
		id: `${time}:${type}`,
		hash: 'h',
		height: 1,
		time,
		date: time.slice(0, 10),
		type,
		kind: type === 'fee' ? 'fee' : 'transfer',
		asset: 'NYM',
		amount,
		decimals: 6,
		counterparty: '',
		counterpartyLabel: '',
		memo: '',
		success: true,
		explorerUrl: '',
		...over
	});

describe('month balances from the source (#287, step 3)', () => {
	it('a running balance: each month from the one before, months without a change carried on', () => {
		const points = [
			{ time: '2026-02-10T09:00:00Z', value: '500' },
			{ time: '2026-02-20T09:00:00Z', value: '450' },
			{ time: '2026-04-02T09:00:00Z', value: '310' }
		];
		expect(monthsFromPoints(points, '2026-05', 'explorer')).toEqual({
			'2026-02': { opening: '0', closing: '450', source: 'explorer' },
			'2026-03': { opening: '450', closing: '450', source: 'explorer' },
			'2026-04': { opening: '450', closing: '310', source: 'explorer' },
			'2026-05': { opening: '310', closing: '310', source: 'explorer' }
		});
		// Across a year's end.
		expect(
			Object.keys(
				monthsFromPoints([{ time: '2025-11-30T23:00:00Z', value: '1' }], '2026-01', 'history')
			)
		).toEqual(['2025-11', '2025-12', '2026-01']);
		expect(monthsFromPoints([], '2026-05', 'explorer')).toEqual({});
	});

	it('the explorer’s history of the asset asked for, none for another', () => {
		const history = [
			{ asset: 'ETH', decimals: 18, points: [{ time: '2026-03-01T00:00:00Z', value: '7' }] }
		];
		expect(explorerMonthBalances(history, 'ETH', '2026-03')).toEqual({
			'2026-03': { opening: '0', closing: '7', source: 'explorer' }
		});
		expect(explorerMonthBalances(history, 'USDC', '2026-03')).toBeNull();
		expect(explorerMonthBalances(undefined, 'ETH', '2026-03')).toBeNull();
	});

	it('the history summed: a failed transfer moves nothing but pays its fee', () => {
		const entries = [
			entry('2026-07-03T10:00:00Z', 'received', '100'),
			entry('2026-08-15T10:00:00Z', 'sent', '-40'),
			entry('2026-08-15T10:00:00Z', 'fee', '-0.005'),
			entry('2026-09-01T10:00:00Z', 'sent', '-10', { success: false }),
			entry('2026-09-01T10:00:00Z', 'fee', '-0.003', { success: false }),
			entry('2026-09-02T10:00:00Z', 'received', '1', { asset: 'NYX' })
		];
		expect(historyMonthBalances(entries, 'NYM', 6, '59.992', '2026-10')).toEqual({
			'2026-07': { opening: '0', closing: '100000000', source: 'history' },
			'2026-08': { opening: '100000000', closing: '59995000', source: 'history' },
			'2026-09': { opening: '59995000', closing: '59992000', source: 'history' },
			'2026-10': { opening: '59992000', closing: '59992000', source: 'history' }
		});
	});

	it('a history that does not add up to today’s balance gives none', () => {
		// The source lists no fee for the transfer (a rollup's L1 fee, say): off by it.
		const entries = [
			entry('2026-07-03T10:00:00Z', 'received', '100'),
			entry('2026-08-15T10:00:00Z', 'sent', '-40')
		];
		expect(historyMonthBalances(entries, 'NYM', 6, '59.995', '2026-10')).toBeNull();
		expect(historyMonthBalances(entries, 'NYM', 6, null, '2026-10')).toBeNull();
	});
});

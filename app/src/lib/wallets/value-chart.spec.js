import { describe, expect, it } from 'vitest';
import { valueSeries } from '@le-space/charts';

import {
	bookRates,
	chartModel,
	chartPeriod,
	loadRates,
	neededRates,
	rateSource,
	rateSpans,
	walletHoldings
} from './value-chart.js';

// Made-up wallets, bookings and rates.

/** @type {any[]} */
const wallets = [
	{ id: 'nyx:n1aaa', chain: 'nyx', address: 'n1aaa' },
	{ id: 'nyx:n1bbb', chain: 'nyx', address: 'n1bbb' },
	{ id: 'base:0xccc', chain: 'base', address: '0xccc' }
];
const accounts = [
	// Anchored at the balance the source reports.
	{
		id: 'acc-a',
		kind: 'wallet',
		source: 'nyx',
		walletAddress: 'n1aaa',
		asset: 'NYM',
		decimals: 6,
		balance: '60',
		balanceOn: '2026-10-04'
	},
	{
		id: 'acc-b',
		kind: 'wallet',
		source: 'nyx',
		walletAddress: 'n1bbb',
		asset: 'NYM',
		decimals: 6,
		balance: '40',
		balanceOn: '2026-10-04'
	},
	// A token by its contract, without a balance from the source: from its bookings alone.
	{
		id: 'acc-c',
		kind: 'wallet',
		source: 'base',
		walletAddress: '0xccc',
		asset: 'WOLKE',
		decimals: 2,
		balance: null,
		balanceOn: null,
		tokenContract: '0xABCDEF0000000000000000000000000000000001'
	},
	{ id: 'acc-bank', kind: 'bank', source: 'bank' },
	{
		id: 'acc-gone',
		kind: 'wallet',
		source: 'nyx',
		walletAddress: 'n1aaa',
		asset: 'X',
		decimals: 0,
		deleted: true
	}
];
/** @param {string} accountId @param {string} bookedOn @param {string} quantity @param {string} rate @param {string} [source] */
const tx = (accountId, bookedOn, quantity, rate, source = 'coingecko') => ({
	id: `${accountId}:${bookedOn}:${quantity}`,
	accountId,
	bookedOn,
	quantity,
	valuation: { rate, source }
});
const transactions = [
	tx('acc-a', '2026-09-20', '100000000', '0.04'),
	tx('acc-a', '2026-10-02', '-40000000', '0.06'),
	tx('acc-b', '2026-10-02', '40000000', '0.06'),
	tx('acc-c', '2026-09-30', '500', '2', 'dex'),
	tx('acc-c', '2026-10-03', '250', '3', 'dex'),
	{ ...tx('acc-a', '2026-10-03', '999', '9'), deleted: true },
	{ id: 'euro', accountId: 'acc-bank', bookedOn: '2026-10-02', amountCents: -500 }
];
const from = '2026-10-01';
const to = '2026-10-04';
const TOKEN = 'WOLKE@base:0xabcdef0000000000000000000000000000000001';

describe('the wallets’ value per day (#908)', () => {
	it('the last two months, to the day', () => {
		expect(chartPeriod('2026-11-21')).toEqual({ from: '2026-09-22', to: '2026-11-21' });
		// No 31 September: the period starts after that month's last day.
		expect(chartPeriod('2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-11-30' });
		expect(chartPeriod('2027-01-15')).toEqual({ from: '2026-11-16', to: '2027-01-15' });
	});

	it('holdings: anchored at the source’s balance, else from the bookings', () => {
		const h = walletHoldings({ wallets, accounts, transactions, from });
		expect(h.map((x) => [x.key, x.account, x.group, x.asset, x.opening])).toEqual([
			['acc-a', 'nyx:n1aaa', 'nyx', 'NYM', '100'],
			['acc-b', 'nyx:n1bbb', 'nyx', 'NYM', '0'],
			['acc-c', 'base:0xccc', 'base', TOKEN, '5']
		]);
		expect(h[0].movements).toEqual([
			{ date: '2026-09-20', amount: '100' },
			{ date: '2026-10-02', amount: '-40' }
		]);
		expect(h[2].symbol).toBe('WOLKE');
	});

	it('rates: the booking’s own on its day, the market’s else, a pool token’s last one carried', () => {
		const holdings = walletHoldings({ wallets, accounts, transactions, from });
		const books = bookRates(holdings, transactions);
		expect(books.rates.get('NYM')).toEqual([
			{ day: '2026-09-20', rate: '0.04' },
			{ day: '2026-10-02', rate: '0.06' }
		]);
		expect([...books.ownOnly]).toEqual([TOKEN]);
		// Asked for: NYM on the days without a booking, newest first; never the pool token.
		expect(neededRates({ holdings, books, from, to }).map((n) => `${n.symbol} ${n.day}`)).toEqual([
			'NYM 2026-10-04',
			'NYM 2026-10-03',
			'NYM 2026-10-01'
		]);
		const fetched = new Map([
			['NYM@2026-10-01', '0.05'],
			['NYM@2026-10-04', '0.05']
		]);
		expect(neededRates({ holdings, books, fetched, from, to }).map((n) => n.day)).toEqual([
			'2026-10-03'
		]);
		const source = rateSource({ books, fetched });
		const series = valueSeries({ holdings, rate: source.rate, from, to });
		// 100 × 0,05 · 60 × 0,06 · the 3rd has no rate · 60 × 0,05
		expect(series.accounts[0].values).toEqual(['5', '3.6', null, '3']);
		expect(series.accounts[1].values).toEqual(['0', '2.4', null, '2']);
		// 5 × 2 (the rate of 30.09., carried) · the same · 7,5 × 3 · the same
		expect(series.accounts[2].values).toEqual(['10', '10', '22.5', '22.5']);
		expect([...source.carried]).toEqual([TOKEN]);
		expect(series.missing).toEqual([{ asset: 'NYM', buckets: ['2026-10-03'] }]);
	});

	it('lines: a chain summed or account by account; a hidden one leaves the colours alone', () => {
		const holdings = walletHoldings({ wallets, accounts, transactions, from });
		const books = bookRates(holdings, transactions);
		const fetched = new Map(
			['2026-10-01', '2026-10-03', '2026-10-04'].map((d) => [`NYM@${d}`, '0.05'])
		);
		const series = valueSeries({ holdings, rate: rateSource({ books, fetched }).rate, from, to });
		const all = chartModel({ series, holdings, hidden: new Set(), open: new Set() });
		// The largest at the end of the period first.
		expect(all.lines.map((l) => [l.key, l.color, l.values.at(-1)])).toEqual([
			['chain:base', 's1', '22.5'],
			['chain:nyx', 's2', '5']
		]);
		expect(all.total).toEqual(['15', '16', '27.5', '27.5']);
		expect(all.rest).toBeNull();
		expect(all.chains.map((c) => [c.chain, c.accounts.length])).toEqual([
			['nyx', 2],
			['base', 1]
		]);
		expect(all.quantities).toEqual([
			{ symbol: 'NYM', quantities: ['100', '100', '100', '100'] },
			{ symbol: 'WOLKE', quantities: ['5', '5', '7.5', '7.5'] }
		]);

		// The larger chain hidden: the other keeps its colour.
		const one = chartModel({ series, holdings, hidden: new Set(['chain:base']), open: new Set() });
		expect(one.lines.map((l) => [l.key, l.color, l.visible])).toEqual([
			['chain:base', 's1', false],
			['chain:nyx', 's2', true]
		]);
		expect(one.total).toEqual(['5', '6', '5', '5']);
		expect(one.quantities.map((q) => q.symbol)).toEqual(['NYM']);

		// One account of a chain hidden: the chain's line is the rest of it, in the same colour.
		const part = chartModel({
			series,
			holdings,
			hidden: new Set(['account:nyx:n1bbb']),
			open: new Set()
		});
		expect(part.lines[1]).toMatchObject({ key: 'chain:nyx', color: 's2', visible: true });
		expect(part.lines[1].values).toEqual(['5', '3.6', '3', '3']);

		// The chain opened: a line per account.
		const open = chartModel({ series, holdings, hidden: new Set(), open: new Set(['nyx']) });
		expect(open.lines.map((l) => [l.key, l.kind, l.color])).toEqual([
			['chain:base', 'chain', 's1'],
			['account:nyx:n1aaa', 'account', 's2'],
			['account:nyx:n1bbb', 'account', 's3']
		]);
		// A chain with one account has nothing to open.
		expect(
			chartModel({ series, holdings, hidden: new Set(), open: new Set(['base']) }).chains[1].open
		).toBe(false);
	});

	it('more than four lines: the rest as one', () => {
		const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((c, i) => ({
			key: `k-${c}`,
			account: `w-${c}`,
			group: c,
			asset: 'NYM',
			symbol: 'NYM',
			decimals: 6,
			opening: String(10 * (i + 1)),
			movements: []
		}));
		const series = valueSeries({ holdings: many, rate: () => '1', from, to: from });
		const m = chartModel({ series, holdings: many, hidden: new Set(['chain:a']), open: new Set() });
		expect(m.lines.map((l) => l.color)).toEqual(['s1', 's2', 's3', 's4', 'other', 'other']);
		// b alone: a is hidden.
		expect(m.rest).toEqual(['20']);
		expect(m.total).toEqual(['200']);
	});

	it('asking for rates: each as it arrives; an asset without any is given up', async () => {
		const needs = [
			...['04', '03', '02', '01'].map((d) => ({ key: 'NYM', symbol: 'NYM', day: `2026-10-${d}` })),
			...['04', '03', '02', '01'].map((d) => ({ key: 'XYZ', symbol: 'XYZ', day: `2026-10-${d}` }))
		];
		/** @type {string[]} */
		const asked = [];
		/** @type {string[]} */
		const got = [];
		/** @type {string[]} */
		const progress = [];
		const result = await loadRates({
			needs,
			parallel: 1,
			getRate: async ({ symbol, day }) => {
				asked.push(`${symbol} ${day}`);
				if (symbol === 'XYZ' || day === '2026-10-03') throw new Error('no rate found');
				return { rate: '0.05' };
			},
			onRate: (key, day, rate) => got.push(`${key} ${day} ${rate}`),
			onProgress: (done, count) => progress.push(`${done}/${count}`)
		});
		expect(got).toEqual(['NYM 2026-10-04 0.05', 'NYM 2026-10-02 0.05', 'NYM 2026-10-01 0.05']);
		// XYZ: three times, not a fourth.
		expect(asked.filter((a) => a.startsWith('XYZ'))).toHaveLength(3);
		expect(result.failed).toBe(5);
		expect(progress.at(-1)).toBe('8/8');
	});

	const nym = ['04', '03', '02', '01'].map((d) => ({
		key: 'NYM',
		symbol: 'NYM',
		day: `2026-10-${d}`
	}));
	const token = ['04', '03'].map((d) => ({
		key: 'XYZ@base:0xddd',
		symbol: 'XYZ',
		day: `2026-10-${d}`,
		contract: '0xddd',
		chain: 'base'
	}));

	it('periods: one per listed asset from its first needed day to its last; a token stays day by day', () => {
		const akt = [{ key: 'AKT', symbol: 'AKT', day: '2026-10-02' }];
		// Interleaved, the newest first, as neededRates hands them over.
		const { spans, single } = rateSpans([nym[0], token[0], akt[0], nym[1], token[1], nym[3]]);
		expect(spans.map((s) => [s.symbol, s.from, s.to, s.needs.length])).toEqual([
			['NYM', '2026-10-01', '2026-10-04', 3],
			['AKT', '2026-10-02', '2026-10-02', 1]
		]);
		expect(single).toEqual(token);
		// Longer than the bridge takes at once: cut.
		const long = rateSpans(
			['2026-06-01', '2026-09-08', '2026-09-09', '2026-10-01'].map((day) => ({
				key: 'NYM',
				symbol: 'NYM',
				day
			}))
		);
		expect(long.spans.map((s) => [s.from, s.to])).toEqual([
			['2026-06-01', '2026-09-08'],
			['2026-09-09', '2026-10-01']
		]);
	});

	it('asking for rates: one call per listed asset; a day missing in the answer stays missing', async () => {
		/** @type {string[]} */
		const asked = [];
		/** @type {string[]} */
		const got = [];
		/** @type {string[]} */
		const progress = [];
		const result = await loadRates({
			needs: [...nym, ...token],
			parallel: 1,
			getRange: async ({ symbol, from, to }) => {
				asked.push(`${symbol} ${from}..${to}`);
				return {
					rates: [
						{ date: '2026-10-01', rate: '0.05' },
						{ date: '2026-10-02', rate: '0.06' },
						{ date: '2026-10-04', rate: '0.07' },
						// Not a rate: left out.
						{ date: '2026-10-03', rate: 'NaN' }
					]
				};
			},
			getRate: async ({ symbol, day, contract }) => {
				asked.push(`${symbol} ${day} ${contract}`);
				return { rate: '2' };
			},
			onRate: (key, day, rate) => got.push(`${key} ${day} ${rate}`),
			onProgress: (done, count) => progress.push(`${done}/${count}`)
		});
		expect(asked).toEqual([
			'NYM 2026-10-01..2026-10-04',
			'XYZ 2026-10-04 0xddd',
			'XYZ 2026-10-03 0xddd'
		]);
		expect(got).toEqual([
			'NYM 2026-10-01 0.05',
			'NYM 2026-10-02 0.06',
			'NYM 2026-10-04 0.07',
			'XYZ@base:0xddd 2026-10-04 2',
			'XYZ@base:0xddd 2026-10-03 2'
		]);
		expect(result.failed).toBe(1);
		expect(progress).toEqual(['4/6', '5/6', '6/6']);
	});

	it('asking for rates: a bridge without the call for a period is asked day by day; another failure is not', async () => {
		const akt = ['02', '01'].map((d) => ({ key: 'AKT', symbol: 'AKT', day: `2026-10-${d}` }));
		/** @type {string[]} */
		const asked = [];
		/** @type {string[]} */
		const got = [];
		const old = await loadRates({
			needs: [...nym, ...akt],
			parallel: 1,
			getRange: async ({ symbol }) => {
				asked.push(`range ${symbol}`);
				throw Object.assign(new Error('outdated'), { status: 404, code: 'BRIDGE_OUTDATED' });
			},
			getRate: async ({ symbol, day }) => {
				asked.push(`${symbol} ${day}`);
				return { rate: '0.05' };
			},
			onRate: (key, day) => got.push(`${key} ${day}`)
		});
		// Asked once, not again for the next asset.
		expect(asked.filter((a) => a.startsWith('range'))).toEqual(['range NYM']);
		expect(got).toHaveLength(6);
		expect(old.failed).toBe(0);

		/** @type {string[]} */
		const days = [];
		const down = await loadRates({
			needs: nym,
			getRange: async () => {
				throw Object.assign(new Error('unreachable'), { status: 0 });
			},
			getRate: async ({ day }) => {
				days.push(day);
				return { rate: '0.05' };
			},
			onRate: () => {}
		});
		expect(days).toEqual([]);
		expect(down.failed).toBe(4);
	});
});

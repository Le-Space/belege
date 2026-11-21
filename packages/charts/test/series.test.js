// SPDX-License-Identifier: AGPL-3.0-or-later
// Bookings → series. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	balanceSeries,
	openingBefore,
	sumValues,
	valueSeries,
	bucketOf,
	buckets,
	granularity,
	sumSeries
} from '../src/index.js';

test('a period in days and in months, both ends included', () => {
	assert.deepEqual(buckets('2026-02-27', '2026-03-02'), [
		'2026-02-27',
		'2026-02-28',
		'2026-03-01',
		'2026-03-02'
	]);
	assert.equal(buckets('2028-02-01', '2028-02-29').length, 29);
	assert.deepEqual(buckets('2026-11-15', '2027-02-03', 'month'), [
		'2026-11',
		'2026-12',
		'2027-01',
		'2027-02'
	]);
	assert.deepEqual(buckets('2026-03-02', '2026-03-01'), []);
	assert.equal(bucketOf('2026-03-02T10:00:00Z', 'day'), '2026-03-02');
	assert.equal(bucketOf('2026-03-02', 'month'), '2026-03');
});

test('days up to a quarter, months beyond', () => {
	assert.equal(granularity('2026-10-01', '2026-10-31'), 'day');
	assert.equal(granularity('2026-07-01', '2026-09-30'), 'day');
	assert.equal(granularity('2026-01-01', '2026-12-31'), 'month');
});

test('a balance: opening plus every movement up to the end of each bucket, without floats', () => {
	const movements = [
		{ date: '2026-10-02', amount: '-2.5' },
		{ date: '2026-10-02', amount: '-0.000000000000000000000001' },
		{ date: '2026-10-04', amount: '12' },
		// Outside the period: not counted.
		{ date: '2026-09-30', amount: '100' },
		{ date: '2026-10-06', amount: '100' }
	];
	const s = balanceSeries({ opening: '10.50', movements, from: '2026-10-01', to: '2026-10-05' });
	assert.equal(s.opening, '10.5');
	assert.deepEqual(
		s.points.map((p) => [p.bucket, p.value]),
		[
			['2026-10-01', '10.5'],
			['2026-10-02', '7.999999999999999999999999'],
			['2026-10-03', '7.999999999999999999999999'],
			['2026-10-04', '19.999999999999999999999999'],
			['2026-10-05', '19.999999999999999999999999']
		]
	);
	const m = balanceSeries({
		opening: '10.5',
		movements,
		from: '2026-09-01',
		to: '2026-10-31',
		by: 'month'
	});
	assert.deepEqual(
		m.points.map((p) => [p.bucket, p.value]),
		[
			['2026-09', '110.5'],
			['2026-10', '219.999999999999999999999999']
		]
	);
});

test('sums per day and kind: the largest keep a series, in the order they appear; the rest is one', () => {
	const items = [
		{ date: '2026-08-01', amount: '200', key: 'storage', label: 'Speicher' },
		{ date: '2026-08-01', amount: '5', key: 'runner-a' },
		{ date: '2026-08-02', amount: '2000', key: 'wolkenfabrik-web' },
		{ date: '2026-08-02', amount: '7', key: 'runner-b' },
		{ date: '2026-08-03', amount: '300.5', key: 'storage', label: 'Speicher' },
		{ date: '2026-08-03', amount: '0.5', key: 'storage', label: 'Speicher' },
		{ date: '2026-09-01', amount: '9999', key: 'storage' }
	];
	const s = sumSeries({ items, from: '2026-08-01', to: '2026-08-03', max: 2, others: 'Übrige' });
	assert.deepEqual(s.buckets, ['2026-08-01', '2026-08-02', '2026-08-03']);
	assert.deepEqual(s.series, [
		{ key: 'storage', label: 'Speicher', total: '501', values: ['200', '0', '301'], others: false },
		{
			key: 'wolkenfabrik-web',
			label: 'wolkenfabrik-web',
			total: '2000',
			values: ['0', '2000', '0'],
			others: false
		},
		{ key: 'others', label: 'Übrige', total: '12', values: ['5', '7', '0'], others: true }
	]);
	// Nothing beyond `max`: no series for the rest.
	assert.deepEqual(
		sumSeries({ items, from: '2026-08-01', to: '2026-08-03' }).series.map((x) => x.key),
		['storage', 'runner-a', 'wolkenfabrik-web', 'runner-b']
	);
	assert.deepEqual(sumSeries({ items: [], from: '2026-08-01', to: '2026-08-02' }).series, []);
});

test('the balance before a period, from a balance known for one day', () => {
	const movements = [
		{ date: '2026-09-28', amount: '5' },
		{ date: '2026-10-02', amount: '-3' },
		{ date: '2026-10-05', amount: '10' },
		{ date: '2026-10-09', amount: '1' }
	];
	// The anchor in the period: back over what moved from the first day up to it.
	assert.equal(
		openingBefore({ balance: '20', on: '2026-10-06', movements, from: '2026-10-01' }),
		'13'
	);
	// The anchor before the period: forward over what moved in between.
	assert.equal(
		openingBefore({ balance: '8', on: '2026-09-27', movements, from: '2026-10-01' }),
		'13'
	);
	// On the day before the period it is the opening itself.
	assert.equal(
		openingBefore({ balance: '13', on: '2026-09-30', movements, from: '2026-10-01' }),
		'13'
	);
});

test('holdings at their value: per day, per account, per chain', () => {
	const rates = /** @type {Record<string, Record<string, string>>} */ ({
		NYM: { '2026-10-01': '0.05', '2026-10-02': '0.06', '2026-10-03': '0.04', '2026-10-04': '0.05' },
		// No rate on the 3rd.
		ATOM: { '2026-10-01': '4', '2026-10-02': '4.5', '2026-10-04': '5' },
		ETH: { '2026-10-03': '2000', '2026-10-04': '2100.555' }
	});
	const s = valueSeries({
		from: '2026-10-01',
		to: '2026-10-04',
		rate: (asset, day) => rates[asset]?.[day],
		holdings: [
			{
				key: 'a:NYM',
				account: 'Konto A',
				group: 'nyx',
				asset: 'NYM',
				opening: '100',
				movements: [{ date: '2026-10-02', amount: '-40' }]
			},
			{
				key: 'b:NYM',
				account: 'Konto B',
				group: 'nyx',
				asset: 'NYM',
				opening: '0',
				movements: [{ date: '2026-10-02', amount: '40' }]
			},
			{
				key: 'b:ATOM',
				account: 'Konto B',
				group: 'nyx',
				asset: 'ATOM',
				opening: '2',
				movements: []
			},
			// An account that starts in the middle of the period.
			{
				key: 'c:ETH',
				account: 'Konto C',
				group: 'ethereum',
				asset: 'ETH',
				opening: '0',
				movements: [{ date: '2026-10-03', amount: '0.000000000000000001' }]
			}
		]
	});
	assert.deepEqual(s.buckets, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
	// The quantity held and its value, per holding.
	assert.deepEqual(s.holdings[0].quantities, ['100', '60', '60', '60']);
	assert.deepEqual(s.holdings[0].values, ['5', '3.6', '2.4', '3']);
	assert.deepEqual(s.holdings[2].values, ['8', '9', null, '10']);
	// Two accounts of one chain, apart …
	assert.deepEqual(
		s.accounts.map((a) => [a.key, a.group, a.values]),
		[
			['Konto A', 'nyx', ['5', '3.6', '2.4', '3']],
			// … the day without a rate for ATOM: left out of the day's value, and named.
			['Konto B', 'nyx', ['8', '11.4', '1.6', '12']],
			// Nothing held before the 3rd needs no rate; a value below a cent is nought.
			['Konto C', 'ethereum', ['0', '0', '0', '0']]
		]
	);
	assert.deepEqual(s.accounts[1].missing, [[], [], ['ATOM'], []]);
	// … and summed.
	assert.deepEqual(
		s.groups.map((g) => [g.key, g.values]),
		[
			['nyx', ['13', '15', '4', '15']],
			['ethereum', ['0', '0', '0', '0']]
		]
	);
	assert.deepEqual(s.groups[0].missing, [[], [], ['ATOM'], []]);
	assert.deepEqual(s.missing, [{ asset: 'ATOM', buckets: ['2026-10-03'] }]);
	// What is visible, as one line.
	assert.deepEqual(sumValues([s.groups[0].values, s.groups[1].values], 4), ['13', '15', '4', '15']);
	assert.deepEqual(sumValues([], 2), ['0', '0']);
});

test('nothing of an account has a rate: a gap, not a zero', () => {
	const s = valueSeries({
		from: '2026-10-01',
		to: '2026-10-03',
		rate: (asset, day) => (asset === 'NYM' && day !== '2026-10-02' ? '0.05' : null),
		holdings: [
			{ key: 'a:NYM', account: 'a', group: 'nyx', asset: 'NYM', opening: '100', movements: [] },
			{ key: 'a:XYZ', account: 'a', group: 'nyx', asset: 'XYZ', opening: '0', movements: [] },
			{ key: 'b:XYZ', account: 'b', group: 'other', asset: 'XYZ', opening: '7', movements: [] }
		]
	});
	assert.deepEqual(s.accounts[0].values, ['5', null, '5']);
	assert.deepEqual(s.accounts[1].values, [null, null, null]);
	assert.deepEqual(s.missing, [
		{ asset: 'NYM', buckets: ['2026-10-02'] },
		{ asset: 'XYZ', buckets: ['2026-10-01', '2026-10-02', '2026-10-03'] }
	]);
	// A gap in one line does not make the sum one.
	assert.deepEqual(sumValues([s.accounts[0].values, s.accounts[1].values], 3), ['5', null, '5']);
});

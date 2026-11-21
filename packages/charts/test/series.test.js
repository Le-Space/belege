// SPDX-License-Identifier: AGPL-3.0-or-later
// Bookings → series. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { balanceSeries, bucketOf, buckets, granularity, sumSeries } from '../src/index.js';

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

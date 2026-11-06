import { describe, expect, it } from 'vitest';

import { mealAllowance } from './allowance.js';
import { countryHints, homeOf, legsOf, newStops, routeLine, routeOf } from './route.js';

// A made-up trip abroad (#693): by train to Beispielburg, by bus across the
// border to Ortshausen (AT), a night in a hostel, a flight to country TR, two
// nights in a hotel, a domestic flight and one on to GE; a taxi without times.
// Towns, vendors and airport codes are invented.

const receipt = (
	/** @type {string} */ id,
	/** @type {Record<string, any>} */ travel,
	date = ''
) => ({
	id,
	vendor: `Beispiel ${id}`,
	documentDate: date || String(travel.departure ?? travel.check_in ?? '').slice(0, 10),
	extraction: { travel }
});

const TRIP = [
	receipt('train', {
		kind: 'train',
		from: 'Musterstadt',
		to: 'Beispielburg Hbf',
		from_country: 'DE',
		to_country: 'DE',
		departure: '2026-10-05T07:10',
		arrival: '2026-10-05T08:40'
	}),
	receipt('bus', {
		kind: 'bus',
		from: 'Beispielburg',
		to: 'Ortshausen',
		from_country: 'DE',
		to_country: 'AT',
		departure: '2026-10-05T10:00',
		arrival: '2026-10-05T15:30'
	}),
	receipt('hostel', {
		kind: 'hotel',
		place: 'Ortshausen',
		place_country: 'AT',
		check_in: '2026-10-05',
		check_out: '2026-10-06'
	}),
	receipt('taxi', { kind: 'taxi', place: 'Ortshausen', place_country: 'AT' }, '2026-10-06'),
	receipt('flight1', {
		kind: 'flight',
		from: 'Ortshausen',
		to: 'Weitweg',
		from_country: 'AT',
		to_country: 'TR',
		from_iata: 'QOA',
		to_iata: 'QWW',
		departure: '2026-10-05T23:50',
		arrival: '2026-10-06T06:10'
	}),
	receipt('hotel', {
		kind: 'hotel',
		place: 'Weitweg',
		place_country: 'TR',
		check_in: '2026-10-06',
		check_out: '2026-10-08'
	}),
	receipt('flight2', {
		kind: 'flight',
		from: 'Weitweg',
		to: 'Mittelstadt',
		from_country: 'TR',
		to_country: 'TR',
		from_iata: 'QWW',
		to_iata: 'QMS',
		departure: '2026-10-08T09:00',
		arrival: '2026-10-08T10:30'
	}),
	receipt('flight3', {
		kind: 'flight',
		from: 'Mittelstadt',
		to: 'Endhausen',
		from_country: 'TR',
		to_country: 'GE',
		from_iata: 'QMS',
		to_iata: 'QEH',
		departure: '2026-10-08T12:00',
		arrival: '2026-10-08T16:00'
	})
];

describe('a trip’s countries from its tickets (#693)', () => {
	it('crossings at each arrival in another country; a domestic flight crosses nothing', () => {
		const route = routeOf(TRIP);
		expect(route.country).toBe('DE');
		expect(route.stops.map((s) => [s.at, s.country, s.receiptId])).toEqual([
			['2026-10-05T15:30', 'AT', 'bus'],
			['2026-10-06T06:10', 'TR', 'flight1'],
			['2026-10-08T16:00', 'GE', 'flight3']
		]);
		// The taxi and the nights fit the crossings: nothing to ask.
		expect(route.hints).toEqual([]);
	});

	it('the allowance counts each day where the traveller was before midnight', () => {
		const { stops } = routeOf(TRIP);
		const { days } = mealAllowance({
			start: '2026-10-05T07:00',
			end: '2026-10-08T20:00',
			stops
		});
		// The night flight lands after midnight: the 5th is still Austria's.
		expect(days.map((d) => [d.date, d.country])).toEqual([
			['2026-10-05', 'AT'],
			['2026-10-06', 'TR'],
			['2026-10-07', 'TR'],
			['2026-10-08', 'GE']
		]);
		expect(days.every((d) => d.cents !== null)).toBe(true);
	});

	it('a return ticket’s way back is a crossing home', () => {
		const ret = receipt('ret', {
			kind: 'train',
			from: 'Musterstadt',
			to: 'Ortshausen',
			from_country: 'DE',
			to_country: 'AT',
			departure: '2026-10-05T07:00',
			arrival: '2026-10-05T12:00',
			return_departure: '2026-10-07T15:00',
			return_arrival: '2026-10-07T20:00'
		});
		expect(routeOf([ret]).stops.map((s) => [s.at, s.country])).toEqual([
			['2026-10-05T12:00', 'AT'],
			['2026-10-07T20:00', 'DE']
		]);
	});

	it('without countries read (receipts from before), nothing is made up', () => {
		const old = TRIP.map((r) => ({
			...r,
			extraction: {
				travel: Object.fromEntries(
					Object.entries(r.extraction.travel).filter(([k]) => !k.endsWith('_country'))
				)
			}
		}));
		expect(legsOf(old)).toEqual([]);
		expect(routeOf(old)).toEqual({ country: 'DE', stops: [], hints: [] });
	});

	it('a trip that starts abroad starts where its first leg leaves', () => {
		expect(homeOf(TRIP.slice(4))).toBe('AT');
		expect(homeOf([])).toBe('DE');
	});
});

describe('a border crossed without a ticket: a hint, never a time made up (#693)', () => {
	// By car: fuel and a hotel in AT, no ticket at all.
	const car = [
		receipt('fuel', { kind: 'fuel', place: 'Ortshausen', place_country: 'AT' }, '2026-10-05'),
		receipt('inn', {
			kind: 'hotel',
			place: 'Ortshausen',
			place_country: 'AT',
			check_in: '2026-10-05',
			check_out: '2026-10-07'
		}),
		receipt('parking', { kind: 'parking', place: 'Musterstadt', place_country: 'DE' }, '2026-10-07')
	];

	it('receipts from a country no crossing leads to are named with their day', () => {
		const route = routeOf(car);
		expect(route.stops).toEqual([]);
		expect(route.hints).toEqual([
			{ receiptId: 'fuel', country: 'AT', date: '2026-10-05' },
			{ receiptId: 'inn', country: 'AT', date: '2026-10-05' }
		]);
	});

	it('once the crossings are entered on the trip, the hints go', () => {
		const stops = [
			{ at: '2026-10-05T11:00', country: 'AT' },
			{ at: '2026-10-07T14:00', country: 'DE' }
		];
		expect(countryHints(car, 'DE', stops)).toEqual([]);
		// A crossing home too early: the second night is named.
		expect(countryHints(car, 'DE', [stops[0], { at: '2026-10-06T14:00', country: 'DE' }])).toEqual([
			{ receiptId: 'inn', country: 'AT', date: '2026-10-06' }
		]);
	});
});

describe('crossings a trip does not have yet (#693)', () => {
	it('the same country within an hour is the same crossing', () => {
		const { stops } = routeOf(TRIP);
		expect(
			newStops(stops, [{ at: '2026-10-05T15:00', country: 'at' }]).map((s) => s.country)
		).toEqual(['TR', 'GE']);
		expect(newStops(stops, [])).toHaveLength(3);
	});

	it('a route as a line', () => {
		const { country, stops } = routeOf(TRIP);
		expect(routeLine(country, stops, (at) => at.slice(5).replace('T', ' '))).toBe(
			'DE → AT 10-05 15:30 → TR 10-06 06:10 → GE 10-08 16:00'
		);
	});
});

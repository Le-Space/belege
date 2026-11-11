import { describe, expect, it } from 'vitest';

import { samePlace, segmentsOf, tripChecks } from './checks.js';

// A made-up trip (#693, part b): by train to Beispielburg, by bus to
// Ortshausen (AT), a night in a hostel, an overnight flight to Weitweg (TR),
// two nights in a hotel, then on to Endhausen (GE). Towns, vendors and airport
// codes are invented.

const receipt = (/** @type {string} */ id, /** @type {Record<string, any>} */ travel) => ({
	id,
	vendor: `Beispiel ${id}`,
	extraction: { travel }
});

const train = receipt('train', {
	kind: 'train',
	from: 'Musterstadt',
	to: 'Beispielburg Hbf',
	from_country: 'DE',
	to_country: 'DE',
	departure: '2026-10-05T07:10',
	arrival: '2026-10-05T08:40'
});
const bus = receipt('bus', {
	kind: 'bus',
	from: 'Beispielburg ZOB',
	to: 'Ortshausen',
	from_country: 'DE',
	to_country: 'AT',
	departure: '2026-10-05T10:00',
	arrival: '2026-10-05T15:30'
});
const hostel = receipt('hostel', {
	kind: 'hotel',
	place: 'Ortshausen',
	place_country: 'AT',
	check_in: '2026-10-05',
	check_out: '2026-10-06'
});
const taxi = receipt('taxi', {
	kind: 'taxi',
	from: 'Hostel Beispiel',
	to: 'Coworking Beispiel',
	departure: '2026-10-06T09:00',
	arrival: '2026-10-06T09:20'
});
const flight1 = receipt('flight1', {
	kind: 'flight',
	from: 'Ortshausen Airport',
	to: 'Weitweg',
	from_country: 'AT',
	to_country: 'TR',
	from_iata: 'QOA',
	to_iata: 'QWW',
	departure: '2026-10-06T23:50',
	arrival: '2026-10-07T06:10'
});
const hotel = receipt('hotel', {
	kind: 'hotel',
	place: 'Weitweg',
	place_country: 'TR',
	check_in: '2026-10-07',
	check_out: '2026-10-09'
});
const flight2 = receipt('flight2', {
	kind: 'flight',
	from: 'Weitweg',
	to: 'Endhausen',
	from_country: 'TR',
	to_country: 'GE',
	from_iata: 'QWW',
	to_iata: 'QEH',
	departure: '2026-10-09T12:00',
	arrival: '2026-10-09T16:00'
});

const ALL = [train, bus, hostel, taxi, flight1, hotel, flight2];
const trip = {
	id: 'T',
	country: 'DE',
	start: '2026-10-05T07:00',
	end: '2026-10-09T16:00',
	nights: []
};

describe('the legs of a trip (#693 b)', () => {
	it('train, bus and flight; no taxi; a return ticket’s way back as a leg', () => {
		const back = receipt('back', {
			kind: 'train',
			from: 'Musterstadt',
			to: 'Beispielburg',
			departure: '2026-10-01T08:00',
			arrival: '2026-10-01T09:00',
			return_departure: '2026-10-01T18:00',
			return_arrival: '2026-10-01T19:00'
		});
		const s = segmentsOf([taxi, bus, back, train]);
		expect(s.map((x) => [x.receiptId, x.from.name, x.to.name])).toEqual([
			['back', 'Musterstadt', 'Beispielburg'],
			['back', 'Beispielburg', 'Musterstadt'],
			['train', 'Musterstadt', 'Beispielburg Hbf'],
			['bus', 'Beispielburg ZOB', 'Ortshausen']
		]);
	});

	it('the same place: a shared word, the airport code, or not to be told', () => {
		/** @param {string} [name] @param {string | null} [country] @param {string | null} [iata] */
		const p = (name = '', country = null, iata = null) => ({ name, country, iata });
		expect(samePlace(p('Beispielburg Hbf'), p('Beispielburg ZOB'))).toBe(true);
		expect(samePlace(p('Ortshausen'), p('Ortshausen Airport'))).toBe(true);
		expect(samePlace(p('X', null, 'QWW'), p('Y', null, 'QWW'))).toBe(true);
		expect(samePlace(p('Weitweg', null, 'QWW'), p('Weitweg', null, 'QMS'))).toBe(false);
		expect(samePlace(p('Ortshausen', 'AT'), p('Ortshausen', 'DE'))).toBe(false);
		expect(samePlace(p('Musterstadt'), p('Beispielburg'))).toBe(false);
		expect(samePlace(p(''), p('Beispielburg'))).toBe(true);
	});
});

describe('where a trip does not add up (#693 b)', () => {
	it('a whole trip: only that it ends abroad', () => {
		expect(tripChecks(trip, ALL)).toEqual([
			{
				kind: 'endsAbroad',
				key: 'endsAbroad',
				country: 'GE',
				place: 'Endhausen',
				at: '2026-10-09T16:00',
				receiptId: 'flight2'
			}
		]);
	});

	it('a night without accommodation; the overnight flight covers its night; a flat rate does', () => {
		const without = ALL.filter((r) => r !== hostel);
		expect(tripChecks(trip, without).filter((c) => c.kind === 'night')).toEqual([
			{ kind: 'night', key: 'night:2026-10-05', date: '2026-10-05' }
		]);
		expect(
			tripChecks({ ...trip, nights: ['2026-10-05'] }, without).filter((c) => c.kind === 'night')
		).toEqual([]);
		// The night of the 6th is spent on the plane: no question.
		expect(tripChecks(trip, ALL).some((c) => c.key === 'night:2026-10-06')).toBe(false);
	});

	it('no nights asked of a day trip or a trip without times', () => {
		const without = ALL.filter((r) => r !== hostel);
		expect(tripChecks({ ...trip, overnight: false }, without).some((c) => c.kind === 'night')).toBe(
			false
		);
		expect(tripChecks({ ...trip, end: '' }, without).some((c) => c.kind === 'night')).toBe(false);
	});

	it('a ride missing between two legs', () => {
		const checks = tripChecks(
			trip,
			ALL.filter((r) => r !== bus)
		);
		const gap = checks.find((c) => c.kind === 'gap');
		expect(gap && gap.kind === 'gap' && [gap.after.to.name, gap.before.from.name]).toEqual([
			'Beispielburg Hbf',
			'Ortshausen Airport'
		]);
	});

	it('back home: no question about the end', () => {
		const home = receipt('home', {
			kind: 'flight',
			from: 'Endhausen',
			to: 'Musterstadt',
			from_country: 'GE',
			to_country: 'DE',
			from_iata: 'QEH',
			to_iata: 'QMU',
			departure: '2026-10-10T08:00',
			arrival: '2026-10-10T12:00'
		});
		const checks = tripChecks({ ...trip, end: '2026-10-10T12:30' }, [...ALL, home]);
		expect(checks.some((c) => c.kind === 'endsAbroad')).toBe(false);
	});

	it('a leg before the departure or after the return', () => {
		const checks = tripChecks(
			{ ...trip, start: '2026-10-05T09:00', end: '2026-10-09T13:00' },
			ALL
		).filter((c) => c.kind === 'outside');
		expect(checks.map((c) => c.kind === 'outside' && [c.receiptId, c.side, c.at])).toEqual([
			['train', 'before', '2026-10-05T07:10'],
			['flight2', 'after', '2026-10-09T16:00']
		]);
	});

	it('what the person answered with “Passt so” is asked no more', () => {
		expect(tripChecks({ ...trip, checked: ['endsAbroad'] }, ALL)).toEqual([]);
	});
});

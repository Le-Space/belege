import { describe, expect, it } from 'vitest';

import { joinCandidates, joinTrips, lockedBy, momentOf, splitTrip, suggestSplit } from './split.js';

// Made-up trips (#693 b): out to Ortshausen (AT) and back, two days at home,
// then out to Weitweg (TR) and back – booked as one trip. Towns, vendors and
// codes are invented.

const receipt = (
	/** @type {string} */ id,
	/** @type {Record<string, any>} */ travel,
	documentDate = ''
) => ({ id, vendor: `Beispiel ${id}`, documentDate, extraction: { travel } });

const out1 = receipt('out1', {
	kind: 'bus',
	from_country: 'DE',
	to_country: 'AT',
	departure: '2026-05-04T08:00',
	arrival: '2026-05-04T13:00'
});
const hostel = receipt('hostel', {
	kind: 'hotel',
	place_country: 'AT',
	check_in: '2026-05-04',
	check_out: '2026-05-05'
});
const back1 = receipt('back1', {
	kind: 'bus',
	from_country: 'AT',
	to_country: 'DE',
	departure: '2026-05-05T09:00',
	arrival: '2026-05-05T14:00'
});
const lunch = receipt('lunch', { kind: 'restaurant' }, '2026-05-06');
const out2 = receipt('out2', {
	kind: 'flight',
	from_country: 'DE',
	to_country: 'TR',
	departure: '2026-05-08T07:00',
	arrival: '2026-05-08T12:00',
	return_departure: '2026-05-09T15:00',
	return_arrival: '2026-05-09T18:00'
});
const RECEIPTS = [out1, hostel, back1, lunch, out2];

const trip = {
	id: 'T',
	kind: 'trip',
	travellerId: 'me',
	destination: 'Ortshausen',
	reason: 'Projekttreffen Beispiel',
	place: '',
	note: '',
	start: '2026-05-04T07:30',
	end: '2026-05-09T18:30',
	country: 'DE',
	stops: [
		{ at: '2026-05-04T13:00', country: 'AT' },
		{ at: '2026-05-05T14:00', country: 'DE' },
		{ at: '2026-05-08T12:00', country: 'TR' },
		{ at: '2026-05-09T18:00', country: 'DE' }
	],
	overnight: true,
	meals: {
		'2026-05-05': { breakfast: true, lunch: false, dinner: false },
		'2026-05-09': { breakfast: true, lunch: false, dinner: false }
	},
	nights: ['2026-05-08'],
	mileage: [
		{ id: 'm1', date: '2026-05-04', km: 12 },
		{ id: 'm2', date: '2026-05-09', km: 12 }
	]
};

describe('where a trip would split (#693 b)', () => {
	it('back home, and out again a day or more later', () => {
		expect(suggestSplit(trip, RECEIPTS)).toEqual({
			end: '2026-05-05T14:00',
			start: '2026-05-08T07:00'
		});
	});
	it('none when the trip never comes home between its legs', () => {
		expect(suggestSplit(trip, [out1, hostel])).toBeNull();
		expect(suggestSplit(trip, [out2])).toBeNull();
	});
	it('a receipt’s moment: departure, check-in, else its day', () => {
		expect([momentOf(out1), momentOf(hostel), momentOf(lunch)]).toEqual([
			'2026-05-04T08:00',
			'2026-05-04T12:00',
			'2026-05-06T12:00'
		]);
	});
});

describe('a trip split in two (#693 b)', () => {
	it('receipts, crossings, meals, nights and mileage by their time', () => {
		const { first, second, toSecond } = splitTrip(trip, RECEIPTS, {
			end: '2026-05-05T14:00',
			start: '2026-05-08T07:00'
		});
		expect(first).toMatchObject({
			id: 'T',
			start: '2026-05-04T07:30',
			end: '2026-05-05T14:00',
			stops: [
				{ at: '2026-05-04T13:00', country: 'AT' },
				{ at: '2026-05-05T14:00', country: 'DE' }
			],
			meals: { '2026-05-05': { breakfast: true, lunch: false, dinner: false } },
			nights: [],
			mileage: [{ id: 'm1', date: '2026-05-04', km: 12 }]
		});
		expect(second.id).toBeUndefined();
		expect(second).toMatchObject({
			kind: 'trip',
			travellerId: 'me',
			reason: 'Projekttreffen Beispiel',
			start: '2026-05-08T07:00',
			end: '2026-05-09T18:30',
			country: 'DE',
			stops: [
				{ at: '2026-05-08T12:00', country: 'TR' },
				{ at: '2026-05-09T18:00', country: 'DE' }
			],
			meals: { '2026-05-09': { breakfast: true, lunch: false, dinner: false } },
			nights: ['2026-05-08'],
			mileage: [{ id: 'm2', date: '2026-05-09', km: 12 }]
		});
		// The lunch at home stays with the first; the flight goes along.
		expect(toSecond).toEqual(['out2']);
	});

	it('split abroad: the second starts in the country the first was in', () => {
		const { second } = splitTrip(trip, RECEIPTS, {
			end: '2026-05-04T20:00',
			start: '2026-05-04T20:00'
		});
		expect(second.country).toBe('AT');
	});

	it('refused where a part would have no time', () => {
		const at = { end: '2026-05-08T07:00', start: '2026-05-05T14:00' };
		expect(() => splitTrip(trip, RECEIPTS, at)).toThrow();
		expect(() =>
			splitTrip(trip, RECEIPTS, { end: '2026-05-04T07:00', start: '2026-05-05T00:00' })
		).toThrow();
		expect(() =>
			splitTrip(trip, RECEIPTS, { end: '2026-05-09T19:00', start: '2026-05-09T19:00' })
		).toThrow();
	});
});

describe('two trips as one (#693 b)', () => {
	const first = {
		id: 'A',
		kind: 'trip',
		travellerId: 'me',
		destination: 'Ortshausen',
		reason: '',
		note: 'Hin mit dem Bus',
		start: '2026-05-04T07:30',
		end: '2026-05-05T14:30',
		country: 'DE',
		stops: [{ at: '2026-05-04T13:00', country: 'AT' }],
		overnight: true,
		meals: { '2026-05-05': { breakfast: true, lunch: false, dinner: false } },
		nights: [],
		mileage: [{ id: 'm1', date: '2026-05-04', km: 12 }]
	};
	const second = {
		id: 'B',
		kind: 'trip',
		travellerId: 'me',
		destination: 'Weitweg',
		reason: 'Projekttreffen Beispiel',
		note: '',
		start: '2026-05-08T06:00',
		end: '2026-05-09T18:30',
		country: 'DE',
		stops: [{ at: '2026-05-08T12:00', country: 'TR' }],
		overnight: null,
		meals: { '2026-05-05': { breakfast: false, lunch: true, dinner: false } },
		nights: ['2026-05-08'],
		mileage: [{ id: 'm2', date: '2026-05-09', km: 12 }]
	};

	it('from the earlier start to the later end, with all of both', () => {
		expect(joinTrips(second, first)).toEqual({
			...second,
			destination: 'Weitweg',
			reason: 'Projekttreffen Beispiel',
			place: '',
			note: 'Hin mit dem Bus',
			start: '2026-05-04T07:30',
			end: '2026-05-09T18:30',
			country: 'DE',
			stops: [
				{ at: '2026-05-04T13:00', country: 'AT' },
				{ at: '2026-05-08T12:00', country: 'TR' }
			],
			overnight: true,
			meals: { '2026-05-05': { breakfast: true, lunch: true, dinner: false } },
			nights: ['2026-05-08'],
			mileage: [
				{ id: 'm2', date: '2026-05-09', km: 12 },
				{ id: 'm1', date: '2026-05-04', km: 12 }
			]
		});
	});

	it('candidates: the same traveller’s, a week apart at most, not on a closed statement', () => {
		const far = { ...second, id: 'C', start: '2026-05-20T08:00', end: '2026-05-21T08:00' };
		const other = { ...second, id: 'D', travellerId: 'colleague' };
		const travel = [first, second, far, other];
		expect(joinCandidates(travel, first).map((t) => t.id)).toEqual(['B']);
		const closed = {
			kind: 'statement',
			state: 'closed',
			number: 'RK-2026-001',
			snapshot: { trips: [{ tripId: 'B' }] }
		};
		expect(lockedBy([...travel, closed], 'B')).toBe('RK-2026-001');
		expect(lockedBy([...travel, { ...closed, deleted: true }], 'B')).toBeNull();
		expect(joinCandidates([...travel, closed], first)).toEqual([]);
		expect(joinCandidates([...travel, closed], second)).toEqual([]);
	});
});

describe('split and joined on the books (#693 b)', async () => {
	const { memoryCollection } = await import('../bank/test-support.js');
	const { splitStoredTrip, joinStoredTrips } = await import('./split.js');

	async function books() {
		const store = {
			travel: memoryCollection('travel').collection,
			receipts: memoryCollection('receipts').collection
		};
		const stored = await store.travel.put({ ...trip, id: undefined });
		/** @type {Record<string, string>} the stored id of each made-up receipt */
		const ids = {};
		for (const { id: name, ...r } of RECEIPTS)
			ids[name] = String(
				(await store.receipts.put({ ...r, travel: { tripId: stored.id, paidBy: 'private' } })).id
			);
		return { store, id: String(stored.id), ids };
	}

	it('split: the second trip gets the flight; joined again: one trip with all, the other gone', async () => {
		const { store, id, ids } = await books();
		const { first, second } = await splitStoredTrip(store, id, {
			end: '2026-05-05T14:00',
			start: '2026-05-08T07:00'
		});
		expect(first.id).toBe(id);
		expect(second.id).not.toBe(id);
		const tripOf = async (/** @type {string} */ rid) =>
			(await store.receipts.get(ids[rid]))?.travel?.tripId;
		expect(await tripOf('out2')).toBe(second.id);
		expect(await tripOf('lunch')).toBe(id);
		expect((await store.receipts.get(ids.out2))?.travel?.paidBy).toBe('private');

		const joined = await joinStoredTrips(store, id, String(second.id));
		expect(joined).toMatchObject({ id, start: trip.start, end: trip.end });
		expect(await tripOf('out2')).toBe(id);
		expect((await store.travel.get(String(second.id)))?.deleted).toBeTruthy();
	});

	it('refused for a trip on a closed statement', async () => {
		const { store, id } = await books();
		await store.travel.put({
			kind: 'statement',
			state: 'closed',
			number: 'RK-2026-001',
			snapshot: { trips: [{ tripId: id }] }
		});
		await expect(
			splitStoredTrip(store, id, { end: '2026-05-05T14:00', start: '2026-05-08T07:00' })
		).rejects.toThrow('RK-2026-001');
	});
});

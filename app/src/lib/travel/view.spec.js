import { describe, expect, it } from 'vitest';

import {
	allTrips,
	hospitalityOf,
	paidByGuess,
	receiptsOfTrip,
	suggestTrips,
	travelQuestions
} from './view.js';

// All trips, receipts and places here are made up.

const trip = (/** @type {string} */ id, /** @type {Record<string, any>} */ over = {}) => ({
	id,
	kind: 'trip',
	travellerId: 'T',
	destination: 'Musterstadt',
	reason: 'Workshop',
	start: '2026-05-04T07:00',
	end: '2026-05-05T19:00',
	mileage: [],
	...over
});
const receipt = (/** @type {string} */ id, /** @type {Record<string, any>} */ over = {}) => ({
	id,
	status: 'ausgelesen',
	documentDate: '2026-05-04',
	amountCents: 4990,
	extraction: { document_type: 'ticket', gross: 49.9, vat: [{ rate: 7, amount: 3.26 }] },
	...over
});

describe('travel on screen (#213)', () => {
	it('trips earliest first, a trip’s receipts', () => {
		const travel = [
			trip('B', { start: '2026-06-01T07:00' }),
			trip('A'),
			{ id: 'X', kind: 'traveller' },
			trip('C', { deleted: true })
		];
		expect(allTrips(travel).map((t) => t.id)).toEqual(['A', 'B']);
		const receipts = [
			receipt('r1', { travel: { tripId: 'A', paidBy: 'private' } }),
			receipt('r2', { travel: { tripId: 'A', paidBy: 'company' }, status: 'ignoriert' }),
			receipt('r3')
		];
		expect(receiptsOfTrip(receipts, 'A').map((r) => r.id)).toEqual(['r1']);
	});

	it('suggests the trips a receipt’s day falls in, a day either side, closest first', () => {
		const trips = [
			trip('A'),
			trip('B', { start: '2026-05-03T07:00', end: '2026-05-04T20:00' }),
			trip('C', { start: '2026-05-10T07:00', end: '2026-05-10T20:00' }),
			trip('D', { start: '', end: '' })
		];
		expect(suggestTrips(receipt('r'), trips).map((t) => t.id)).toEqual(['A', 'B']);
		// Bought the day before.
		expect(
			suggestTrips(receipt('r', { documentDate: '2026-05-09' }), trips).map((t) => t.id)
		).toEqual(['C']);
		expect(suggestTrips(receipt('r', { documentDate: null }), trips)).toEqual([]);
	});

	it('who probably paid: the company where its bank payment covers it, else privately', () => {
		const books = {
			transactions: [
				{ id: 'bank', source: 'hibiscus' },
				{ id: 'cash', source: 'outlay' }
			],
			matches: [
				{ receiptId: 'r1', transactionId: 'bank', state: 'confirmed' },
				{ receiptId: 'r2', transactionId: 'cash', state: 'confirmed' }
			]
		};
		expect(paidByGuess(receipt('r1'), books)).toBe('company');
		expect(paidByGuess(receipt('r2'), books)).toBe('private');
		expect(paidByGuess(receipt('r3'), books)).toBe('private');
	});

	it('a hospitality bill: split from its amount and VAT, tip included', () => {
		const bill = receipt('h', {
			amountCents: 11900,
			extraction: { gross: 119, vat: [{ rate: 19, amount: 19 }] },
			hospitality: {
				place: 'Gasthaus Beispiel',
				participants: ['Inhaberin Beispiel', 'Kunde Beispiel'],
				occasion: 'Angebot',
				tipCents: 500,
				tipTo: 'Bedienung'
			}
		});
		expect(hospitalityOf(bill)).toMatchObject({
			netCents: 10500,
			deductibleCents: 7350,
			nonDeductibleCents: 3150,
			inputVatCents: 1900,
			missing: []
		});
	});

	it('the questions travel asks, gone once answered', () => {
		const travel = [
			trip('A'),
			trip('B', { start: '', end: '' }),
			trip('C', { reason: '', mileage: [{ id: 'm', date: '2026-05-04', km: 0, vehicle: 'own' }] })
		];
		const receipts = [
			receipt('r1'),
			receipt('r2', { travel: { tripId: 'A', paidBy: 'private' } }),
			receipt('r3', { travel: { tripId: 'gone', paidBy: 'private' } }),
			receipt('r4', { extraction: { document_type: 'invoice' } }),
			receipt('h', {
				extraction: { document_type: 'receipt', gross: 49.9, vat: [] },
				hospitality: { place: 'Gasthaus Beispiel', participants: [], occasion: '', tipCents: 0 }
			})
		];
		expect(travelQuestions({ travel, receipts })).toEqual([
			{ kind: 'tripWithoutTimes', tripId: 'B' },
			{
				kind: 'tripIncomplete',
				tripId: 'C',
				problems: ['noReason', 'mileage:m:noKm', 'mileage:m:noReason']
			},
			{ kind: 'receiptWithoutTrip', receiptId: 'r1' },
			{ kind: 'receiptWithoutTrip', receiptId: 'r3' },
			{ kind: 'hospitalityIncomplete', receiptId: 'h', missing: ['participants', 'occasion'] }
		]);
	});
});

describe('typed amounts and trip days (#213)', async () => {
	const { euroCents, tripDays } = await import('./view.js');
	it('euros as typed into cents, anything else refused', () => {
		expect([euroCents('5'), euroCents('5,5'), euroCents('12.40'), euroCents(' 0,05 ')]).toEqual([
			500, 550, 1240, 5
		]);
		expect([euroCents(''), euroCents('1.234,50'), euroCents('-3'), euroCents('abc')]).toEqual([
			null,
			null,
			null,
			null
		]);
	});
	it('a trip’s days, one or a span', () => {
		const f = (/** @type {string} */ d) => d;
		expect(tripDays(trip('A'), f)).toBe('2026-05-04 – 2026-05-05');
		expect(tripDays(trip('A', { end: '2026-05-04T18:00' }), f)).toBe('2026-05-04');
		expect(tripDays(trip('A', { start: '' }), f)).toBe('');
	});
});

describe('what a receipt was read as (#213, step 4)', async () => {
	const { breakfastProposals, isTravelReceipt, travelHint, travelKind, tripFromReceipt } =
		await import('./view.js');
	const read = (/** @type {Record<string, any>} */ travel, over = {}) =>
		receipt('x', { extraction: { document_type: 'receipt', travel }, ...over });

	it('the kind, what it suggests, and which are asked about without a trip', () => {
		expect(travelKind(read({ kind: 'hotel' }))).toBe('hotel');
		expect(travelKind(receipt('t'))).toBe('ticket');
		expect(travelKind(receipt('n', { extraction: { document_type: 'invoice' } }))).toBeNull();
		expect(travelHint(read({ kind: 'restaurant' }))).toBe('hospitality');
		expect(travelHint(read({ kind: 'event' }))).toBe('event');
		expect(travelHint(read({ kind: 'fuel' }))).toBe('trip');
		expect(
			['train', 'hotel', 'fuel', 'taxi', 'restaurant'].map((k) =>
				isTravelReceipt(read({ kind: k }))
			)
		).toEqual([true, true, false, false, false]);
		const travel = [trip('A')];
		const receipts = [
			read({ kind: 'fuel' }),
			read({ kind: 'restaurant' }, { id: 'r' }),
			read({ kind: 'flight' }, { id: 'f' })
		];
		expect(travelQuestions({ travel, receipts })).toEqual([
			{ kind: 'receiptWithoutTrip', receiptId: 'f' }
		]);
	});

	it('a new trip from a receipt: a return ticket, a hotel, the way there only, nothing read', () => {
		expect(
			tripFromReceipt(
				read({
					kind: 'train',
					to: 'Musterstadt Hbf',
					departure: '2026-03-04T07:12',
					arrival: '2026-03-04T10:48',
					return_departure: '2026-03-05T17:10',
					return_arrival: '2026-03-05T20:41'
				})
			)
		).toEqual({
			destination: 'Musterstadt Hbf',
			start: '2026-03-04T07:12',
			end: '2026-03-05T20:41'
		});
		expect(
			tripFromReceipt(
				read({
					kind: 'train',
					to: 'B-Dorf',
					departure: '2026-03-04T07:12',
					arrival: '2026-03-04T09:00'
				})
			)
		).toEqual({ destination: 'B-Dorf', start: '2026-03-04T07:12', end: '2026-03-04T09:00' });
		expect(
			tripFromReceipt(
				read({
					kind: 'hotel',
					place: 'Musterstadt',
					check_in: '2026-03-04',
					check_out: '2026-03-06'
				})
			)
		).toEqual({ destination: 'Musterstadt', start: '2026-03-04T08:00', end: '2026-03-06T18:00' });
		expect(
			tripFromReceipt(read({ kind: 'flight', to: 'C-Hafen', departure: '2026-03-04T06:00' }))
		).toEqual({
			destination: 'C-Hafen',
			start: '2026-03-04T06:00',
			end: ''
		});
		expect(tripFromReceipt(receipt('t'))).toEqual({
			destination: '',
			start: '2026-05-04T08:00',
			end: '2026-05-04T18:00'
		});
	});

	it('breakfasts a hotel invoice includes: each morning after a night, within the trip, not marked yet', () => {
		const hotel = read({
			kind: 'hotel',
			check_in: '2026-05-03',
			check_out: '2026-05-06',
			breakfast_included: true
		});
		const t = trip('A', { start: '2026-05-04T07:00', end: '2026-05-06T19:00' });
		expect(breakfastProposals(t, [hotel])).toEqual(['2026-05-04', '2026-05-05', '2026-05-06']);
		expect(
			breakfastProposals({ ...t, meals: { '2026-05-05': { breakfast: true } } }, [hotel])
		).toEqual(['2026-05-04', '2026-05-06']);
		const without = read({
			.../** @type {any} */ (hotel).extraction.travel,
			breakfast_included: false
		});
		expect(breakfastProposals(t, [without])).toEqual([]);
		expect(breakfastProposals({ ...t, end: '' }, [hotel])).toEqual([]);
	});
});

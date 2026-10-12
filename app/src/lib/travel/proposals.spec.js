import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import { acceptProposal, dismissProposal } from './proposal-actions.js';
import { openTravelQuestions, pieceOf, tripProposals } from './proposals.js';

// Made-up tickets, hotels and bills; no real vendor, person or booking.

let n = 0;
/** A receipt read as travel. @param {Record<string, any>} travel @param {Record<string, any>} [over] */
const read = (travel, over = {}) => ({
	id: `r${++n}`,
	status: 'ausgelesen',
	documentDate: over.documentDate ?? '2026-04-01',
	amountCents: 5000,
	extraction: { document_type: 'invoice', travel },
	...over
});
const train = (
	/** @type {string} */ from,
	/** @type {string} */ to,
	/** @type {string} */ dep,
	/** @type {string} */ arr,
	over = {}
) => read({ kind: 'train', from, to, departure: dep, arrival: arr }, over);
const hotel = (
	/** @type {string} */ place,
	/** @type {string} */ inDay,
	/** @type {string} */ outDay
) =>
	read({
		kind: 'hotel',
		place,
		check_in: inDay,
		check_out: outDay,
		nights: 1,
		breakfast_included: true
	});

describe('trip proposals (#213, step 4b)', () => {
	it('what a receipt says: a fare’s times, a hotel’s nights; a guess or nothing says nothing', () => {
		expect(
			pieceOf(train('A-Stadt Hbf', 'Musterstadt Hbf', '2026-04-08T07:12', '2026-04-08T10:48'))
		).toMatchObject({
			fromDay: '2026-04-08',
			toDay: '2026-04-08',
			start: '2026-04-08T07:12',
			end: '2026-04-08T10:48'
		});
		expect(pieceOf(hotel('Musterstadt', '2026-04-08', '2026-04-10'))).toMatchObject({
			fromDay: '2026-04-08',
			toDay: '2026-04-10',
			to: 'Musterstadt'
		});
		expect(
			pieceOf({ id: 'g', fileName: 'Fahrkarte.pdf', travelGuess: { kind: 'train', words: [] } })
		).toBeNull();
		expect(
			pieceOf(read({ kind: 'hotel', check_in: '2026-04-10', check_out: '2026-04-08' }))
		).toBeNull();
	});

	it('there, a hotel, back, and a dinner: one trip, its times from the tickets', () => {
		const out = train('A-Stadt Hbf', 'Musterstadt Hbf', '2026-04-08T07:12', '2026-04-08T10:48', {
			documentDate: '2026-03-20' // bought weeks before: the day of travel counts
		});
		const stay = hotel('Musterstadt', '2026-04-08', '2026-04-09');
		const back = train('Musterstadt Hbf', 'A-Stadt Hbf', '2026-04-09T17:10', '2026-04-09T20:41');
		const dinner = read({ kind: 'restaurant' }, { documentDate: '2026-04-08' });
		const fuelAtHome = read({ kind: 'fuel' }, { documentDate: '2026-04-15' });
		const [p, ...rest] = tripProposals({
			receipts: [back, dinner, stay, out, fuelAtHome],
			travel: []
		});
		expect(rest).toEqual([]);
		expect(p).toMatchObject({
			destination: 'Musterstadt',
			start: '2026-04-08T07:12',
			end: '2026-04-09T20:41',
			tripId: null
		});
		expect(p.receiptIds).toEqual([out.id, stay.id, back.id, dinner.id].sort());
		expect(p.kinds.sort()).toEqual(['hotel', 'restaurant', 'train']);
	});

	it('across midnight: a night train is one trip', () => {
		const night = train('A-Stadt', 'B-Hafen', '2026-04-08T22:40', '2026-04-09T06:15');
		const back = train('B-Hafen', 'A-Stadt', '2026-04-09T18:00', '2026-04-09T23:50');
		const [p] = tripProposals({ receipts: [night, back], travel: [] });
		expect(p).toMatchObject({
			start: '2026-04-08T22:40',
			end: '2026-04-09T23:50',
			destination: 'B-Hafen'
		});
	});

	it('a day between: one trip where the way back starts where the way there ended, two day trips otherwise', () => {
		const there = train('A-Stadt', 'Musterstadt', '2026-04-06T07:00', '2026-04-06T10:00');
		const back = train('Musterstadt', 'A-Stadt', '2026-04-08T17:00', '2026-04-08T20:00');
		expect(tripProposals({ receipts: [there, back], travel: [] })).toHaveLength(1);

		// Two trips in one week, each there and back the same day.
		const mon = [
			train('A-Stadt', 'Musterstadt', '2026-04-06T07:00', '2026-04-06T09:00'),
			train('Musterstadt', 'A-Stadt', '2026-04-06T17:00', '2026-04-06T19:00')
		];
		const thu = [
			train('A-Stadt', 'B-Dorf', '2026-04-09T07:00', '2026-04-09T09:00'),
			train('B-Dorf', 'A-Stadt', '2026-04-09T17:00', '2026-04-09T19:00')
		];
		const both = tripProposals({ receipts: [...mon, ...thu], travel: [] });
		expect(both.map((p) => p.destination)).toEqual(['Musterstadt', 'B-Dorf']);
	});

	it('days of an existing trip: added to it; receipts on a trip already: nothing', () => {
		const trip = { id: 'T', kind: 'trip', start: '2026-04-08T07:00', end: '2026-04-09T21:00' };
		const stay = hotel('Musterstadt', '2026-04-08', '2026-04-09');
		expect(tripProposals({ receipts: [stay], travel: [trip] })[0].tripId).toBe('T');
		const assigned = { ...stay, travel: { tripId: 'T', paidBy: 'private' } };
		expect(tripProposals({ receipts: [assigned], travel: [trip] })).toEqual([]);
	});

	it('a dismissed proposal is not offered again; another receipt makes a new one', () => {
		const stay = hotel('Musterstadt', '2026-04-08', '2026-04-09');
		const [p] = tripProposals({ receipts: [stay], travel: [] });
		const travel = [{ id: 'D', kind: 'dismissed', key: p.key }];
		expect(tripProposals({ receipts: [stay], travel })).toEqual([]);
		const fare = train('A-Stadt', 'Musterstadt', '2026-04-08T07:00', '2026-04-08T09:00');
		expect(tripProposals({ receipts: [stay, fare], travel })).toHaveLength(1);
	});

	it('alone, a dinner or fuel proposes nothing', () => {
		expect(
			tripProposals({
				receipts: [read({ kind: 'restaurant' }), read({ kind: 'fuel' }), read({ kind: 'taxi' })],
				travel: []
			})
		).toEqual([]);
	});

	it('accepted: a trip with the receipts, each with who paid; or added to the trip it falls into; dismissed for good', async () => {
		const store = {
			travel: memoryCollection('travel').collection,
			receipts: memoryCollection('receipts').collection
		};
		const out = await store.receipts.put(
			train('A-Stadt', 'Musterstadt', '2026-04-08T07:12', '2026-04-08T10:48', { id: undefined })
		);
		const stay = await store.receipts.put({
			...hotel('Musterstadt', '2026-04-08', '2026-04-09'),
			id: undefined
		});
		const books = {
			transactions: [{ id: 'bank', source: 'hibiscus' }],
			matches: [{ receiptId: stay.id, transactionId: 'bank', state: 'confirmed' }]
		};
		const settings = defaultDatevSettings();
		const [p] = tripProposals({ receipts: await store.receipts.list(), travel: [] });
		const tripId = await acceptProposal({ store, proposal: p, settings, books });
		const trip = await store.travel.get(tripId);
		expect(trip).toMatchObject({
			kind: 'trip',
			destination: 'Musterstadt',
			start: '2026-04-08T07:12'
		});
		expect((await store.receipts.get(out.id))?.travel).toEqual({ tripId, paidBy: 'private' });
		expect((await store.receipts.get(stay.id))?.travel).toEqual({ tripId, paidBy: 'company' });
		expect(
			tripProposals({ receipts: await store.receipts.list(), travel: await store.travel.list() })
		).toEqual([]);

		// A taxi that day, read later: offered for the trip, and added to it.
		const taxi = await store.receipts.put({
			...read({ kind: 'taxi', departure: '2026-04-08T11:00' }),
			id: undefined
		});
		const [later] = tripProposals({
			receipts: await store.receipts.list(),
			travel: await store.travel.list()
		});
		expect(later).toMatchObject({ tripId, receiptIds: [taxi.id], kinds: ['taxi'] });
		expect(await acceptProposal({ store, proposal: later, settings, books })).toBe(tripId);
		expect((await store.receipts.get(taxi.id))?.travel?.tripId).toBe(tripId);
		expect((await store.travel.list()).filter((r) => r.kind === 'trip')).toHaveLength(1);

		await dismissProposal(store, 'x|y');
		expect((await store.travel.list()).some((r) => r.kind === 'dismissed' && r.key === 'x|y')).toBe(
			true
		);
	});

	it('a receipt a proposal covers, or one of a dismissed proposal, is not asked about', () => {
		const out = train('A-Stadt', 'Musterstadt', '2026-04-08T07:12', '2026-04-08T10:48');
		const lone = read({ kind: 'flight' }, { documentDate: '2026-06-01' });
		// A flight with no times proposes a one-day trip on its day too; without a kind, an old ticket only asks.
		const old = {
			id: 'old',
			status: 'ausgelesen',
			documentDate: '2026-05-01',
			extraction: { document_type: 'ticket' }
		};
		const asked = (/** @type {any[]} */ travel) =>
			openTravelQuestions({ receipts: [out, lone, old], travel }).map(
				(q) => /** @type {any} */ (q).receiptId
			);
		expect(asked([])).toEqual(['old']);
		const [p] = tripProposals({ receipts: [out], travel: [] });
		expect(asked([{ id: 'D', kind: 'dismissed', key: p.key }])).toEqual(['old']);
	});
});

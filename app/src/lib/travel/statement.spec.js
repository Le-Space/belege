import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { closedStatements, createTravelStatement } from './statement-actions.js';
import { lastDayOf, statementOf } from './statement.js';

// A made-up month: one trip with a ticket paid privately, a hotel paid by
// the company, a ticket booked as an outlay, a drive in a family member's
// car, and a business lunch at home. No real person, vendor or place.

const TRIP = {
	id: 'T1',
	kind: 'trip',
	travellerId: 'P',
	destination: 'Musterstadt',
	reason: 'Workshop Kundin Beispiel UG',
	place: 'Kundin Beispiel UG',
	start: '2026-05-04T07:00',
	end: '2026-05-05T19:30',
	country: 'DE',
	stops: [],
	overnight: null,
	meals: { '2026-05-05': { breakfast: true, lunch: false, dinner: false } },
	mileage: [
		{
			id: 'm1',
			date: '2026-05-04',
			from: 'Büro',
			to: 'Bahnhof',
			reason: 'Zum Zug',
			km: 12,
			roundTrip: true,
			vehicle: 'family',
			type: 'car',
			owner: 'Ehepartner',
			costBearer: 'Ehepartner'
		}
	],
	note: ''
};
const receipt = (/** @type {string} */ id, /** @type {Record<string, any>} */ over) => ({
	id,
	status: 'ausgelesen',
	currency: 'EUR',
	...over
});
/** @type {Record<string, any>[]} */
const RECEIPTS = [
	receipt('R1', {
		vendor: 'Bahn Beispiel AG',
		documentDate: '2026-05-04',
		amountCents: 8990,
		extraction: { vat: [{ rate: 7, amount: 5.88 }], travel: { kind: 'train' } },
		travel: { tripId: 'T1', paidBy: 'private' }
	}),
	receipt('R2', {
		vendor: 'Hotel Beispiel',
		documentDate: '2026-05-05',
		amountCents: 11200,
		extraction: { vat: [{ rate: 7, amount: 7.33 }], travel: { kind: 'hotel' } },
		travel: { tripId: 'T1', paidBy: 'company' }
	}),
	receipt('R3', {
		vendor: 'Bus Beispiel',
		documentDate: '2026-05-05',
		amountCents: 1900,
		extraction: { vat: [], travel: { kind: 'bus' } },
		travel: { tripId: 'T1', paidBy: 'private' }
	}),
	receipt('H1', {
		vendor: 'Gasthaus Beispiel',
		documentDate: '2026-05-20',
		amountCents: 11900,
		extraction: { vat: [{ rate: 19, amount: 19 }] },
		hospitality: {
			place: 'Gasthaus Beispiel',
			participants: ['Inhaberin Beispiel', 'Kunde Beispiel'],
			occasion: 'Angebot',
			tipCents: 0,
			tipTo: ''
		}
	})
];
// R3 was booked as a private outlay: paid back through the outlay account.
const TRANSACTIONS = [
	{ id: 'X', source: 'outlay', outlay: { receiptId: 'R3' }, amountCents: -1900 }
];
const base = {
	travellerId: 'P',
	month: '2026-05',
	travel: [TRIP],
	receipts: RECEIPTS,
	transactions: TRANSACTIONS
};

describe('the travel statement (#213, step 5)', () => {
	it('adds up: allowance, mileage, receipts by who paid, input VAT, hospitality, to pay back', () => {
		const s = statementOf(base);
		expect(s.ready).toBe(true);
		expect(s.trips).toHaveLength(1);
		expect(s.totals).toEqual({
			allowanceCents: 1400 + 1400 - 560,
			mileageCents: 24 * 30,
			privateCents: 8990 + 11900,
			outlayCents: 1900,
			companyCents: 11200,
			vatByRate: { 7: 588 + 733, 19: 1900 },
			hospitalityDeductibleCents: 7000,
			hospitalityNonDeductibleCents: 3000,
			toPayBackCents: 2240 + 720 + 8990 + 11900
		});
		expect(s.trips[0].receipts.find((l) => l.receiptId === 'R3')).toMatchObject({
			paidBy: 'private',
			outlay: true
		});
		expect(s.hospitality[0].line).toMatchObject({ receiptId: 'H1', paidBy: 'private' });
		expect(s.checks).toEqual([{ level: 'warning', code: 'familyCar', tripId: 'T1' }]);
		expect(s.rates.map((r) => r.kind).sort()).toEqual(['hospitality', 'meal', 'mileage']);
	});

	it('refuses with what is missing; warns where it can be made', () => {
		const untimed = statementOf({ ...base, travel: [{ ...TRIP, end: '' }] });
		// A trip without an end has no month… it starts in May, and has no times to count.
		expect(untimed.checks).toContainEqual({
			level: 'error',
			code: 'tripWithoutTimes',
			tripId: 'T1'
		});
		expect(untimed.ready).toBe(false);
		const noReason = statementOf({ ...base, travel: [{ ...TRIP, reason: '' }] });
		expect(noReason.checks).toContainEqual({
			level: 'error',
			code: 'tripWithoutReason',
			tripId: 'T1'
		});
		const bare = statementOf({
			...base,
			receipts: RECEIPTS.map((r) =>
				r.id === 'H1' ? { ...r, hospitality: { ...r.hospitality, occasion: '' } } : r
			)
		});
		expect(bare.checks).toContainEqual({
			level: 'error',
			code: 'hospitalityIncomplete',
			receiptId: 'H1'
		});
		const abroad = statementOf({
			...base,
			travel: [{ ...TRIP, stops: [{ at: '2026-05-04T12:00', country: 'AT' }] }]
		});
		expect(abroad.ready).toBe(true);
		expect(abroad.checks.filter((c) => c.code === 'noRateAbroad')).toHaveLength(2);
		const rubles = statementOf({
			...base,
			receipts: RECEIPTS.map((r) => (r.id === 'R1' ? { ...r, currency: 'RUB' } : r))
		});
		expect(rubles.checks).toContainEqual({
			level: 'warning',
			code: 'foreignCurrency',
			receiptId: 'R1'
		});
		expect(statementOf({ ...base, month: '2026-06' }).checks).toEqual([
			{ level: 'error', code: 'nothing' }
		]);
		expect(lastDayOf('2026-02')).toBe('2026-02-28');
	});

	it('made: numbered, a PDF kept as a receipt, closed with what it printed; a correction refers to it', async () => {
		const store = {
			travel: memoryCollection('travel').collection,
			receipts: memoryCollection('receipts').collection,
			events: memoryCollection('events').collection,
			transactions: memoryCollection('transactions').collection,
			matches: memoryCollection('matches').collection
		};
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: crypto.getRandomValues(new Uint8Array(32))
		});
		const traveller = await store.travel.put({
			kind: 'traveller',
			role: 'owner',
			name: 'Inhaberin Beispiel'
		});
		const trip = await store.travel.put({ ...TRIP, id: undefined, travellerId: traveller.id });
		/** @type {Record<string, string>} */
		const ids = {};
		for (const r of RECEIPTS) {
			const { id, ...rest } = r;
			const stored = await store.receipts.put({
				...rest,
				...(rest.travel ? { travel: { ...rest.travel, tripId: trip.id } } : {})
			});
			ids[id] = stored.id;
		}
		await store.transactions.put({
			...TRANSACTIONS[0],
			id: undefined,
			outlay: { receiptId: ids.R3 }
		});

		const made = await createTravelStatement({
			store,
			blobs,
			traveller,
			month: '2026-05',
			issuer: 'Beispiel GmbH',
			createdBy: 'did:key:test',
			now: () => new Date('2026-06-02T10:00:00Z')
		});
		expect(made.number).toBe('RK-2026-001');
		expect(made.statement).toMatchObject({
			kind: 'statement',
			state: 'closed',
			month: '2026-05',
			toPayBackCents: 2240 + 720 + 8990 + 11900,
			receiptId: made.receipt.id
		});
		expect(made.statement.snapshot.rates.length).toBe(3);
		expect(made.receipt).toMatchObject({
			source: 'eigenbeleg',
			selfNumber: 'RK-2026-001',
			amountCents: 23850,
			documentDate: '2026-05-31',
			vendor: 'Reisekostenabrechnung Inhaberin Beispiel'
		});
		const text = (
			await extractText(await getDocumentProxy(await blobs.get(made.receipt.fileCid)), {
				mergePages: true
			})
		).text.replace(/\s+/g, ' ');
		for (const expected of [
			'Reisekostenabrechnung',
			'RK-2026-001',
			'Beispiel GmbH',
			'Inhaberin Beispiel',
			'Musterstadt',
			'Workshop Kundin Beispiel UG',
			'Mahlzeiten',
			'Ehepartner',
			'Auslage',
			'Bewirtungen ohne Reise',
			'238,50 EUR',
			'§ 9 Abs. 4a EStG',
			'Fahrzeug eines Familienangehörigen'
		]) {
			expect(text, expected).toContain(expected);
		}

		// A second one for May is refused; a correction refers to the first, which stays.
		await expect(
			createTravelStatement({ store, blobs, traveller, month: '2026-05' })
		).rejects.toMatchObject({ code: 'exists' });
		const fixed = await createTravelStatement({
			store,
			blobs,
			traveller,
			month: '2026-05',
			corrects: made.statement.id,
			now: () => new Date('2026-06-03T10:00:00Z')
		});
		expect(fixed.number).toBe('RK-2026-002');
		expect(fixed.statement.corrects).toBe(made.statement.id);
		const both = closedStatements(await store.travel.list(), traveller.id, '2026-05');
		expect(both.map((s) => s.number)).toEqual(['RK-2026-002', 'RK-2026-001']);

		// Open checks: nothing is made.
		await store.travel.put({ ...trip, reason: '' });
		await expect(
			createTravelStatement({
				store,
				blobs,
				traveller,
				month: '2026-05',
				corrects: fixed.statement.id
			})
		).rejects.toMatchObject({ code: 'checks' });
	});
});

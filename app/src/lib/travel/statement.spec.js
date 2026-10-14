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

describe('the travel statement abroad (#379)', () => {
	it('prints the city’s rate and another country’s with why, and warns where the adviser must look', async () => {
		const { travelStatementPdf } = await import('./statement-pdf.js');
		const draw = async (/** @type {Record<string, any>[]} */ stops) => {
			const statement = statementOf({
				travellerId: 'P',
				month: '2026-05',
				travel: [{ ...TRIP, meals: {}, mileage: [], stops }],
				receipts: []
			});
			const bytes = await travelStatementPdf({
				number: 'RK-2026-009',
				issuer: 'Beispiel GmbH',
				traveller: 'Inhaberin Beispiel',
				role: 'owner',
				month: '2026-05',
				createdAt: '2026-06-02T10:00:00.000Z',
				corrects: null,
				statement
			});
			const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
			return text.replace(/\s+/g, ' ');
		};
		const moscow = await draw([{ at: '2026-05-04T12:00', country: 'RU', city: 'Moskau' }]);
		expect(moscow).toContain('Satz RU Moskau');
		expect(moscow).toContain('Verpflegung RU Moskau');
		expect(moscow).toContain('BMF-Schreiben vom 5. Dezember 2025');
		const unlisted = await draw([{ at: '2026-05-04T12:00', country: 'AF' }]);
		expect(unlisted).toContain('Verpflegung LU (Land nicht erfasst)');
		expect(unlisted).toContain('Satz für Luxemburg angesetzt');
	});
});

describe('the travel statement (#213, step 5)', () => {
	it('adds up: allowance, mileage, receipts by who paid, input VAT, hospitality, to pay back', () => {
		const s = statementOf(base);
		expect(s.ready).toBe(true);
		expect(s.trips).toHaveLength(1);
		expect(s.totals).toEqual({
			allowanceCents: 1400 + 1400 - 560,
			mileageCents: 24 * 30,
			lodgingCents: 0,
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
		expect(
			abroad.checks.filter((c) => c.code.startsWith('rate') || c.code === 'noRateAbroad')
		).toEqual([]);
		expect(abroad.rates.find((r) => r.kind === 'meal' && r.country === 'AT')).toMatchObject({
			full: 5000,
			source: expect.stringMatching(/BMF-Schreiben/)
		});
		// A country the BMF letter does not list (#379): Luxembourg's rate, named for the adviser.
		const unlisted = statementOf({
			...base,
			travel: [{ ...TRIP, stops: [{ at: '2026-05-04T12:00', country: 'AF' }] }]
		});
		expect(unlisted.ready).toBe(true);
		expect(unlisted.checks.filter((c) => c.code === 'rateNotListed')).toEqual([
			{ level: 'warning', code: 'rateNotListed', tripId: 'T1', date: '2026-05-04' },
			{ level: 'warning', code: 'rateNotListed', tripId: 'T1', date: '2026-05-05' }
		]);
		// Before the first letter in the table: no rate at all.
		const early = statementOf({
			...base,
			month: '2024-05',
			travel: [
				{
					...TRIP,
					start: '2024-05-04T07:00',
					end: '2024-05-05T19:30',
					meals: {},
					mileage: [],
					stops: [{ at: '2024-05-04T12:00', country: 'AT' }]
				}
			],
			receipts: []
		});
		expect(early.checks.filter((c) => c.code === 'noRateAbroad')).toHaveLength(2);
		// A ticket in rubles (made up): never its amount taken as euros (#213).
		const inRubles = (/** @type {Record<string, any>} */ travel) =>
			RECEIPTS.map((r) =>
				r.id === 'R1'
					? {
							...r,
							currency: 'RUB',
							amountCents: 1_499_000,
							extraction: { ...r.extraction, vat: [{ rate: 20, amount: 2498.33 }] },
							travel: { ...r.travel, ...travel }
						}
					: r
			);
		const noRate = statementOf({ ...base, receipts: inRubles({}) });
		expect(noRate.checks).toContainEqual({
			level: 'error',
			code: 'foreignWithoutRate',
			receiptId: 'R1'
		});
		expect(noRate.ready).toBe(false);
		expect(noRate.trips[0].receipts.find((l) => l.receiptId === 'R1')?.grossCents).toBeNull();
		// With a rate kept on the receipt: 14.990 RUB at 0.0105 EUR is 157,40 EUR, the Russian VAT no input VAT.
		const byRate = statementOf({
			...base,
			receipts: inRubles({ euro: { cents: 15740, rate: '0.0105', source: 'cbr' } })
		});
		expect(byRate.ready).toBe(true);
		expect(byRate.checks).toContainEqual({
			level: 'warning',
			code: 'foreignCurrency',
			receiptId: 'R1'
		});
		expect(byRate.trips[0].receipts.find((l) => l.receiptId === 'R1')).toMatchObject({
			grossCents: 15740,
			currency: 'RUB',
			originalCents: 1_499_000,
			rate: '0.0105',
			vat: []
		});
		expect(byRate.totals.privateCents).toBe(15740 + 11900);
		expect(byRate.totals.vatByRate).toEqual({ 7: 733, 19: 1900 });
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

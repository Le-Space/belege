// Employees as travellers (#380): their own statements, booked on the
// employee set and their own clearing account; nothing booked without it;
// the hospitality bills of no trip stay the owner's; the payout recognised
// by the IBAN's last digits. Every person, account and amount is made up.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import { suggestBooking } from '../booking/suggest.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { travelSet, travelSetOf } from './accounts.js';
import { statementLines, travellerAccount } from './booking.js';
import { lodgingFlat, nightsOf } from './lodging.js';
import { suggestStatements } from './payout.js';
import {
	cleanTraveller,
	cleanTrip,
	removeTraveller,
	saveTraveller,
	saveTrip,
	travellersOf,
	tripFigures
} from './records.js';
import { createTravelStatement } from './statement-actions.js';
import { statementOf } from './statement.js';

const store = () => ({
	travel: memoryCollection('travel').collection,
	receipts: memoryCollection('receipts').collection,
	events: memoryCollection('events').collection,
	transactions: memoryCollection('transactions').collection,
	matches: memoryCollection('matches').collection,
	accounts: memoryCollection('accounts').collection
});

const TRIP = {
	destination: 'Musterstadt',
	reason: 'Montage Kundin Beispiel UG',
	start: '2026-05-04T07:00',
	end: '2026-05-05T19:30'
};

describe('travellers (#380)', () => {
	it('kept clean: an employee needs a clearing account; the IBAN’s last four digits only', () => {
		expect(cleanTraveller({ name: ' Max Beispiel ', ibanLast4: '12 34' })).toEqual({
			traveller: {
				kind: 'traveller',
				role: 'employee',
				name: 'Max Beispiel',
				clearingAccount: '',
				ibanLast4: '1234'
			},
			problems: ['noClearingAccount']
		});
		expect(
			cleanTraveller({ role: 'owner', name: 'Inhaberin', ibanLast4: 'DE00' }).problems
		).toEqual([]);
		expect(cleanTraveller({ role: 'owner', ibanLast4: 'DE00' }).traveller.ibanLast4).toBe('');
		expect(() => cleanTraveller({ name: 'X', clearingAccount: 'Kasse' })).toThrow(/account/);
	});

	it('one owner; removed only without trips; the owner listed first', async () => {
		const s = store();
		await saveTraveller(s, { role: 'owner', name: 'Inhaberin Beispiel' });
		await expect(saveTraveller(s, { role: 'owner', name: 'Zweite' })).rejects.toMatchObject({
			code: 'owner'
		});
		const { traveller: anna } = await saveTraveller(s, {
			name: 'Anna Beispiel',
			clearingAccount: '70001'
		});
		const { traveller: ben } = await saveTraveller(s, {
			name: 'Ben Beispiel',
			clearingAccount: '70002'
		});
		expect(travellersOf(await s.travel.list()).map((p) => p.name)).toEqual([
			'Inhaberin Beispiel',
			'Anna Beispiel',
			'Ben Beispiel'
		]);
		await saveTrip(s, { ...TRIP, travellerId: anna.id });
		await expect(removeTraveller(s, String(anna.id))).rejects.toMatchObject({ code: 'inUse' });
		await removeTraveller(s, String(ben.id));
		expect(travellersOf(await s.travel.list()).map((p) => p.name)).toEqual([
			'Inhaberin Beispiel',
			'Anna Beispiel'
		]);
	});

	it('the account set: an employee’s whatever the legal form; a receipt by its trip’s traveller', () => {
		const sole = { legalForm: 'sole' };
		expect(travelSet(sole)).toBe('owner');
		expect(travelSet(sole, { role: 'owner' })).toBe('owner');
		expect(travelSet(sole, { role: 'employee' })).toBe('employee');
		const travel = [
			{ id: 'O', kind: 'traveller', role: 'owner' },
			{ id: 'E', kind: 'traveller', role: 'employee' },
			{ id: 'T1', kind: 'trip', travellerId: 'O' },
			{ id: 'T2', kind: 'trip', travellerId: 'E' }
		];
		const setOf = travelSetOf(sole, travel);
		expect(setOf({ travel: { tripId: 'T1' } })).toBe('owner');
		expect(setOf({ travel: { tripId: 'T2' } })).toBe('employee');
		expect(setOf({ hospitality: {} })).toBe('owner');
		// A hotel on the employee's trip, paid from the business account: 4666, not 4676.
		const hotel = {
			id: 'R',
			travel: { tripId: 'T2', paidBy: 'company' },
			extraction: { vat: [{ rate: 7, amount: 7 }], travel: { kind: 'hotel' } }
		};
		expect(
			suggestBooking(
				{ id: 'X', amountCents: -10700, source: 'hibiscus' },
				{ receipts: [hotel], travelSet: setOf }
			)
		).toMatchObject({ account: '4666', source: 'travel' });
	});

	it('an employee’s statement: their trips only, no hospitality bill of the month; blocked without the account', async () => {
		const s = store();
		const { traveller: owner } = await saveTraveller(s, { role: 'owner', name: 'Inhaberin' });
		const { traveller: anna } = await saveTraveller(s, { name: 'Anna Beispiel' });
		await saveTrip(s, { ...TRIP, travellerId: anna.id });
		await s.receipts.put({
			vendor: 'Gasthaus Beispiel',
			documentDate: '2026-05-20',
			amountCents: 11900,
			currency: 'EUR',
			status: 'ausgelesen',
			extraction: { vat: [{ rate: 19, amount: 19 }] },
			hospitality: { place: 'Gasthaus', participants: ['A', 'B'], occasion: 'Angebot' }
		});
		const books = {
			month: '2026-05',
			travel: await s.travel.list(),
			receipts: await s.receipts.list()
		};
		const theirs = statementOf({ ...books, travellerId: String(anna.id) });
		expect(theirs.hospitality).toEqual([]);
		expect(theirs.totals.allowanceCents).toBe(2800);
		expect(theirs.ready).toBe(false);
		expect(theirs.checks).toContainEqual({ level: 'error', code: 'travellerWithoutAccount' });
		// The owner's has the bill, and no trip.
		const mine = statementOf({ ...books, travellerId: String(owner.id) });
		expect(mine.hospitality).toHaveLength(1);
		expect(mine.trips).toEqual([]);
	});

	it('booked on the employee set and their own clearing account; none without it', async () => {
		const s = store();
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: crypto.getRandomValues(new Uint8Array(32))
		});
		const settings = { ...defaultDatevSettings(), legalForm: /** @type {const} */ ('sole') };
		const { traveller: anna } = await saveTraveller(s, {
			name: 'Anna Beispiel',
			clearingAccount: '70001'
		});
		await saveTrip(s, { ...TRIP, travellerId: anna.id });
		const made = await createTravelStatement({
			store: s,
			blobs,
			traveller: anna,
			settings,
			month: '2026-05',
			now: () => new Date('2026-06-02T10:00:00Z')
		});
		const booking = /** @type {any} */ (made.booking);
		expect(booking.account).toMatchObject({
			name: 'Reisekosten Anna Beispiel',
			ledgerAccount: '70001'
		});
		// A sole proprietor's employee: 4664, not the owner's 4674.
		expect(
			booking.booked.map((/** @type {any} */ t) => [t.travelLine?.account, t.amountCents])
		).toEqual([['4664', -2800]]);
		await expect(
			travellerAccount(s, settings, { id: 'B', role: 'employee', name: 'Ben' })
		).rejects.toThrow(/clearing account/);
	});

	it('a payout to an IBAN ending in a traveller’s digits suggests that traveller’s statements', () => {
		/** @param {string} id @param {string} travellerId @param {number} cents */
		const open = (id, travellerId, cents) => ({
			head: { id, travellerId, number: `RK-2026-${id}`, month: '2026-05' },
			openCents: cents
		});
		const all = [open('001', 'O', 5000), open('002', 'A', 5000), open('003', 'A', 2000)];
		const travellers = [
			{ id: 'O', role: 'owner', ibanLast4: '1111' },
			{ id: 'A', role: 'employee', ibanLast4: '2222' }
		];
		const tx = (/** @type {string} */ iban, /** @type {number} */ cents) => ({
			amountCents: -cents,
			counterpartyIban: iban,
			purpose: 'Reisekosten'
		});
		// 5.000 fits the owner's and Anna's; her IBAN decides.
		expect(
			suggestStatements(
				tx('DE00 0000 0000 0000 0022 22', 5000),
				/** @type {any} */ (all),
				travellers
			)
		).toEqual(['002']);
		expect(
			suggestStatements(tx('DE00000000000000001111', 5000), /** @type {any} */ (all), travellers)
		).toEqual(['001']);
		// An IBAN no one has: by the amounts, as before – the oldest that add up.
		expect(
			suggestStatements(tx('DE00000000000000009999', 7000), /** @type {any} */ (all), travellers)
		).toEqual(['001', '003']);
	});
});

describe('overnight flat rates without an invoice (#380, step 2)', () => {
	it('the nights of a trip, and their rates: 20 € at home, the letter’s abroad, by the place at midnight', () => {
		expect(nightsOf('2026-05-04T07:00', '2026-05-07T18:00')).toEqual([
			'2026-05-04',
			'2026-05-05',
			'2026-05-06'
		]);
		expect(nightsOf('2026-05-04T07:00', '2026-05-04T21:00')).toEqual([]);
		// Out on Monday, in Moscow from Tuesday noon, home on Thursday.
		const trip = {
			start: '2026-05-04T07:00',
			end: '2026-05-07T18:00',
			stops: [
				{ at: '2026-05-05T12:00', country: 'RU', city: 'Moskau' },
				{ at: '2026-05-07T15:00', country: 'DE' }
			]
		};
		const flat = lodgingFlat({ ...trip, nights: ['2026-05-04', '2026-05-05', '2026-05-09'] });
		expect(flat.nights.map((n) => [n.date, n.country, n.city, n.cents])).toEqual([
			['2026-05-04', 'DE', null, 2000],
			['2026-05-05', 'RU', 'Moskau', 23500]
		]);
		expect(flat).toMatchObject({ cents: 25500, missing: [] });
		expect(flat.nights[0].rate?.source).toBe('R 9.7 Abs. 3 LStR');
		expect(flat.nights[1].rate?.source).toMatch(/BMF-Schreiben vom 5. Dezember 2025/);
		// Abroad before the first letter in the table: no rate, named.
		const early = lodgingFlat({
			start: '2024-05-04T07:00',
			end: '2024-05-06T18:00',
			stops: [{ at: '2024-05-04T12:00', country: 'AT' }],
			nights: ['2024-05-04']
		});
		expect(early).toMatchObject({ cents: 0, missing: ['2024-05-04'] });
	});

	it('kept on the trip; counted for an employee only, never for the owner', () => {
		const { trip } = cleanTrip({
			...TRIP,
			travellerId: 'E',
			nights: ['2026-05-04', 'x', '2026-05-04']
		});
		expect(trip.nights).toEqual(['2026-05-04']);
		const employee = tripFigures(trip, [], { traveller: { role: 'employee' } });
		expect(employee).toMatchObject({ lodgingCents: 2000, allowanceCents: 2800 });
		const owner = tripFigures(trip, [], { traveller: { role: 'owner' } });
		expect(owner).toMatchObject({ lodging: null, lodgingCents: 0 });
	});

	it('in the statement and its booking: paid back, on the accommodation account; a hotel receipt beside it warned', async () => {
		const s = store();
		const { traveller: anna } = await saveTraveller(s, {
			name: 'Anna Beispiel',
			clearingAccount: '70001'
		});
		const { trip } = await saveTrip(s, { ...TRIP, travellerId: anna.id, nights: ['2026-05-04'] });
		const books = () => ({ month: '2026-05', travellerId: String(anna.id) });
		const plain = statementOf({
			...books(),
			travel: await s.travel.list(),
			receipts: await s.receipts.list()
		});
		expect(plain.totals).toMatchObject({ lodgingCents: 2000, toPayBackCents: 2800 + 2000 });
		expect(plain.rates).toContainEqual(
			expect.objectContaining({ kind: 'lodging', country: 'DE', cents: 2000 })
		);
		expect(plain.checks.filter((c) => c.code.startsWith('lodging'))).toEqual([]);
		expect(
			statementLines(plain, { set: 'employee', receipts: new Map() }).map((l) => [
				l.key,
				l.account,
				l.cents,
				l.taxKey
			])
		).toEqual([
			['meals', '4664', 2800, ''],
			['lodging', '4666', 2000, '']
		]);
		// A hotel bill on the same trip as well: said, for no night to be paid twice.
		await s.receipts.put({
			vendor: 'Hotel Beispiel',
			documentDate: '2026-05-05',
			amountCents: 9000,
			currency: 'EUR',
			status: 'ausgelesen',
			extraction: { vat: [{ rate: 7, amount: 5.89 }], travel: { kind: 'hotel' } },
			travel: { tripId: trip.id, paidBy: 'company' }
		});
		const both = statementOf({
			...books(),
			travel: await s.travel.list(),
			receipts: await s.receipts.list()
		});
		expect(both.checks).toContainEqual({
			level: 'warning',
			code: 'lodgingWithHotel',
			tripId: trip.id
		});
		expect(both.ready).toBe(true);
	});
});

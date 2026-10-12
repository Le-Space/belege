import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import { confirmBookings } from '../booking/actions.js';
import { suggestBooking } from '../booking/suggest.js';
import { planMonth } from '../export/plan.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { travelSet } from './accounts.js';
import { statementLines } from './booking.js';
import { createTravelStatement } from './statement-actions.js';
import { statementOf } from './statement.js';

// A made-up month, as in statement.spec.js: a ticket paid privately, a hotel
// paid by the company, a ticket booked as an outlay, a family member's car,
// and a business lunch without a trip.

const TRIP = {
	kind: 'trip',
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
/** @type {Record<string, any>[]} */
const RECEIPTS = [
	{
		key: 'R1',
		vendor: 'Bahn Beispiel AG',
		documentDate: '2026-05-04',
		amountCents: 8990,
		extraction: { vat: [{ rate: 7, amount: 5.88 }], travel: { kind: 'train' } },
		paidBy: 'private'
	},
	{
		key: 'R2',
		vendor: 'Hotel Beispiel',
		documentDate: '2026-05-05',
		amountCents: 11200,
		extraction: { vat: [{ rate: 7, amount: 7.33 }], travel: { kind: 'hotel' } },
		paidBy: 'company'
	},
	{
		key: 'R3',
		vendor: 'Bus Beispiel',
		documentDate: '2026-05-05',
		amountCents: 1900,
		extraction: { vat: [], travel: { kind: 'bus' } },
		paidBy: 'private'
	},
	{
		key: 'H1',
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
	}
];

/** The books in memory, the trip and receipts in them. @param {Record<string, any>} settings */
async function books(settings) {
	const store = {
		travel: memoryCollection('travel').collection,
		receipts: memoryCollection('receipts').collection,
		events: memoryCollection('events').collection,
		transactions: memoryCollection('transactions').collection,
		matches: memoryCollection('matches').collection,
		accounts: memoryCollection('accounts').collection
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
	const trip = await store.travel.put({ ...TRIP, travellerId: traveller.id });
	/** @type {Record<string, string>} */
	const ids = {};
	for (const { key, paidBy, ...r } of RECEIPTS) {
		const stored = await store.receipts.put({
			...r,
			status: 'ausgelesen',
			currency: 'EUR',
			...(paidBy ? { travel: { tripId: trip.id, paidBy } } : {})
		});
		ids[key] = stored.id;
	}
	// R3 was booked as a private outlay (#293).
	await store.transactions.put({
		source: 'outlay',
		outlay: { receiptId: ids.R3 },
		amountCents: -1900
	});
	return { store, blobs, traveller, trip, ids, settings };
}

describe('travel bookings (#213, step 6)', () => {
	it('the lines: private receipts by category and key, hospitality split, allowances, mileage; by the legal form', async () => {
		const b = await books(defaultDatevSettings());
		const receipts = await b.store.receipts.list();
		const s = statementOf({
			travellerId: b.traveller.id,
			month: '2026-05',
			travel: await b.store.travel.list(),
			receipts,
			transactions: await b.store.transactions.list()
		});
		const byId = new Map(receipts.map((r) => [String(r.id), r]));
		const employee = statementLines(s, { set: 'employee', receipts: byId });
		expect(employee.map((l) => [l.category, l.account, l.cents, l.taxKey])).toEqual([
			['fares', '4663', 8990, '8'],
			['hospitality', '4650', 7000 + 1900, '9'],
			['hospitalityNonDeductible', '4654', 3000, ''],
			['meals', '4664', 2240, ''],
			['mileage', '4668', 720, '']
		]);
		// Lines add up to what is paid back.
		expect(employee.reduce((n, l) => n + l.cents, 0)).toBe(s.totals.toPayBackCents);
		const owner = statementLines(s, { set: 'owner', receipts: byId });
		expect(owner.map((l) => l.account)).toEqual(['4673', '4650', '4654', '4674', '4673']);
		expect(travelSet({ legalForm: 'corporation' })).toBe('employee');
		expect(travelSet({ legalForm: 'sole' })).toBe('owner');
		expect(travelSet({})).toBe('owner');
	});

	it('booked with the statement: on the traveller’s account, its ledger the clearing account; linked; suggested; exported', async () => {
		const settings = {
			...defaultDatevSettings(),
			legalForm: /** @type {const} */ ('corporation'),
			shareholderAccount: '1520'
		};
		const b = await books(settings);
		const made = await createTravelStatement({
			store: b.store,
			blobs: b.blobs,
			traveller: b.traveller,
			settings,
			month: '2026-05',
			now: () => new Date('2026-06-02T10:00:00Z')
		});
		const booking = /** @type {any} */ (made.booking);
		expect(booking.account).toMatchObject({
			name: 'Reisekosten Inhaberin Beispiel',
			kind: 'travel',
			ledgerAccount: '1520'
		});
		expect(booking.booked).toHaveLength(5);
		expect(
			booking.booked.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + t.amountCents, 0)
		).toBe(-made.statement.toPayBackCents);
		expect(booking.booked.every((/** @type {any} */ t) => t.bookedOn === '2026-05-31')).toBe(true);
		expect(booking.booked[0].purpose).toBe('RK-2026-001 · Bahn Beispiel AG');

		// Linked: the ticket to its line, the statement to the allowance and mileage, the bill to both its halves.
		const matches = await b.store.matches.list();
		const linked = (/** @type {string} */ receiptId) =>
			matches.filter((m) => m.receiptId === receiptId && m.state !== 'rejected').length;
		expect(linked(b.ids.R1)).toBe(1);
		expect(linked(b.ids.H1)).toBe(2);
		expect(linked(made.receipt.id)).toBe(2);
		expect(linked(b.ids.R2)).toBe(0);

		// Suggested from the line itself; confirmed, into the month's Buchungsstapel.
		const suggestions = booking.booked.map((/** @type {any} */ tx) => suggestBooking(tx, {}));
		expect(suggestions.map((/** @type {any} */ s) => [s.source, s.account, s.taxKey])).toEqual([
			['travel', '4663', '8'],
			['travel', '4650', '9'],
			['travel', '4654', ''],
			['travel', '4664', ''],
			['travel', '4668', '']
		]);
		await confirmBookings(
			/** @type {any} */ (b.store),
			booking.booked.map((/** @type {any} */ tx, /** @type {number} */ i) => ({
				transactionId: tx.id,
				account: suggestions[i].account,
				taxKey: suggestions[i].taxKey
			}))
		);
		const plan = planMonth({
			month: '2026-05',
			transactions: await b.store.transactions.list(),
			accounts: await b.store.accounts.list(),
			receipts: await b.store.receipts.list(),
			matches: await b.store.matches.list(),
			classifications: {},
			withStatements: false
		});
		const lines = plan.lines.filter((l) => l.tx.source === 'travel').map((l) => l.line);
		expect(lines.map((l) => [l.account, l.contra, l.amountCents, l.taxKey])).toEqual([
			['1520', '4663', -8990, '8'],
			['1520', '4650', -8900, '9'],
			['1520', '4654', -3000, ''],
			['1520', '4664', -2240, ''],
			['1520', '4668', -720, '']
		]);
		expect(plan.checks.noLedger).toEqual([]);
	});

	it('a correction reverses what the first booked, then books its own', async () => {
		const settings = { ...defaultDatevSettings(), legalForm: /** @type {const} */ ('sole') };
		const b = await books(settings);
		const first = await createTravelStatement({
			store: b.store,
			blobs: b.blobs,
			traveller: b.traveller,
			settings,
			month: '2026-05'
		});
		const fixed = await createTravelStatement({
			store: b.store,
			blobs: b.blobs,
			traveller: b.traveller,
			settings,
			month: '2026-05',
			corrects: first.statement.id
		});
		const booking = /** @type {any} */ (fixed.booking);
		expect(booking.account.ledgerAccount).toBe('1890');
		expect(booking.reversed).toHaveLength(5);
		expect(booking.reversed[0].purpose).toBe('Storno RK-2026-001 · Bahn Beispiel AG');
		const travel = (await b.store.transactions.list()).filter((t) => t.source === 'travel');
		// First, its reversal, and the correction: what is owed is the correction's.
		expect(travel).toHaveLength(15);
		expect(travel.reduce((n, t) => n + t.amountCents, 0)).toBe(-fixed.statement.toPayBackCents);
	});

	it('a receipt in rubles is booked in its euros, without a German key', async () => {
		const b = await books(defaultDatevSettings());
		// The private ticket in rubles (made up), its rate kept on the trip link.
		const r1 = await b.store.receipts.get(b.ids.R1);
		await b.store.receipts.put({
			...r1,
			currency: 'RUB',
			amountCents: 1_499_000,
			extraction: { vat: [{ rate: 20, amount: 2498.33 }], travel: { kind: 'event' } },
			travel: { ...r1?.travel, euro: { cents: 15741, rate: '0.010500892576', source: 'manual' } }
		});
		const receipts = await b.store.receipts.list();
		const s = statementOf({
			travellerId: b.traveller.id,
			month: '2026-05',
			travel: await b.store.travel.list(),
			receipts,
			transactions: await b.store.transactions.list()
		});
		const lines = statementLines(s, {
			set: 'owner',
			receipts: new Map(receipts.map((r) => [String(r.id), r]))
		});
		expect(lines[0]).toMatchObject({
			receiptId: b.ids.R1,
			cents: 15741,
			account: '4670',
			taxKey: '',
			taxVia: 'no-vat'
		});
		expect(lines.reduce((n, l) => n + l.cents, 0)).toBe(s.totals.toPayBackCents);
	});

	it('a receipt on a trip paid from a business account is suggested its travel account', () => {
		const tx = { id: 'T', amountCents: -11200 };
		const hotel = {
			id: 'R2',
			amountCents: 11200,
			extraction: { vat: [{ rate: 7, amount: 7.33 }], travel: { kind: 'hotel' } },
			travel: { tripId: 'X', paidBy: 'company' }
		};
		expect(suggestBooking(tx, { receipts: [hotel], travelSet: 'owner' })).toMatchObject({
			source: 'travel',
			account: '4676',
			taxKey: '8',
			category: 'accommodation'
		});
		// Without the set (or off a trip), as before.
		expect(suggestBooking(tx, { receipts: [hotel] }).source).toBeNull();
	});
});

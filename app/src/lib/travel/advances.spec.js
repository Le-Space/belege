// Advances before a trip (#381): marked on the payment, booked against the
// traveller's clearing account, settled with the statements – for a trip on
// its statement, else the oldest first – and printed on the statement. Every
// person, trip and amount is made up.
import { describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { defaultDatevSettings } from '../booking/settings.js';
import { suggestBooking } from '../booking/suggest.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { clearingAccountOf } from './accounts.js';
import {
	ADVANCE_REASON,
	advancesOf,
	allocateAdvances,
	markAdvance,
	unmarkAdvance
} from './advances.js';
import { linkPayout, statementSettlements } from './payout.js';
import { saveTraveller, saveTrip } from './records.js';
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

/** @param {string} id @param {string} day @param {number} cents @param {Record<string, any>} [advance] */
const tx = (id, day, cents, advance) => ({
	id,
	bookedOn: day,
	amountCents: cents,
	currency: 'EUR',
	source: 'hibiscus',
	...(advance ? { travelAdvance: advance } : {})
});
/** A payment not stored yet: the store gives it its id. @param {string} day @param {number} cents */
const fresh = (day, cents) => ({ ...tx('', day, cents), id: undefined });
/** @param {string} id @param {string} travellerId @param {string} month @param {number} cents @param {string[]} [trips] */
const statement = (id, travellerId, month, cents, trips = []) => ({
	id,
	kind: 'statement',
	state: 'closed',
	travellerId,
	month,
	number: `RK-2026-${id}`,
	closedAt: `${month}-28T10:00:00.000Z`,
	receiptId: `R-${id}`,
	toPayBackCents: cents,
	snapshot: { trips: trips.map((tripId) => ({ tripId })) }
});

const TRIP = {
	destination: 'Musterstadt',
	reason: 'Messe Beispiel',
	start: '2026-05-04T07:00',
	end: '2026-05-05T19:30'
};

describe('advances before a trip (#381)', () => {
	it('settled: for a trip on its statement, else the oldest first; what is left stays open', () => {
		const travel = [
			statement('001', 'A', '2026-04', 5000, ['T-APR']),
			statement('002', 'A', '2026-05', 8000, ['T-MAY']),
			statement('003', 'B', '2026-05', 9000)
		];
		const transactions = [
			// For the May trip, more than it cost: a claim on the traveller.
			tx('X1', '2026-04-28', -10000, { travellerId: 'A', tripId: 'T-MAY' }),
			// For no trip: April first, then May.
			tx('X2', '2026-03-01', -6000, { travellerId: 'A' }),
			// For a trip without a statement yet: open.
			tx('X3', '2026-06-01', -3000, { travellerId: 'A', tripId: 'T-JUN' }),
			// Someone else's statement is not touched.
			tx('X4', '2026-03-02', -500, { travellerId: 'C' })
		];
		const [apr, may, other] = statementSettlements({ travel, matches: [], transactions });
		expect(apr).toMatchObject({ advanceCents: 5000, openCents: 0 });
		expect(may.advances.map((a) => [a.tx.id, a.cents])).toEqual([['X1', 10000]]);
		// X2's last 1.000 finds no room in May (X1 already over it): open.
		expect(may).toMatchObject({ advanceCents: 10000, openCents: -2000 });
		expect(other).toMatchObject({ advanceCents: 0, openCents: 9000 });
		const { open } = allocateAdvances(
			[{ head: travel[0] }, { head: travel[1] }, { head: travel[2] }],
			advancesOf(transactions)
		);
		expect(open.map((o) => [o.advance.tx.id, o.cents])).toEqual([
			['X3', 3000],
			['X2', 1000],
			['X4', 500]
		]);
	});

	it('marked on money out, with no receipt of its own; taken back; refused on income or another currency', async () => {
		const s = store();
		const { traveller: anna } = await saveTraveller(s, {
			name: 'Anna Beispiel',
			clearingAccount: '70001'
		});
		const { trip } = await saveTrip(s, { ...TRIP, travellerId: anna.id });
		const out = await s.transactions.put(fresh('2026-04-28', -15000));
		await markAdvance(s, String(out.id), { travellerId: String(anna.id), tripId: String(trip.id) });
		const marked = await s.transactions.get(String(out.id));
		expect(marked?.travelAdvance).toMatchObject({ travellerId: anna.id, tripId: trip.id });
		expect(marked?.noReceipt).toMatchObject({ reason: ADVANCE_REASON });
		await unmarkAdvance(s, String(out.id));
		const back = await s.transactions.get(String(out.id));
		expect(back?.travelAdvance).toBeNull();
		expect(back?.noReceipt).toBeNull();
		const income = await s.transactions.put(fresh('2026-04-28', 15000));
		await expect(
			markAdvance(s, String(income.id), { travellerId: String(anna.id) })
		).rejects.toThrow();
		const roubles = await s.transactions.put({ ...fresh('2026-04-28', -15000), currency: 'RUB' });
		await expect(
			markAdvance(s, String(roubles.id), { travellerId: String(anna.id) })
		).rejects.toThrow();
		// A trip of someone else: refused.
		const { traveller: ben } = await saveTraveller(s, { name: 'Ben', clearingAccount: '70002' });
		await expect(
			markAdvance(s, String(out.id), { travellerId: String(ben.id), tripId: String(trip.id) })
		).rejects.toThrow();
	});

	it('booked against the traveller’s clearing account – the payout of an employee’s statement too', () => {
		const settings = { ...defaultDatevSettings(), legalForm: /** @type {const} */ ('sole') };
		const travel = [
			{ id: 'O', kind: 'traveller', role: 'owner' },
			{ id: 'E', kind: 'traveller', role: 'employee', clearingAccount: '70001' },
			{ id: 'N', kind: 'traveller', role: 'employee' },
			statement('001', 'E', '2026-05', 5000)
		];
		const clearing = clearingAccountOf(settings, travel);
		const advance = (/** @type {string} */ travellerId) =>
			suggestBooking(tx('X', '2026-04-28', -5000, { travellerId }), { travelClearing: clearing });
		expect(advance('E')).toMatchObject({ account: '70001', source: 'travel', category: 'advance' });
		// The owner of a sole proprietorship: a withdrawal.
		expect(advance('O')).toMatchObject({ account: '1800' });
		// An employee without a clearing account: none, asked for.
		expect(advance('N').account).toBeNull();
		// The payout of the employee's statement: her account, not the owner's 1800 (#380).
		const pdf = { id: 'R-001', selfReceipt: { kind: 'travel-statement' } };
		expect(
			suggestBooking(tx('P', '2026-06-05', -5000), { receipts: [pdf], travelClearing: clearing })
		).toMatchObject({ account: '70001', category: 'payout' });
	});

	it('a trip with an advance, its statement paying out the rest, the PDF saying so', async () => {
		const s = store();
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: crypto.getRandomValues(new Uint8Array(32))
		});
		const { traveller: anna } = await saveTraveller(s, {
			name: 'Anna Beispiel',
			clearingAccount: '70001'
		});
		const { trip } = await saveTrip(s, { ...TRIP, travellerId: anna.id });
		// 20 EUR before the trip; the trip comes to 28 EUR of allowances.
		const advance = await s.transactions.put(fresh('2026-04-28', -2000));
		await markAdvance(s, String(advance.id), {
			travellerId: String(anna.id),
			tripId: String(trip.id)
		});
		const preview = statementOf({
			travellerId: String(anna.id),
			month: '2026-05',
			travel: await s.travel.list(),
			receipts: [],
			transactions: await s.transactions.list()
		});
		expect(preview.totals).toMatchObject({
			toPayBackCents: 2800,
			advanceCents: 2000,
			toPayOutCents: 800
		});
		expect(preview.advances).toEqual([
			{ transactionId: advance.id, date: '2026-04-28', tripId: trip.id, cents: 2000 }
		]);

		const made = await createTravelStatement({
			store: s,
			blobs,
			traveller: anna,
			settings: defaultDatevSettings(),
			month: '2026-05',
			now: () => new Date('2026-06-02T10:00:00Z')
		});
		expect(made.statement).toMatchObject({ toPayBackCents: 2800, advanceCents: 2000 });
		const { text } = await extractText(
			await getDocumentProxy(await blobs.get(made.receipt.fileCid)),
			{ mergePages: true }
		);
		const flat = text.replace(/\s+/g, ' ');
		expect(flat).toContain('Bereits als Vorschuss gezahlt 28.04.2026 20,00 EUR');
		expect(flat).toContain('Noch auszuzahlen 8,00 EUR');

		// The rest paid out: settled.
		const rest = await s.transactions.put(fresh('2026-06-05', -800));
		await linkPayout(s, String(rest.id), [String(made.statement.id)]);
		const [settled] = statementSettlements({
			travel: await s.travel.list(),
			matches: await s.matches.list(),
			transactions: await s.transactions.list()
		});
		expect(settled).toMatchObject({ advanceCents: 2000, paidCents: 800, openCents: 0 });

		// More advance than costs: a claim, said.
		const big = statementOf({
			travellerId: String(anna.id),
			month: '2026-05',
			travel: await s.travel.list(),
			receipts: [],
			transactions: [
				...(await s.transactions.list()),
				tx('Y', '2026-04-29', -5000, { travellerId: String(anna.id), tripId: String(trip.id) })
			],
			corrects: String(made.statement.id)
		});
		expect(big.totals).toMatchObject({ advanceCents: 7000, toPayOutCents: -4200 });
		expect(big.checks).toContainEqual({ level: 'warning', code: 'advanceExceeds' });
	});
});

import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { suggestBooking } from '../booking/suggest.js';
import {
	isStatementReceipt,
	linkPayout,
	mayPayOut,
	statementChains,
	statementSettlements,
	suggestStatements,
	unlinkPayout
} from './payout.js';
import { openTravelQuestions } from './proposals.js';

// Made-up statements and transfers; no real person or account.

/** @param {string} id @param {string} month @param {number} cents @param {Record<string, any>} [over] */
const statement = (id, month, cents, over = {}) => ({
	id,
	kind: 'statement',
	state: 'closed',
	travellerId: 'P',
	month,
	number: `RK-2026-${id}`,
	closedAt: `${month}-28T10:00:00.000Z`,
	receiptId: `R-${id}`,
	toPayBackCents: cents,
	...over
});
/** @param {string} id @param {string} day @param {number} cents @param {Record<string, any>} [over] */
const tx = (id, day, cents, over = {}) => ({
	id,
	bookedOn: day,
	amountCents: cents,
	currency: 'EUR',
	source: 'hibiscus',
	purpose: '',
	...over
});
const link = (/** @type {string} */ receiptId, /** @type {string} */ transactionId) => ({
	receiptId,
	transactionId,
	state: 'confirmed'
});

describe('paying travel statements out (#213, step 7)', () => {
	it('settles by the links: in parts, several at once, too much; the statement’s own bookings do not count', () => {
		const travel = [statement('001', '2026-05', 11380), statement('002', '2026-06', 5000)];
		const transactions = [
			tx('A', '2026-06-05', -6000),
			tx('B', '2026-06-20', -5380),
			// One transfer for June and a bit too much.
			tx('C', '2026-07-03', -5100),
			// The statement's own line (step 6): not a payout.
			tx('L', '2026-05-31', -11380, { source: 'travel' })
		];
		const matches = [
			link('R-001', 'A'),
			link('R-001', 'B'),
			link('R-002', 'C'),
			link('R-001', 'L')
		];
		const [may, june] = statementSettlements({ travel, matches, transactions });
		expect(may).toMatchObject({ owedCents: 11380, paidCents: 11380, openCents: 0 });
		expect(may.payouts.map((p) => [p.tx.id, p.cents])).toEqual([
			['A', 6000],
			['B', 5380]
		]);
		expect(june).toMatchObject({ paidCents: 5100, openCents: -100 });

		// One transfer for both: the older first.
		const both = statementSettlements({
			travel,
			matches: [link('R-001', 'X'), link('R-002', 'X')],
			transactions: [tx('X', '2026-07-01', -14000)]
		});
		expect(both.map((s) => [s.paidCents, s.openCents])).toEqual([
			[11380, 0],
			[2620, 2380]
		]);
	});

	it('a correction takes over what was paid on the statement it replaces', () => {
		const travel = [
			statement('001', '2026-05', 11380),
			statement('002', '2026-05', 12000, { corrects: '001', closedAt: '2026-06-03T10:00:00.000Z' })
		];
		expect(statementChains(travel).map((c) => c.members.map((s) => s.id))).toEqual([
			['002', '001']
		]);
		const [s] = statementSettlements({
			travel,
			matches: [link('R-001', 'A')],
			transactions: [tx('A', '2026-06-05', -11380)]
		});
		expect(s).toMatchObject({
			head: { id: '002' },
			owedCents: 12000,
			paidCents: 11380,
			openCents: 620
		});
	});

	it('which statements a transfer pays: the number in its purpose, else the amounts', () => {
		const travel = [
			statement('001', '2026-04', 3000),
			statement('002', '2026-05', 11380),
			statement('003', '2026-06', 5000)
		];
		const open = statementSettlements({ travel, matches: [], transactions: [] });
		expect(
			suggestStatements(tx('A', '2026-07-01', -999, { purpose: 'Reisekosten RK-2026-003' }), open)
		).toEqual(['003']);
		expect(suggestStatements(tx('B', '2026-07-01', -8000), open)).toEqual(['001', '003']);
		expect(suggestStatements(tx('C', '2026-07-01', -12000), open)).toEqual(['001', '002']);
		expect(mayPayOut(tx('D', '2026-07-01', -500), [], null)).toBe(true);
		expect(mayPayOut(tx('E', '2026-07-01', 500), [], null)).toBe(false);
		expect(mayPayOut(tx('F', '2026-07-01', -500, { source: 'travel' }), [], null)).toBe(false);
		expect(mayPayOut(tx('G', '2026-07-01', -500), [link('R', 'G')], null)).toBe(false);
	});

	it('linked and let go; booked against the clearing account', async () => {
		const store = {
			transactions: memoryCollection('transactions').collection,
			matches: memoryCollection('matches').collection,
			receipts: memoryCollection('receipts').collection,
			travel: memoryCollection('travel').collection,
			questions: memoryCollection('questions').collection,
			events: memoryCollection('events').collection,
			settings: memoryCollection('settings').collection,
			accounts: memoryCollection('accounts').collection
		};
		const pdf = await store.receipts.put({
			source: 'eigenbeleg',
			status: 'neu',
			amountCents: 11380,
			selfNumber: 'RK-2026-001',
			selfReceipt: { kind: 'travel-statement' }
		});
		const s = await store.travel.put({
			...statement('x', '2026-05', 11380, { receiptId: pdf.id }),
			id: undefined
		});
		const payout = await store.transactions.put({
			...tx('x', '2026-06-05', -11380),
			id: undefined
		});
		await linkPayout(store, payout.id, [s.id]);
		const books = {
			travel: await store.travel.list(),
			matches: await store.matches.list(),
			transactions: await store.transactions.list()
		};
		expect(statementSettlements(books)[0]).toMatchObject({ openCents: 0 });
		expect(isStatementReceipt(pdf)).toBe(true);
		expect(
			suggestBooking(payout, {
				receipts: [pdf],
				privateAccounts: { payment: '1520', repayment: '1520' }
			})
		).toMatchObject({ account: '1520', source: 'travel', taxKey: '' });
		await unlinkPayout(store, payout.id, [s]);
		expect(
			statementSettlements({ ...books, matches: await store.matches.list() })[0].openCents
		).toBe(11380);
		await expect(linkPayout(store, payout.id, ['nope'])).rejects.toThrow();
	});

	it('a statement not paid out is asked about two weeks after it was made', () => {
		const travel = [statement('001', '2026-05', 11380)];
		const books = { travel, receipts: [], matches: [], transactions: [] };
		expect(openTravelQuestions(books, new Date('2026-06-05T00:00:00Z'))).toEqual([]);
		expect(openTravelQuestions(books, new Date('2026-06-12T00:00:00Z'))).toEqual([
			{
				kind: 'statementNotPaidOut',
				statementId: '001',
				number: 'RK-2026-001',
				month: '2026-05',
				openCents: 11380
			}
		]);
	});
});

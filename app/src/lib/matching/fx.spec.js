// The day's rate kept on a payment linked to an invoice in another currency
// (matching/fx.js): only what needs one is asked, each currency and day once,
// a missing rate leaves the gap, and the booking keeps everything else.
// Made-up books.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { fillFx, fxCandidateGaps, fxGaps } from './fx.js';

const books = () => ({
	receipts: [
		{ id: 'R-USD', amountCents: 190_000, currency: 'USD' },
		{ id: 'R-EUR', amountCents: 5_000, currency: 'EUR' },
		{ id: 'R-USD-2', amountCents: 4_000, currency: 'USD' }
	],
	transactions: [
		{ id: 'T1', bookedOn: '2025-05-30', amountCents: 55_800, currency: 'EUR', source: 'monero' },
		{ id: 'T2', bookedOn: '2025-06-30', amountCents: 56_400, currency: 'EUR', source: 'monero' },
		{ id: 'T3', bookedOn: '2025-05-30', amountCents: -5_000, currency: 'EUR' },
		// The bank named the original amount: nothing to ask.
		{
			id: 'T4',
			bookedOn: '2025-01-20',
			amountCents: -3_837,
			currency: 'EUR',
			original: { amount: '40.00', currency: 'USD' }
		},
		// A rate kept already.
		{
			id: 'T5',
			bookedOn: '2025-07-01',
			amountCents: 1_000,
			currency: 'EUR',
			fx: { USD: { rate: '0.9', source: 'ecb', at: '' } }
		}
	],
	matches: [
		{ receiptId: 'R-USD', transactionId: 'T1', state: 'confirmed' },
		{ receiptId: 'R-USD', transactionId: 'T2', state: 'auto' },
		{ receiptId: 'R-EUR', transactionId: 'T3', state: 'confirmed' },
		{ receiptId: 'R-USD-2', transactionId: 'T4', state: 'confirmed' },
		{ receiptId: 'R-USD', transactionId: 'T5', state: 'confirmed' },
		{ receiptId: 'R-USD', transactionId: 'T3', state: 'rejected' }
	]
});

describe('fxGaps', () => {
	it('names only linked euro payments of invoices in another currency, without an original or a rate', () => {
		const gaps = fxGaps(books());
		expect(gaps.map((g) => [g.tx.id, g.currency, g.day])).toEqual([
			['T1', 'USD', '2025-05-30'],
			['T2', 'USD', '2025-06-30']
		]);
	});
});

describe('fillFx', () => {
	it('asks each currency and day once, keeps the rate, and leaves the rest of the booking', async () => {
		const { collection } = memoryCollection('transactions');
		const b = books();
		/** @type {Record<string, any>} */
		const stored = {};
		for (const { id, ...t } of b.transactions) {
			stored[id] = await collection.put({ ...t, purpose: 'Memo: XMR' });
		}
		const withIds = {
			...b,
			transactions: Object.values(stored),
			matches: b.matches.map((m) => ({ ...m, transactionId: stored[m.transactionId].id }))
		};
		/** @type {string[]} */
		const asked = [];
		const client = {
			rate: async (/** @type {string} */ asset, /** @type {string} */ date) => {
				asked.push(`${asset} ${date}`);
				if (date === '2025-06-30') return null;
				return {
					asset,
					date,
					currency: 'EUR',
					rate: '0.881',
					usdRate: '1',
					source: 'ecb',
					at: '2025-05-30T00:00:00Z'
				};
			}
		};
		const gaps = fxGaps(withIds);
		const filled = await fillFx({ client, transactions: collection, gaps });
		expect(filled).toBe(1);
		expect(asked).toEqual(['USD 2025-05-30', 'USD 2025-06-30']);
		const [t1] = await collection.list({ where: (r) => r.id === stored.T1.id });
		expect(t1.fx).toEqual({ USD: { rate: '0.881', source: 'ecb', at: '2025-05-30T00:00:00Z' } });
		expect(t1.purpose).toBe('Memo: XMR');
		// The day without a rate stays a gap, asked again next time.
		const again = fxGaps({ ...withIds, transactions: await collection.list() });
		expect(again.map((g) => g.day)).toEqual(['2025-06-30']);
	});
});

describe('rates for candidates (#474)', () => {
	const candidates = () => ({
		receipts: [
			{
				id: 'R-OPEN',
				currency: 'USD',
				amountCents: 8_700,
				documentDate: '2026-03-02',
				extraction: { currency: 'USD', gross: 87, vendor: 'Example Cloud Ltd' }
			},
			// Linked already: its own gaps are fxGaps'.
			{
				id: 'R-LINKED',
				currency: 'USD',
				amountCents: 1_000,
				documentDate: '2026-03-02',
				extraction: { currency: 'USD', gross: 10 }
			},
			// Crypto: evidence in the receipt, not a rate.
			{
				id: 'R-XMR',
				currency: 'XMR',
				amountCents: 200,
				documentDate: '2026-03-02',
				extraction: { currency: 'XMR', gross: 2 }
			}
		],
		transactions: [
			{ id: 'T-NEAR', bookedOn: '2026-03-04', amountCents: -8_032, currency: 'EUR' },
			{ id: 'T-FAR', bookedOn: '2026-03-05', amountCents: -2_500, currency: 'EUR' },
			// Outside the receipt's window (−5 … +10 days).
			{ id: 'T-LATE', bookedOn: '2026-04-30', amountCents: -8_032, currency: 'EUR' },
			{ id: 'T-LINKED', bookedOn: '2026-03-04', amountCents: -920, currency: 'EUR' },
			{
				id: 'T-ORIGINAL',
				bookedOn: '2026-03-04',
				amountCents: -8_000,
				currency: 'EUR',
				original: { amount: '87.00', currency: 'USD' }
			}
		],
		matches: [{ receiptId: 'R-LINKED', transactionId: 'T-LINKED', state: 'auto' }]
	});

	it('names euro bookings in the window of an open receipt in another currency', () => {
		const gaps = fxCandidateGaps(candidates());
		expect(gaps.map((g) => [g.tx.id, g.currency, g.near])).toEqual([
			['T-NEAR', 'USD', [8_700]],
			['T-FAR', 'USD', [8_700]]
		]);
	});

	it('keeps the rate only where the amount comes near, and asks each day once', async () => {
		const { collection } = memoryCollection('transactions');
		const b = candidates();
		/** @type {Record<string, any>} */
		const stored = {};
		for (const { id, ...t } of b.transactions) stored[id] = await collection.put(t);
		const gaps = fxCandidateGaps({
			...b,
			transactions: Object.values(stored),
			matches: b.matches.map((m) => ({ ...m, transactionId: stored[m.transactionId].id }))
		}).filter((g) => g.currency === 'USD');
		/** @type {string[]} */
		const asked = [];
		const client = {
			rate: async (/** @type {string} */ asset, /** @type {string} */ date) => {
				asked.push(`${asset} ${date}`);
				return { asset, date, rate: '0.92', source: 'ecb', at: `${date}T00:00:00Z` };
			}
		};
		expect(await fillFx({ client, transactions: collection, gaps })).toBe(1);
		const all = await collection.list();
		const near = all.find((t) => t.id === stored['T-NEAR'].id);
		const far = all.find((t) => t.id === stored['T-FAR'].id);
		expect(near?.fx).toEqual({ USD: { rate: '0.92', source: 'ecb', at: '2026-03-04T00:00:00Z' } });
		expect(far?.fx).toBeUndefined();
		// A day asked once is not asked again on the next run.
		await fillFx({ client, transactions: collection, gaps });
		expect(asked.filter((a) => a === 'USD 2026-03-05')).toHaveLength(1);
	});
});

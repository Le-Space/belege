import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { addSample, hasSample, isSample, removeSample, sampleBooks } from './sample.js';

function memoryStore() {
	/** @type {Record<string, any>} */
	const store = {};
	for (const name of ['accounts', 'transactions', 'receipts', 'matches', 'questions', 'events']) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
	return /** @type {any} */ (store);
}
/**
 * @param {any} store
 * @returns {Promise<{ accounts: Record<string, any>[], transactions: Record<string, any>[], receipts: Record<string, any>[] }>}
 */
const books = async (store) => ({
	accounts: await store.accounts.list(),
	transactions: await store.transactions.list(),
	receipts: await store.receipts.list()
});

describe('sample books (#200, step 3)', () => {
	it('bank, a second account, an exchange and a wallet, in the month before today', async () => {
		const store = memoryStore();
		expect(await addSample(store, '2026-03-15')).toEqual({
			accounts: 4,
			transactions: 12,
			receipts: 2
		});
		const b = await books(store);
		expect(b.accounts.map((a) => a.source).sort()).toEqual(['camt', 'camt', 'ethereum', 'kraken']);
		expect(b.transactions.every((t) => String(t.bookedOn).startsWith('2026-02-'))).toBe(true);
		expect(b.accounts.every((a) => a.ledgerAccount)).toBe(true);
		// A crypto booking carries its quantity and a rate: 0.1 ETH at 2500 is 250 euros.
		const arrival = b.transactions.find((t) => t.sourceId === 'sample-10');
		expect(arrival).toMatchObject({
			amountCents: 250_00,
			asset: 'ETH',
			quantity: '100000000000000000'
		});
		expect(hasSample(b)).toBe(true);
	});

	it('every record is marked, and nothing real-looking is in it', async () => {
		const store = memoryStore();
		await addSample(store, '2026-03-15');
		const b = await books(store);
		for (const r of [...b.accounts, ...b.transactions, ...b.receipts])
			expect(isSample(r)).toBe(true);
		// IBANs with check digits 00, an address and hashes of one repeated byte.
		for (const t of b.transactions) {
			if (t.counterpartyIban) expect(t.counterpartyIban).toMatch(/^DE00/);
			if (t.counterpartyAddress) expect(t.counterpartyAddress).toMatch(/^0x(b0){20}$/);
		}
		for (const r of b.receipts) expect(r.excerpt).toMatch(/^BEISPIEL/);
	});

	it('January looks back into December', () => {
		const { accounts } = sampleBooks('2026-01-10');
		expect(accounts[0].incoming[0].date).toBe('2025-12-03');
	});

	it('adding twice adds nothing twice', async () => {
		const store = memoryStore();
		await addSample(store, '2026-03-15');
		await addSample(store, '2026-03-15');
		const b = await books(store);
		expect([b.accounts.length, b.transactions.length]).toEqual([4, 12]);
	});

	it('removing takes out every marked record, its matches and questions, and nothing else', async () => {
		const store = memoryStore();
		const own = await store.transactions.put({ bookedOn: '2026-02-01', amountCents: -100 });
		await addSample(store, '2026-03-15');
		const [sampleTx] = await store.transactions.list({ where: isSample });
		const [sampleReceipt] = await store.receipts.list({ where: isSample });
		await store.matches.put({
			receiptId: sampleReceipt.id,
			transactionId: sampleTx.id,
			state: 'auto'
		});
		await store.questions.put({ kind: 'missing-receipt', transactionId: sampleTx.id });
		const keep = await store.questions.put({ kind: 'missing-receipt', transactionId: own.id });

		expect(await removeSample(store)).toBe(18);
		const b = await books(store);
		expect(hasSample(b)).toBe(false);
		expect(b.transactions.map((t) => t.id)).toEqual([own.id]);
		expect(b.accounts).toEqual([]);
		expect(await store.matches.list()).toEqual([]);
		expect((await store.questions.list()).map((/** @type {any} */ q) => q.id)).toEqual([keep.id]);
	});
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { importCamtStatements, importTransactions } from './import.js';
import { parseCamt053 } from './camt.js';
import { syncHibiscus } from './hibiscus-sync.js';
import { memoryCollection } from './test-support.js';

const ACCOUNT = {
	id: '01J0000000000000000000ACCT',
	source: /** @type {const} */ ('hibiscus'),
	fingerprintAccount: 'hibiscus:1'
};

/** @param {Partial<import('./import.js').IncomingTransaction>} over */
const tx = (over = {}) => ({
	sourceId: '101',
	date: '2026-09-22',
	valueDate: '2026-09-22',
	amountCents: -2242,
	currency: 'EUR',
	counterpartyName: 'Nordlicht GmbH',
	counterpartyIban: 'DE00000000000000001234',
	purpose: 'Rechnung KR-1',
	endToEndId: 'KR1',
	bookingType: 'Basislastschrift',
	...over
});

describe('importTransactions', () => {
	it('keeps what moved in a crypto transaction, and a new rate updates it', async () => {
		const { collection } = memoryCollection('transactions');
		const crypto = (/** @type {string} */ rate, /** @type {number} */ amountCents) =>
			tx({
				sourceId: 'L-1',
				amountCents,
				counterpartyName: 'Konto B',
				purpose: 'Auszahlung',
				movement: 'transfer',
				txRef: '00ab',
				crypto: {
					asset: 'BTC',
					quantity: '-1500000',
					decimals: 8,
					valuation: { rate, currency: 'EUR', source: 'coingecko', at: '2026-09-22T00:00:00Z' }
				}
			});

		await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [crypto('60000', -90000)]
		});
		const [stored] = await collection.list();
		expect(stored).toMatchObject({
			amountCents: -90000,
			currency: 'EUR',
			asset: 'BTC',
			quantity: '-1500000',
			decimals: 8,
			movement: 'transfer',
			txRef: '00ab',
			valuation: { rate: '60000', source: 'coingecko' }
		});

		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [crypto('60000', -90000)]
			})
		).toEqual({ new: 0, updated: 0, skipped: 1 });
		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [crypto('61000', -91500)]
			})
		).toEqual({ new: 0, updated: 1, skipped: 0 });
		const [after] = await collection.list();
		expect(after.valuation.rate).toBe('61000');
		expect(after.amountCents).toBe(-91500);

		// The store hands the valuation back with its keys sorted (dag-cbor): no change.
		const { valuation } = after;
		await collection.put({
			...after,
			valuation: {
				at: valuation.at,
				rate: valuation.rate,
				source: valuation.source,
				currency: valuation.currency
			}
		});
		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [crypto('61000', -91500)]
			})
		).toEqual({ new: 0, updated: 0, skipped: 1 });
	});

	it('leaves bank transactions without crypto fields', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({ transactions: collection, account: ACCOUNT, incoming: [tx()] });
		const [stored] = await collection.list();
		expect(stored).not.toHaveProperty('quantity');
		expect(stored).not.toHaveProperty('valuation');
	});

	it('creates, then skips on a second run, and keeps cents', async () => {
		const { collection } = memoryCollection('transactions');
		const incoming = [
			tx(),
			tx({ sourceId: '102', amountCents: 143976, counterpartyName: 'Kundin AG' })
		];

		expect(
			await importTransactions({ transactions: collection, account: ACCOUNT, incoming })
		).toEqual({ new: 2, updated: 0, skipped: 0 });
		expect(
			await importTransactions({ transactions: collection, account: ACCOUNT, incoming })
		).toEqual({ new: 0, updated: 0, skipped: 2 });

		const stored = await collection.list();
		expect(stored).toHaveLength(2);
		expect(stored.map((r) => r.amountCents).sort()).toEqual([-2242, 143976]);
		expect(stored[0]).toMatchObject({
			source: 'hibiscus',
			accountId: ACCOUNT.id,
			bookedOn: '2026-09-22'
		});
		expect(stored.every((r) => /^fp1:/.test(r.fingerprint))).toBe(true);
	});

	it('updates a changed booking in place, keeping fields it does not own', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({ transactions: collection, account: ACCOUNT, incoming: [tx()] });
		const [first] = await collection.list();
		await collection.put({ ...first, receiptId: 'R-1' });

		const counts = await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ valueDate: '2026-09-23' })]
		});
		expect(counts).toEqual({ new: 0, updated: 1, skipped: 0 });
		const [after] = await collection.list();
		expect(after.id).toBe(first.id);
		expect(after.valueDate).toBe('2026-09-23');
		expect(after.receiptId).toBe('R-1');
	});

	it('without a sourceId, the fingerprint dedups, and identical twins stay two', async () => {
		const { collection } = memoryCollection('transactions');
		const coffee = tx({
			sourceId: null,
			amountCents: -350,
			purpose: 'Kaffee',
			counterpartyName: 'Café Test'
		});
		const incoming = [coffee, { ...coffee }, tx({ sourceId: null })];

		expect(
			await importTransactions({ transactions: collection, account: ACCOUNT, incoming })
		).toEqual({ new: 3, updated: 0, skipped: 0 });
		expect(
			await importTransactions({ transactions: collection, account: ACCOUNT, incoming })
		).toEqual({ new: 0, updated: 0, skipped: 3 });
		expect(await collection.list()).toHaveLength(3);
	});

	it('the fingerprint fills in a sourceId that arrives later, but never merges two different ids', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ sourceId: null })]
		});
		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [tx({ sourceId: '555' })]
			})
		).toEqual({ new: 0, updated: 1, skipped: 0 });
		expect((await collection.list())[0].sourceId).toBe('555');

		// Same facts, different Hibiscus id: two bookings.
		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [tx({ sourceId: '555' }), tx({ sourceId: '556' })]
			})
		).toEqual({ new: 1, updated: 0, skipped: 1 });
		expect(await collection.list()).toHaveLength(2);
	});

	it('a soft-deleted booking does not come back', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({ transactions: collection, account: ACCOUNT, incoming: [tx()] });
		const [record] = await collection.list();
		await collection.softDelete(record.id);
		expect(
			await importTransactions({
				transactions: collection,
				account: ACCOUNT,
				incoming: [tx({ valueDate: '2026-09-30' })]
			})
		).toEqual({ new: 0, updated: 0, skipped: 1 });
		expect(await collection.list()).toHaveLength(0);
	});

	it('other accounts are separate: the same sourceId there is another booking', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({ transactions: collection, account: ACCOUNT, incoming: [tx()] });
		const other = {
			...ACCOUNT,
			id: '01J0000000000000000000OTHR',
			fingerprintAccount: 'hibiscus:9'
		};
		expect(
			await importTransactions({ transactions: collection, account: other, incoming: [tx()] })
		).toEqual({ new: 1, updated: 0, skipped: 0 });
	});
});

describe('importCamtStatements', () => {
	const statements = (/** @type {string} */ name) =>
		parseCamt053(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'), {
			DOMParser: /** @type {any} */ (DOMParser)
		});

	it('creates the account from the statement IBAN (last 4 only) and imports once', async () => {
		const accounts = memoryCollection('accounts');
		const transactions = memoryCollection('transactions');
		const store = { accounts: accounts.collection, transactions: transactions.collection };

		const [first] = await importCamtStatements(store, statements('camt053-german-bank.xml'));
		expect(first.counts).toEqual({ new: 4, updated: 0, skipped: 0 });
		expect(first.account).toMatchObject({
			source: 'camt',
			ibanLast4: '2222',
			name: 'Testbank eG',
			currency: 'EUR'
		});
		expect(JSON.stringify([...accounts.docs.values()])).not.toContain('DE00000000000000002222');

		const [again] = await importCamtStatements(store, statements('camt053-german-bank.xml'));
		expect(again.counts).toEqual({ new: 0, updated: 0, skipped: 4 });
		expect(again.account.id).toBe(first.account.id);

		const [revolut] = await importCamtStatements(store, statements('camt053-revolut.xml'));
		expect(revolut.counts).toEqual({ new: 2, updated: 0, skipped: 0 });
		expect(revolut.pending).toBe(1);
		expect(await accounts.collection.list()).toHaveLength(2);
		expect(await transactions.collection.list()).toHaveLength(6);
	});
});

describe('syncHibiscus', () => {
	it('90 days on the first run, from the last sync minus a week after that; no duplicates', async () => {
		const accounts = memoryCollection('accounts');
		const transactions = memoryCollection('transactions');
		const store = { accounts: accounts.collection, transactions: transactions.collection };
		/** @type {[string, string][]} */
		const asked = [];
		const client = /** @type {any} */ ({
			transactions: async (/** @type {string} */ id, /** @type {string} */ since) => {
				asked.push([id, since]);
				return [tx({ fingerprint: 'fp1:' + 'a'.repeat(64) })];
			}
		});
		const bridgeAccount = {
			id: '1',
			ibanMasked: 'DE00 **** 4711',
			ibanLast4: '4711',
			name: 'Geschäft',
			currency: 'EUR',
			balanceCents: 0,
			balanceDate: null
		};

		const first = await syncHibiscus({
			client,
			store,
			accounts: [bridgeAccount],
			now: new Date('2026-09-24T12:00:00Z')
		});
		expect(first.totals).toEqual({ new: 1, updated: 0, skipped: 0 });
		const second = await syncHibiscus({
			client,
			store,
			accounts: [bridgeAccount],
			now: new Date('2026-09-25T12:00:00Z')
		});
		expect(second.totals).toEqual({ new: 0, updated: 0, skipped: 1 });

		expect(asked).toEqual([
			['1', '2026-06-26'],
			['1', '2026-09-17']
		]);
		const [account] = await accounts.collection.list();
		expect(account).toMatchObject({
			source: 'hibiscus',
			sourceAccountId: '1',
			ibanLast4: '4711',
			lastSyncedOn: '2026-09-25',
			importEnabled: true
		});
		expect(await transactions.collection.list()).toHaveLength(1);
	});
});

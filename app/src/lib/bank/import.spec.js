import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { importCamtStatements, importTransactions, movedDifferently } from './import.js';
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

	it('keeps the booking time when the source gives one, and a later sync adds it', async () => {
		const { collection } = memoryCollection('transactions');
		await importTransactions({ transactions: collection, account: ACCOUNT, incoming: [tx()] });
		const [before] = await collection.list();
		expect(before.bookedAt).toBeUndefined();

		const counts = await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ bookedAt: '2026-09-22T14:32:05Z' })]
		});
		expect(counts).toEqual({ new: 0, updated: 1, skipped: 0 });
		const [after] = await collection.list();
		expect(after.id).toBe(before.id);
		expect(after.bookedAt).toBe('2026-09-22T14:32:05Z');

		// Not a time with an offset: not kept.
		await importTransactions({
			transactions: collection,
			account: { ...ACCOUNT, id: 'OTHER' },
			incoming: [tx({ sourceId: '102', bookedAt: '2026-09-22 14:32' })]
		});
		const other = (await collection.list()).find((r) => r.sourceId === '102');
		expect(other?.bookedAt).toBeUndefined();
	});

	it('an income that comes back as an expense: confirmation dropped, marked, one event', async () => {
		const { collection } = memoryCollection('transactions');
		const events = memoryCollection('events').collection;
		const at = () => new Date('2026-09-26T12:00:00Z');
		await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ amountCents: 4912 })]
		});
		const [first] = await collection.list();
		await collection.put({
			...first,
			receiptId: 'R-1',
			booking: { account: '8400', taxKey: '', confirmedAt: '2026-09-01T00:00:00Z' }
		});

		const counts = await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ amountCents: -4912 })],
			events,
			now: at
		});
		expect(counts).toEqual({ new: 0, updated: 1, skipped: 0 });
		const [after] = await collection.list();
		expect(after.id).toBe(first.id);
		expect(after.amountCents).toBe(-4912);
		expect(after.booking).toEqual({ account: '8400', taxKey: '', confirmedAt: null });
		expect(after.receiptId).toBe('R-1');
		expect(after.importChange).toEqual({
			at: '2026-09-26T12:00:00.000Z',
			fromCents: 4912,
			toCents: -4912,
			signFlipped: true
		});
		const [event] = await events.list();
		expect(event).toMatchObject({
			kind: 'booking-changed',
			transactionId: first.id,
			fromCents: 4912,
			toCents: -4912,
			signFlipped: true,
			unconfirmed: true,
			withReceipt: true
		});

		// A second change keeps the first "before".
		await importTransactions({
			transactions: collection,
			account: ACCOUNT,
			incoming: [tx({ amountCents: -5000 })],
			events,
			now: at
		});
		const [again] = await collection.list();
		expect(again.importChange).toMatchObject({ fromCents: 4912, toCents: -5000 });
		expect(await events.list()).toHaveLength(2);
	});

	it('what counts as changed: direction, a euro amount, a quantity – not a new rate', () => {
		expect(movedDifferently({ amountCents: 100 }, { amountCents: -100 })).toBe(true);
		expect(movedDifferently({ amountCents: -100 }, { amountCents: -120 })).toBe(true);
		expect(movedDifferently({ amountCents: -100 }, { amountCents: -100 })).toBe(false);
		// Crypto: the same quantity at another rate is no change; another quantity is.
		expect(
			movedDifferently({ amountCents: -100, quantity: '-5' }, { amountCents: -130, quantity: '-5' })
		).toBe(false);
		expect(
			movedDifferently({ amountCents: -100, quantity: '-5' }, { amountCents: -100, quantity: '-6' })
		).toBe(true);
		// Dust valued at 0 cents, then at 1: the same movement.
		expect(
			movedDifferently({ amountCents: 0, quantity: '5' }, { amountCents: 1, quantity: '5' })
		).toBe(false);
		expect(
			movedDifferently({ amountCents: 1, quantity: '5' }, { amountCents: -1, quantity: '-5' })
		).toBe(true);
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

describe('a CAMT statement from Wise (#218)', () => {
	const wise = (/** @type {(xml: string) => string} */ change = (x) => x) =>
		parseCamt053(
			change(readFileSync(new URL('./fixtures/camt053-wise.xml', import.meta.url), 'utf8')),
			{ DOMParser: /** @type {any} */ (DOMParser) }
		);
	const store = () => ({
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection
	});

	it('an account without an IBAN: the id’s last four, never the id itself; a re-import adds nothing', async () => {
		const s = store();
		const [first] = await importCamtStatements(s, wise());
		expect(first.counts).toEqual({ new: 5, updated: 0, skipped: 0 });
		expect(first.account).toMatchObject({
			source: 'camt',
			ibanLast4: '0042',
			name: 'Wise Example SA EUR',
			currency: 'EUR'
		});
		expect(JSON.stringify(first.account)).not.toContain('10000042');
		const [again] = await importCamtStatements(s, wise());
		expect(again.counts).toEqual({ new: 0, updated: 0, skipped: 5 });
		expect(again.account.id).toBe(first.account.id);
	});

	it('the fee and its payment share a reference; the original currency is kept', async () => {
		const s = store();
		await importCamtStatements(s, wise());
		const all = await s.transactions.list();
		const card = all.find((t) => t.sourceId === 'CARD-2000001');
		const fee = all.find((t) => t.sourceId === 'FEE-CARD-2000001');
		expect(card).toMatchObject({
			counterparty: 'Example Cloud Shop',
			txRef: 'CARD-2000001',
			original: { amount: '12.35', currency: 'USD', rate: '1.07391' }
		});
		expect(fee).toMatchObject({ bookingType: 'FEE', txRef: 'CARD-2000001' });
		expect(card?.movement).toBeUndefined();
	});

	it('a statement in dollars: an account of its own, each booking in euros at the day’s rate', async () => {
		const s = store();
		const usd = () =>
			wise((xml) =>
				xml.replaceAll('Ccy="EUR"', 'Ccy="USD"').replace('<Ccy>EUR</Ccy>', '<Ccy>USD</Ccy>')
			);
		/** @type {string[]} */
		const asked = [];
		const getRate = async (/** @type {string} */ asset, /** @type {string} */ date) => {
			asked.push(`${asset} ${date}`);
			return /** @type {any} */ ({ rate: '0.90', source: 'ecb', at: `${date}T00:00:00Z` });
		};
		const [eur] = await importCamtStatements(s, wise());
		const [dollars] = await importCamtStatements(s, usd(), { getRate });
		expect(dollars.account.id).not.toBe(eur.account.id);
		expect(dollars.account).toMatchObject({
			name: 'Wise Example SA USD',
			asset: 'USD',
			decimals: 2
		});
		const topUp = (await s.transactions.list()).find(
			(t) => t.accountId === dollars.account.id && t.sourceId === 'TRANSFER-1000001'
		);
		// 200.00 USD at 0.90 EUR: 180 euros, the dollars kept as the quantity.
		expect(topUp).toMatchObject({
			amountCents: 180_00,
			currency: 'EUR',
			asset: 'USD',
			quantity: '20000',
			decimals: 2,
			valuation: { rate: '0.90', source: 'ecb' },
			rateMissing: null
		});
		// One question per day, not per booking.
		expect(asked).toEqual(['USD 2026-01-05', 'USD 2026-01-07', 'USD 2026-01-12', 'USD 2026-01-31']);
	});

	it('without a rate the dollars are kept and the euros stay open; a later import fills them in', async () => {
		const s = store();
		const usd = () =>
			wise((xml) =>
				xml.replaceAll('Ccy="EUR"', 'Ccy="USD"').replace('<Ccy>EUR</Ccy>', '<Ccy>USD</Ccy>')
			);
		const [first] = await importCamtStatements(s, usd());
		const open = (await s.transactions.list()).find((t) => t.sourceId === 'CARD-2000002');
		expect(open).toMatchObject({ amountCents: 0, asset: 'USD', quantity: '-2400' });
		expect(open?.rateMissing?.reason).toMatch(/USD/);
		const getRate = async () =>
			/** @type {any} */ ({ rate: '0.90', source: 'ecb', at: '2026-01-12T00:00:00Z' });
		const [again] = await importCamtStatements(s, usd(), { getRate });
		expect(again.account.id).toBe(first.account.id);
		expect(again.counts.new).toBe(0);
		const priced = (await s.transactions.list()).find((t) => t.sourceId === 'CARD-2000002');
		expect(priced).toMatchObject({ amountCents: -21_60, rateMissing: null });
	});
});

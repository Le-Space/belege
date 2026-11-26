// The consumption Eigenbelege of a month's close (#1034). Every address,
// amount and name is made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { createAlephStatement, findStatement } from '../aleph/aleph.js';
import { consumptionReceipt, consumptionSources, planConsumption } from './consumption.js';
import { makeConsumption, readConsumption } from './consumption-run.js';
import { planMonth } from './plan.js';

const A = '0x' + '1a'.repeat(20);
const B = '0x' + '2b'.repeat(20);
const F = 'f410f' + 'a'.repeat(39);
const MONTH = '2026-08';
const TODAY = '2026-09-03';
const VM = 'ab'.repeat(32);
const ACC = '01JB000000000000000000ACC1';
const TX = '01JB000000000000000000TX01';
const TX2 = '01JB000000000000000000TX02';

/** @type {any} */
let store;
/** @type {import('../receipts/blob-store.js').BlobStore} */
let blobs;

beforeEach(async () => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events',
		'partners'
	])
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
});

/** @returns {import('../bridge/client.js').AlephStatement} */
function alephMonth(overrides = {}) {
	return {
		address: A,
		month: MONTH,
		from: '2026-08-01T00:00:00.000Z',
		until: '2026-08-31T23:59:59.000Z',
		opening: 1_000_000,
		closing: 950_000,
		topUps: [],
		transfersOut: [],
		usage: [
			{
				date: '2026-08-01',
				kind: 'execution',
				resource: VM,
				credits: 50_000,
				entries: 24,
				resources: 0,
				sizeMib: null,
				usdPerCredit: '0.000001',
				priceSource: 'purchase',
				eurPerUsd: '0.9',
				eurCents: 5
			}
		],
		resources: { [VM]: { type: 'INSTANCE', name: 'test-relay' } },
		totals: { topUps: 0, transfersOut: 0, usage: 50_000, eurCents: 5 },
		difference: 0,
		rateSource: 'ecb',
		entries: 24,
		...overrides
	};
}

const wallet = { id: 'w1', chain: 'ethereum', address: A, name: 'Hosting' };
const ethAccount = {
	id: ACC,
	kind: 'wallet',
	source: 'ethereum',
	walletAddress: A,
	asset: 'ETH',
	balance: '0.5',
	decimals: 18
};
const purchase = {
	id: TX,
	accountId: ACC,
	bookedOn: '2026-08-10',
	amountCents: -1234,
	quantity: '-500000000000000000',
	asset: 'ETH',
	decimals: 18,
	booking: { account: '4960', taxKey: '', confirmedAt: '2026-08-11T00:00:00Z' }
};
const classifications = {
	[TX]: { kind: 'prepaid-topup', vendor: 'Aleph Cloud', via: 'aleph-purchase', address: A },
	[TX2]: { kind: 'prepaid-topup', vendor: 'Aleph Cloud', via: 'aleph-purchase', address: A }
};
// What the wallet got before: with the purchase, its balance is what is booked.
const funding = {
	id: '01JB000000000000000000TX00',
	accountId: ACC,
	bookedOn: '2026-07-01',
	amountCents: 2468,
	quantity: '1000000000000000000',
	asset: 'ETH',
	decimals: 18
};

const sources = consumptionSources({
	aleph: { accounts: [{ address: A }], extra: [B] },
	filecoinPay: { accounts: [{ address: F }] },
	wallets: [wallet, { id: 'w2', chain: 'akash', address: 'akash1example', name: 'Compute' }]
});

describe('which accounts get a consumption Eigenbeleg', () => {
	it('the Aleph accounts, Filecoin Pay payers and Akash wallets, each once', () => {
		expect(sources.map((s) => [s.chain, s.address, s.name])).toEqual([
			['aleph', A, 'Hosting'],
			['aleph', B, ''],
			['filecoin-pay', F, ''],
			['akash', 'akash1example', 'Compute']
		]);
	});

	it('made now for a month that is over, never for the running one', () => {
		const p = {
			month: MONTH,
			sources: sources.slice(0, 1),
			accounts: [ethAccount],
			transactions: [funding, purchase],
			receipts: [],
			matches: [],
			classifications
		};
		const [item] = planConsumption({ ...p, today: TODAY });
		expect(item.status).toBe('create');
		expect(item.bookings.map((t) => t.id)).toEqual([TX]);
		expect(planConsumption({ ...p, today: '2026-08-31' })[0].status).toBe('open');
	});

	it('not while the wallet’s balance differs from its bookings', () => {
		const [item] = planConsumption({
			month: MONTH,
			today: TODAY,
			sources: sources.slice(0, 1),
			accounts: [{ ...ethAccount, balance: '0.7' }],
			transactions: [funding, purchase],
			receipts: [],
			matches: [],
			classifications
		});
		expect(item.status).toBe('gap');
		expect(item.gaps.map((a) => a.id)).toEqual([ACC]);
	});

	it('a booking with an invoice of its own keeps it', () => {
		const [item] = planConsumption({
			month: MONTH,
			today: TODAY,
			sources: sources.slice(0, 1),
			accounts: [ethAccount],
			transactions: [funding, purchase],
			receipts: [{ id: 'inv' }],
			matches: [{ id: 'm', receiptId: 'inv', transactionId: TX, state: 'confirmed' }],
			classifications
		});
		expect(item.bookings).toEqual([]);
	});
});

describe('made at the export', () => {
	const client = {
		alephStatement: async () => alephMonth(),
		filecoinPayStatement: async () => {
			throw new Error('not asked');
		},
		akashDeployments: async () => ({ deployments: [] }),
		rate: async () => null
	};
	const now = () => new Date('2026-09-03T08:00:00Z');

	async function books() {
		await store.accounts.put(ethAccount);
		await store.transactions.put(funding);
		await store.transactions.put(purchase);
	}
	async function plan() {
		return planConsumption({
			month: MONTH,
			today: TODAY,
			sources: sources.slice(0, 1),
			accounts: await store.accounts.list(),
			transactions: await store.transactions.list(),
			receipts: await store.receipts.list({ includeDeleted: true }),
			matches: await store.matches.list(),
			classifications
		});
	}

	it('makes the card’s document, links the top-up, and a second export reuses it', async () => {
		await books();
		const [item] = await plan();
		const read = await readConsumption({ store, client, source: item.source, month: MONTH, now });
		expect(read).toMatchObject({ due: true, usage: 1, eurCents: 5, complete: true });
		const first = await makeConsumption({ store, blobs, client, item, month: MONTH, read, now });
		expect(first).toEqual({ made: 'created', number: 'EB-2026-001', linked: 1 });

		const receipts = await store.receipts.list();
		expect(receipts).toHaveLength(1);
		expect(receipts[0]).toMatchObject({
			source: 'eigenbeleg',
			selfNumber: 'EB-2026-001',
			selfReceipt: { kind: 'aleph-statement', consumption: { bookings: [TX] } }
		});
		expect(consumptionReceipt(receipts[0])).toEqual({ chain: 'aleph', month: MONTH });
		const matches = await store.matches.list();
		expect(matches).toMatchObject([
			{ receiptId: receipts[0].id, transactionId: TX, state: 'confirmed' }
		]);

		const [again] = await plan();
		expect(again.status).toBe('reuse');
		expect(again.toLink).toEqual([]);
		expect(await makeConsumption({ store, blobs, client, item: again, month: MONTH, now })).toEqual(
			{
				made: 'reused',
				number: 'EB-2026-001',
				linked: 0
			}
		);
		expect(await store.receipts.list()).toHaveLength(1);

		// The card's button finds it: the same document, the same number.
		await expect(
			createAlephStatement({ store, blobs, client, address: A, month: MONTH, now })
		).rejects.toThrow(/EB-2026-001/);
	});

	it('reuses a document the card made first and links it', async () => {
		await books();
		const card = await createAlephStatement({
			store,
			blobs,
			client,
			address: A,
			month: MONTH,
			now
		});
		const [item] = await plan();
		expect(item.status).toBe('reuse');
		expect(item.existing?.id).toBe(card.receipt.id);
		const r = await makeConsumption({ store, blobs, client, item, month: MONTH, now });
		expect(r).toEqual({ made: 'reused', number: card.number, linked: 1 });
		expect(findStatement(await store.receipts.list(), A, MONTH)?.selfReceipt.consumption).toEqual({
			bookings: [TX],
			linkedAt: '2026-09-03T08:00:00.000Z'
		});
	});

	it('a month without consumption gets none', async () => {
		await books();
		const [item] = await plan();
		const quiet = { ...client, alephStatement: async () => alephMonth({ usage: [] }) };
		expect(await makeConsumption({ store, blobs, client: quiet, item, month: MONTH, now })).toEqual(
			{
				made: 'none',
				number: null,
				linked: 0
			}
		);
		expect(await store.receipts.list()).toEqual([]);
	});

	it('says when the month’s top-ups changed after it was made, and changes nothing', async () => {
		await books();
		const [item] = await plan();
		await makeConsumption({ store, blobs, client, item, month: MONTH, now });
		await store.transactions.put({ ...purchase, id: TX2, bookedOn: '2026-08-20' });
		const [later] = await plan();
		expect(later.status).toBe('changed');
	});

	it('goes into the month’s ZIP with an export number, also without a booking that carries it', async () => {
		await books();
		const [item] = await plan();
		// A month of pure usage: no top-up to link to.
		await makeConsumption({
			store,
			blobs,
			client,
			item: { ...item, bookings: [], toLink: [] },
			month: MONTH,
			now
		});
		const receipts = await store.receipts.list();
		const month = planMonth({
			month: MONTH,
			transactions: [funding, purchase],
			accounts: [{ ...ethAccount, ledgerAccount: '1201' }],
			receipts,
			matches: [],
			classifications
		});
		expect(month.receipts.map((r) => r.selfNumber)).toEqual(['EB-2026-001']);
		expect(month.newNumbers).toEqual([{ receiptId: receipts[0].id, number: '2026-08-001' }]);
		expect(month.checks.unlinkedReceipts).toEqual([]);
	});
});

// Akash: what an archive node adds to an indexed history (#1029) – the
// rewards and refunds the indexer had no amount for, the tokens back from an
// unbonding (no transaction) – and that nothing is booked twice. The
// bridge's answers are written out here; every address, hash and amount is
// made up.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { addWallet, syncWallet } from './wallet-sync.js';

const W = 'akash1wolkenfabrikwallet00000000000000000000';
const H = 'A'.repeat(64);
const DIST = 'akash1distribution';
const BONDED = 'akash1bondedpool';
const NOT_BONDED = 'akash1notbondedpool';

/**
 * @param {Record<string, any>} e
 * @returns {Record<string, any>}
 */
const entry = (e) => ({
	hash: H,
	height: 1200,
	time: '2026-09-01T03:20:00.000Z',
	date: '2026-09-01',
	asset: 'AKT',
	decimals: 6,
	counterparty: '',
	counterpartyLabel: '',
	memo: '',
	success: true,
	explorerUrl: `https://www.mintscan.io/akash/transactions/${H}`,
	...e
});

const fee = entry({ id: `${H}:fee`, type: 'fee', kind: 'fee', amount: '-0.004' });
/** The delegation as the indexer read it, from its message. */
const indexed = entry({
	id: `${H}:c0.0:AKT`,
	type: 'sent',
	kind: 'stake',
	amount: '-15',
	counterparty: BONDED
});
/** …and as the archive node's events give it, with the rewards it withdrew. */
const fromEvents = entry({
	id: `${H}:m0:e3.0:AKT`,
	type: 'sent',
	kind: 'stake',
	amount: '-15',
	counterparty: BONDED
});
const reward = entry({
	id: `${H}:m0:e5.0:AKT`,
	type: 'received',
	kind: 'reward',
	amount: '0.25',
	counterparty: DIST,
	counterpartyLabel: 'Staking-Belohnungen (distribution)'
});
const returned = entry({
	id: 'unbonding:1720:akashvaloper1example:AKT',
	hash: '',
	height: 1720,
	time: '2026-09-02T00:00:00.000Z',
	date: '2026-09-02',
	type: 'received',
	kind: 'stake',
	amount: '15',
	counterparty: NOT_BONDED,
	counterpartyLabel: 'Staking (ungebunden)',
	explorerUrl: ''
});

/** @param {any[]} entries @param {Record<string, unknown>} history */
const answer = (entries, history) => ({
	chain: 'akash',
	endpoints: {},
	entries,
	balances: [{ asset: 'AKT', amount: '0.246', decimals: 6 }],
	transactions: 1,
	unknownAssets: 0,
	history: {
		earliestHeight: 5000,
		earliestTime: '2026-09-04T00:00:00.000Z',
		pruned: true,
		completedBy: 'indexer',
		...history
	},
	addressUrl: ''
});

function setUp() {
	const store = {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection,
		settings: memoryCollection('settings').collection,
		events: memoryCollection('events').collection
	};
	/** @type {any} */ let next;
	const client = /** @type {any} */ ({
		walletHistory: async () => next,
		rate: async (/** @type {string} */ asset, /** @type {string} */ date) => ({
			asset,
			date,
			currency: 'EUR',
			rate: '2',
			usdRate: null,
			source: 'coingecko',
			at: `${date}T00:00:00Z`
		})
	});
	return { store, client, answer: (/** @type {any} */ a) => (next = a) };
}

describe('an Akash wallet with an archive node (#1029)', () => {
	it('books the rewards and the unbonding return; the indexed delegation keeps its id', async () => {
		const s = setUp();
		const wallet = await addWallet(s.store.settings, { chain: 'akash', address: W });
		s.answer(answer([fee, indexed], { unknownAmounts: 1 }));
		await syncWallet({ client: s.client, store: s.store, wallet });

		s.answer(
			answer([fee, fromEvents, reward, returned], {
				unknownAmounts: 0,
				archiveRead: 1,
				unbonding: { returned: 1, pending: 0, unread: 0 }
			})
		);
		const second = await syncWallet({ client: s.client, store: s.store, wallet });
		expect(second.totals.new).toBe(2);

		const rows = (await s.store.transactions.list()).filter((/** @type {any} */ r) => !r.deleted);
		expect(rows.map((/** @type {any} */ r) => r.sourceId).sort()).toEqual(
			[`${H}:c0.0:AKT`, `${H}:fee`, `${H}:m0:e5.0:AKT`, returned.id].sort()
		);
		const of = (/** @type {string} */ id) => rows.find((/** @type {any} */ r) => r.sourceId === id);
		// A reward is income (the account rule of #1027 takes it).
		expect(of(reward.id)?.movement).toBe('reward');
		// The return has no transaction: it names the block it came back in.
		const back = of(returned.id);
		expect([back?.movement, back?.quantity, back?.txRef]).toEqual(['stake', '15000000', '']);
		expect(back?.purpose).toContain('Block 1720');
		expect(back?.purpose).not.toContain('Tx ');
		// The bookings add up to the balance.
		const sum = rows.reduce(
			(/** @type {bigint} */ a, /** @type {any} */ r) => a + BigInt(r.quantity),
			0n
		);
		expect(sum).toBe(246000n);
	});
});

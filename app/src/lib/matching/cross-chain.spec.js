// Own transfers across chains (issue #98): an IBC transfer to an own wallet on
// another Cosmos chain, and a bridge from one own EVM wallet to another.
// Made-up addresses and amounts only.
import { describe, expect, it } from 'vitest';

import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';
import { classificationLine } from './explain.js';
import { relatedIndex } from './related.js';
import { txDirection } from '../bank/format.js';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
/** A bech32-looking address (the app checks the shape, not the checksum). @param {string} prefix @param {number} seed */
const bech = (prefix, seed) =>
	`${prefix}1${Array.from({ length: 38 }, (_, i) => CHARSET[(seed * 7 + i * 3) % 32]).join('')}`;
const evm = (/** @type {string} */ byte) => `0x${byte.repeat(20)}`;
const ETH = (/** @type {number} */ milli) => String(BigInt(milli) * 10n ** 15n);

/** @param {Record<string, any>} t */
const move = (t) => ({
	currency: 'EUR',
	movement: 'transfer',
	deleted: false,
	decimals: 18,
	...t
});

describe('IBC to an own wallet on another chain', () => {
	const akashAddr = bech('akash', 1);
	const accounts = [
		{ id: 'acc-nyx', source: 'nyx', name: 'Wallet NYM', walletAddress: bech('n', 2), asset: 'NYM' },
		{ id: 'acc-akt', source: 'akash', name: 'Wallet AKT', walletAddress: akashAddr, asset: 'AKT' }
	];
	const send = move({
		id: 'ibc-1',
		accountId: 'acc-nyx',
		source: 'nyx',
		bookedOn: '2026-04-11',
		asset: 'NYM',
		quantity: '-225000000',
		decimals: 6,
		amountCents: -684,
		counterpartyAddress: akashAddr,
		bookingType: 'IBC-Transfer'
	});

	it('is looked up on the receiver’s chain: an own transfer', async () => {
		const ctx = await buildMatchingContext({ accounts, transactions: [send], settings: null });
		const c = classifyTransaction(send, ctx);
		expect(c).toMatchObject({
			kind: 'own-transfer',
			via: 'own-address',
			counterAccountId: 'acc-akt',
			chain: 'akash'
		});
		expect(classificationLine(c, { accounts })).toContain('per IBC');
	});

	it('to someone else’s address: still a question', async () => {
		const other = { ...send, id: 'ibc-2', counterpartyAddress: bech('akash', 9) };
		const ctx = await buildMatchingContext({ accounts, transactions: [other], settings: null });
		expect(classifyTransaction(other, ctx)).toBeNull();
	});
});

describe('a bridge between own EVM wallets', () => {
	const accounts = [
		{
			id: 'acc-l2',
			source: 'optimism',
			name: 'Wallet ETH (Optimism)',
			walletAddress: evm('aa'),
			asset: 'ETH'
		},
		{
			id: 'acc-l1',
			source: 'ethereum',
			name: 'Wallet ETH (Ethereum)',
			walletAddress: evm('aa'),
			asset: 'ETH'
		}
	];
	// Sent on the L2 to the bridge contract; seven days later the L1 side
	// arrives as an internal transfer from another contract, 0.5 % less.
	const sent = move({
		id: 'l2-out',
		accountId: 'acc-l2',
		source: 'optimism',
		sourceId: `${evm('01')}:value`,
		bookedOn: '2026-07-12',
		asset: 'ETH',
		quantity: `-${ETH(1000)}`,
		amountCents: -250000,
		counterpartyAddress: evm('b1')
	});
	const received = move({
		id: 'l1-in',
		accountId: 'acc-l1',
		source: 'ethereum',
		sourceId: `${evm('02')}:internal:0`,
		bookedOn: '2026-07-19',
		asset: 'ETH',
		quantity: ETH(995),
		amountCents: 233000,
		counterpartyAddress: evm('b2')
	});
	/** @param {Record<string, any>[]} transactions */
	const context = (transactions) =>
		buildMatchingContext({ accounts, transactions, settings: null });

	it('pairs both sides: same asset, the quantity less a small fee, within days', async () => {
		const ctx = await context([sent, received]);
		expect(classifyTransaction(received, ctx)).toMatchObject({
			kind: 'own-transfer',
			via: 'bridge',
			counterBookingId: 'l2-out',
			counterAccountId: 'acc-l2',
			chain: 'optimism'
		});
		expect(classifyTransaction(sent, ctx)).toMatchObject({
			via: 'bridge',
			counterBookingId: 'l1-in'
		});
		const line = classificationLine(classifyTransaction(received, ctx), { accounts });
		expect(line).toContain('Bridge');
		const classifications = {
			'l1-in': classifyTransaction(received, ctx),
			'l2-out': classifyTransaction(sent, ctx)
		};
		const rel = relatedIndex([sent, received], /** @type {any} */ (classifications));
		expect(rel.get('l1-in')).toMatchObject([{ kind: 'transfer', via: 'bridge' }]);
	});

	it('not when the arrival is not internal, too late, too small, or more than sent', async () => {
		for (const changed of [
			{ sourceId: `${evm('02')}:value` },
			{ bookedOn: '2026-07-21' },
			{ bookedOn: '2026-07-11' },
			{ quantity: ETH(960) },
			{ quantity: ETH(1001) },
			{ asset: 'USDC' }
		]) {
			const other = { ...received, ...changed };
			const ctx = await context([sent, other]);
			expect(classifyTransaction(other, ctx), JSON.stringify(changed)).toBeNull();
		}
	});

	it('two arrivals that both fit: a question, not a guess', async () => {
		const twin = { ...received, id: 'l1-in-2', sourceId: `${evm('03')}:internal:0` };
		const ctx = await context([sent, received, twin]);
		expect(classifyTransaction(received, ctx)).toBeNull();
		expect(classifyTransaction(sent, ctx)).toBeNull();
	});

	it('a pair the person said is no transfer stays apart', async () => {
		const ctx = await buildMatchingContext({
			accounts,
			transactions: [sent, received],
			settings: /** @type {any} */ ({ notTransfers: ['l1-in|l2-out', 'l2-out|l1-in'] })
		});
		expect(classifyTransaction(received, ctx)).toBeNull();
	});
});

describe('which way a booking goes', () => {
	it('by its euro cents, and below a cent by its quantity', () => {
		expect(txDirection({ amountCents: -5 })).toBe(-1);
		expect(txDirection({ amountCents: 0, quantity: '-3492' })).toBe(-1);
		expect(txDirection({ amountCents: 0, quantity: '10' })).toBe(1);
		expect(txDirection({ amountCents: 0 })).toBe(0);
	});
});

describe('two bookings linked by hand as one own transfer', () => {
	const accounts = [
		{
			id: 'acc-l2',
			source: 'optimism',
			name: 'Wallet ETH (Optimism)',
			walletAddress: evm('aa'),
			asset: 'ETH'
		},
		{ id: 'acc-bank', source: 'hibiscus', name: 'Girokonto' }
	];
	const out = move({
		id: 'x-out',
		accountId: 'acc-l2',
		source: 'optimism',
		bookedOn: '2026-08-01',
		asset: 'ETH',
		quantity: `-${ETH(100)}`,
		amountCents: -24000
	});
	const into = {
		id: 'x-in',
		accountId: 'acc-bank',
		source: 'hibiscus',
		bookedOn: '2026-08-04',
		currency: 'EUR',
		amountCents: 23500,
		counterparty: 'Offramp Ltd',
		deleted: false
	};

	it('holds whatever the rules find, and shows as related', async () => {
		const ctx = await buildMatchingContext({
			accounts,
			transactions: [out, into],
			settings: /** @type {any} */ ({ ownTransfers: ['x-in|x-out'] })
		});
		const c = classifyTransaction(into, ctx);
		expect(c).toMatchObject({
			kind: 'own-transfer',
			via: 'manual',
			counterBookingId: 'x-out',
			counterAccountId: 'acc-l2'
		});
		expect(classifyTransaction(out, ctx)).toMatchObject({
			via: 'manual',
			counterBookingId: 'x-in'
		});
		expect(classificationLine(c, { accounts })).toContain('von dir verknüpft');
		const rel = relatedIndex([out, into], /** @type {any} */ ({ 'x-in': c }));
		expect(rel.get('x-out')).toMatchObject([{ kind: 'transfer', via: 'manual' }]);
	});

	it('a link to a deleted booking is no link', async () => {
		const ctx = await buildMatchingContext({
			accounts,
			transactions: [out, { ...into, deleted: true }],
			settings: /** @type {any} */ ({ ownTransfers: ['x-in|x-out'] })
		});
		expect(classifyTransaction(out, ctx)).toBeNull();
	});
});

describe('the other side to link: candidates', () => {
	const base = { currency: 'EUR', deleted: false };
	const me = { ...base, id: 'me', accountId: 'a', bookedOn: '2026-08-10', amountCents: -10000 };
	const others = [
		{ ...base, id: 'far', accountId: 'b', bookedOn: '2026-10-01', amountCents: 10000 },
		{ ...base, id: 'same-account', accountId: 'a', bookedOn: '2026-08-10', amountCents: 10000 },
		{ ...base, id: 'same-way', accountId: 'b', bookedOn: '2026-08-10', amountCents: -10000 },
		{ ...base, id: 'close', accountId: 'b', bookedOn: '2026-08-12', amountCents: 9950 },
		{
			...base,
			id: 'exact',
			accountId: 'c',
			bookedOn: '2026-08-14',
			amountCents: 10000,
			counterparty: 'Revolut'
		},
		{
			...base,
			id: 'fee',
			accountId: 'b',
			bookedOn: '2026-08-10',
			amountCents: 10000,
			movement: 'fee'
		}
	];

	it('the other way, on another account, within a month, closest amount first', async () => {
		const { transferCandidates } = await import('./view.js');
		expect(transferCandidates(me, [me, ...others]).map((o) => o.id)).toEqual(['exact', 'close']);
		expect(transferCandidates(me, others, { query: 'revo' }).map((o) => o.id)).toEqual(['exact']);
		expect(transferCandidates(me, others, { query: '99.5' }).map((o) => o.id)).toEqual(['close']);
	});
});

describe('linking and unlinking by hand', () => {
	/** @returns {Promise<any>} */
	async function books() {
		const { memoryCollection } = await import('../bank/test-support.js');
		/** @type {any} */
		const store = {};
		for (const name of /** @type {const} */ (['settings', 'events']))
			store[name] = memoryCollection(name).collection;
		return store;
	}

	it('a link replaces "Keine Umbuchung" of the pair and an earlier link of either side', async () => {
		const { linkTransfer, rejectTransfer } = await import('./actions.js');
		const { getSetting } = await import('../store/settings.js');
		const store = await books();
		await rejectTransfer(store, 'a', 'b');
		await linkTransfer(store, 'c', 'a');
		await linkTransfer(store, 'b', 'a');
		const m = await getSetting(store.settings, 'matching');
		expect(m.ownTransfers).toEqual(['a|b']);
		expect(m.notTransfers).toEqual([]);
		// "Verknüpfung lösen": unlinked, and kept apart from then on.
		await rejectTransfer(store, 'b', 'a');
		const after = await getSetting(store.settings, 'matching');
		expect(after.ownTransfers).toEqual([]);
		expect(after.notTransfers).toEqual(['a|b']);
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => e.action)).toContain('own-transfer-link');
	});
});

describe('the check "Umbuchung mit Beleg"', () => {
	const transactions = [
		{ id: 't-bridge', bookedOn: '2026-07-19', amountCents: 233000 },
		{ id: 't-eigen', bookedOn: '2026-04-15', amountCents: 591 },
		{ id: 't-shop', bookedOn: '2026-07-20', amountCents: -1999 },
		{ id: 't-kept', bookedOn: '2026-07-21', amountCents: -500 }
	];
	const receipts = [
		{ id: 'r-wrong', vendor: 'Zufall GmbH' },
		{ id: 'r-eigen', source: 'eigenbeleg' },
		{ id: 'r-shop', vendor: 'Laden' },
		{ id: 'r-kept', vendor: 'Richtig' }
	];
	const matches = [
		{ id: 'm1', transactionId: 't-bridge', receiptId: 'r-wrong', state: 'auto' },
		{ id: 'm2', transactionId: 't-eigen', receiptId: 'r-eigen', state: 'confirmed' },
		{ id: 'm3', transactionId: 't-shop', receiptId: 'r-shop', state: 'auto' },
		{ id: 'm4', transactionId: 't-kept', receiptId: 'r-kept', state: 'confirmed' },
		{ id: 'm5', transactionId: 't-bridge', receiptId: 'r-shop', state: 'rejected' }
	];
	const own = { kind: 'own-transfer', via: 'bridge' };
	const classifications = { 't-bridge': own, 't-eigen': own, 't-kept': own };

	it('an own transfer with a receipt from before; not an Eigenbeleg, not a kept one', async () => {
		const { transfersWithReceipt } = await import('./view.js');
		const found = transfersWithReceipt({
			transactions,
			receipts,
			matches,
			classifications,
			kept: ['t-kept|r-kept']
		});
		expect(found.map((x) => [x.tx.id, x.receipt.id, x.matchId])).toEqual([
			['t-bridge', 'r-wrong', 'm1']
		]);
	});

	it('"Beleg ist richtig" is kept once and logged', async () => {
		const { keepTransferReceipt } = await import('./actions.js');
		const { getSetting } = await import('../store/settings.js');
		const { memoryCollection } = await import('../bank/test-support.js');
		/** @type {any} */
		const store = {};
		for (const name of /** @type {const} */ (['settings', 'events']))
			store[name] = memoryCollection(name).collection;
		await keepTransferReceipt(store, 't-bridge', 'r-wrong');
		await keepTransferReceipt(store, 't-bridge', 'r-wrong');
		expect((await getSetting(store.settings, 'matching')).keptTransferReceipts).toEqual([
			't-bridge|r-wrong'
		]);
		const events = await store.events.list();
		expect(
			events.filter((/** @type {any} */ e) => e.action === 'transfer-receipt-kept')
		).toHaveLength(1);
	});
});

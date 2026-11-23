// A NEAR account as an own wallet: the account id as its address, its name,
// a sync through the bridge's wallet service against a made-up NearBlocks and
// RPC (@le-space/chains/testing/near), and the hash an exchange names for a
// withdrawal. Every account, hash and amount is made up.
import { describe, expect, it } from 'vitest';

import { createWalletService } from '@le-space/chains';
import {
	NEAR,
	fakeNear,
	storageBeforeSwap,
	storageWithoutSwap
} from '@le-space/chains/testing/near';
import { memoryCollection } from '../bank/test-support.js';
import { chainOfHash } from '../assets/hash-chain.js';
import { assetOf } from '../assets/registry.js';
import { txRefsOf } from '../matching/context.js';
import { classifyTransaction } from '../matching/classify.js';
import { relatedIndex } from '../matching/related.js';
import { classificationLine } from '../matching/explain.js';
import { applyFeeRule, setFeeRule } from '../booking/fee-rule.js';
import { planMonth } from '../export/plan.js';
import {
	WALLET_CHAINS,
	addressExplorerUrl,
	looksLikeAddress,
	normalizeAddress,
	walletAccountName
} from './chains.js';
import { addWallet, bookWalletHistory, syncWallet } from './wallet-sync.js';

/** EUR per unit, made up. */
const RATES = /** @type {Record<string, string>} */ ({ NEAR: '3', USDC: '0.9' });

function store() {
	return {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection,
		settings: memoryCollection('settings').collection,
		events: memoryCollection('events').collection
	};
}

function client() {
	const service = createWalletService({ fetch: fakeNear().fetch });
	return /** @type {any} */ ({
		walletHistory: (/** @type {string} */ chain, /** @type {any} */ body) =>
			service.sync({ chain, address: body.address }),
		rate: async (/** @type {string} */ asset, /** @type {string} */ date) => ({
			asset,
			date,
			currency: 'EUR',
			rate: RATES[asset],
			usdRate: null,
			source: 'coingecko',
			at: `${date}T00:00:00Z`
		})
	});
}

describe('a NEAR account as a wallet', () => {
	const near = WALLET_CHAINS.near;

	it('takes a named or an implicit account id, in lower case', () => {
		expect(looksLikeAddress(near, NEAR.wallet)).toBe(true);
		expect(looksLikeAddress(near, 'a'.repeat(64))).toBe(true);
		expect(looksLikeAddress(near, 'Wolkenfabrik.NEAR')).toBe(true);
		expect(normalizeAddress(near, ' Wolkenfabrik.NEAR ')).toBe(NEAR.wallet);
		for (const no of ['x', 'kein konto', '.near', 'a..near', `0x${'a'.repeat(40)}!`]) {
			expect(looksLikeAddress(near, no)).toBe(false);
		}
		expect(looksLikeAddress(WALLET_CHAINS.ethereum, NEAR.wallet)).toBe(false);
	});

	it('names its accounts by the account id, an implicit one by its tail', () => {
		expect(walletAccountName(near, 'NEAR', NEAR.wallet)).toBe(`Wallet NEAR ${NEAR.wallet}`);
		expect(walletAccountName(near, 'USDC', 'ab'.repeat(32))).toBe('Wallet USDC ···ababab');
		expect(assetOf('NEAR')).toMatchObject({ decimals: 24, caip19: 'near:mainnet/slip44:397' });
	});

	it('links the account on the explorer of its bookings', () => {
		expect(
			addressExplorerUrl(`https://nearblocks.io/txns/${NEAR.hashIn}`, NEAR.hashIn, NEAR.wallet)
		).toBe(`https://nearblocks.io/address/${NEAR.wallet}`);
		expect(
			addressExplorerUrl(`https://nearblocks.io/txns/${NEAR.hashIn}`, NEAR.hashIn, 'a/../b')
		).toBeNull();
	});

	it('a sync books what arrived, what left with its fee, and the listed token', async () => {
		const s = store();
		const wallet = await addWallet(s.settings, { chain: 'near', address: NEAR.wallet });
		const now = new Date('2026-11-17T08:00:00Z');
		const first = await syncWallet({ client: client(), store: s, wallet, now });
		expect(first.totals).toEqual({ new: 4, updated: 0, skipped: 0 });
		expect(first.unpriced).toEqual([]);
		// The token that only calls itself USDC is counted, not booked.
		expect(first.unknownAssets).toBe(1);

		const accounts = (await s.accounts.list()).sort((a, b) => (a.name < b.name ? -1 : 1));
		expect(accounts.map((a) => [a.name, a.source, a.kind, a.asset, a.balance])).toEqual([
			[`Wallet NEAR ${NEAR.wallet}`, 'near', 'wallet', 'NEAR', '19.75'],
			[`Wallet USDC ${NEAR.wallet}`, 'near', 'wallet', 'USDC', '12.34']
		]);
		expect(accounts[0].addressUrl).toBe(`https://nearblocks.io/address/${NEAR.wallet}`);

		const txs = await s.transactions.list();
		const arrived = txs.find((t) => t.sourceId === `${NEAR.hashIn}:deposit`);
		expect(arrived).toMatchObject({
			source: 'near',
			bookedOn: '2026-11-14',
			asset: 'NEAR',
			quantity: '21250000000000000000000000',
			amountCents: 6375, // 21.25 NEAR × 3
			txRef: NEAR.hashIn,
			counterpartyAddress: NEAR.exchange,
			explorerUrl: `https://nearblocks.io/txns/${NEAR.hashIn}`
		});
		expect(txs.find((t) => t.sourceId === `${NEAR.hashOut}:fee`)).toMatchObject({
			movement: 'fee',
			asset: 'NEAR',
			quantity: '-446365125000000000000'
		});
		expect(txs.find((t) => t.sourceId === `${NEAR.hashToken}:ft:r2:0`)).toMatchObject({
			asset: 'USDC',
			quantity: '12340000'
		});

		// An exchange's withdrawal that names this hash shares a reference with it.
		const withdrawal = { txRef: 'REF-TEST-1', chainTxRef: NEAR.hashIn };
		expect(txRefsOf(withdrawal).some((r) => txRefsOf(arrived ?? {}).includes(r))).toBe(true);

		// A second sync adds nothing.
		const second = await syncWallet({ client: client(), store: s, wallet, now });
		expect(second.totals.new).toBe(0);
	});

	it('an exchange’s hash for a NEAR withdrawal is found on NEAR', () => {
		const ids = (/** @type {any} */ a) => a.chains.map((/** @type {any} */ c) => c.id);
		expect(ids(chainOfHash({ hash: NEAR.hashIn, asset: 'NEAR' }))).toEqual(['near']);
		expect(ids(chainOfHash({ hash: NEAR.hashIn, asset: 'USDC', method: 'NEAR Protocol' }))).toEqual(
			['near']
		);
		expect(ids(chainOfHash({ hash: NEAR.hashIn, asset: 'USDC' }))).toEqual([]);
		// A network that does not fit the hash's form never overrides it.
		expect(
			ids(chainOfHash({ hash: `0x${'a'.repeat(64)}`, asset: 'USDC', method: 'NEAR' }))
		).toEqual(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon']);
	});

	it('a wrap read as a payment before is taken out once the reader reads the swap (#898)', async () => {
		const s = {
			...store(),
			matches: memoryCollection('matches').collection,
			questions: memoryCollection('questions').collection
		};
		const wallet = await addWallet(s.settings, { chain: 'near', address: NEAR.wallet });
		const other = await addWallet(s.settings, { chain: 'near', address: 'stromwerk.near' });
		const now = new Date('2026-11-21T08:00:00Z');
		const WRAP = 'Wrap1111111111111111111111111111111111111111';
		const SWAP = 'Swap2222222222222222222222222222222222222222';
		const DEX = 'dex.example.near';
		/** A wallet entry as the bridge gives it. @param {Record<string, any>} over @returns {any} */
		const e = (over) => ({
			height: 300,
			time: '2026-11-20T14:05:00Z',
			date: '2026-11-20',
			kind: 'transfer',
			asset: 'NEAR',
			decimals: 24,
			counterparty: '',
			counterpartyLabel: '',
			memo: '',
			success: true,
			explorerUrl: '',
			...over
		});
		const gas = (/** @type {string} */ hash) =>
			e({ id: `${hash}:fee`, hash, type: 'fee', kind: 'fee', amount: '-0.0004' });
		const usdc = { asset: 'USDC', decimals: 6, amount: '1.03', counterparty: DEX };
		const balances = [
			{ asset: 'NEAR', amount: '4', decimals: 24 },
			{ asset: 'USDC', amount: '1.03', decimals: 6 }
		];
		// As the reader before read it: NEAR paid to the wrap contract, USDC arriving.
		const before = {
			entries: [
				gas(WRAP),
				e({
					id: `${WRAP}:deposit`,
					hash: WRAP,
					type: 'sent',
					amount: '-0.35',
					counterparty: 'wrap.near'
				}),
				gas(SWAP),
				e({ id: `${SWAP}:ft:s2:0`, hash: SWAP, type: 'received', ...usdc })
			],
			balances
		};
		const c = client();
		const first = await bookWalletHistory({ client: c, store: s, wallet, result: before, now });
		expect(first.totals.new).toBe(4);
		expect(first.superseded).toBe(0);
		// Another own wallet holds a booking under the same id: it is not this wallet's.
		await bookWalletHistory({
			client: c,
			store: s,
			wallet: other,
			result: { entries: [before.entries[1]], balances: [] },
			now
		});
		const paid = (await s.transactions.list()).filter((t) => t.sourceId === `${WRAP}:deposit`);
		expect(paid).toHaveLength(2);
		const mine = paid.find((t) => t.counterpartyAddress === 'wrap.near' && !t.deleted);
		const ours = (await s.accounts.list()).filter((a) =>
			String(a.sourceAccountId).startsWith(`${NEAR.wallet}:`)
		);
		const wrapPaid = paid.find((t) => ours.some((a) => a.id === t.accountId));
		expect(mine).toBeTruthy();
		const match = await s.matches.put({
			transactionId: wrapPaid?.id,
			receiptId: 'r1',
			state: 'auto'
		});
		await s.questions.put({ transactionId: wrapPaid?.id });

		// As it is read now: the wrap leaves its gas, the swap gives NEAR and gets USDC.
		const swap = {
			gave: [{ asset: 'NEAR', amount: '0.35', listed: true }],
			got: [{ asset: 'USDC', amount: '1.03', listed: true }],
			via: DEX,
			fee: { asset: 'NEAR', amount: '0.0004' }
		};
		const after = {
			entries: [
				gas(WRAP),
				{ ...gas(SWAP), swap },
				e({
					id: `${SWAP}:ft:s1:0`,
					hash: SWAP,
					type: 'sent',
					kind: 'swap',
					amount: '-0.35',
					counterparty: DEX,
					swap
				}),
				e({ id: `${SWAP}:ft:s2:0`, hash: SWAP, type: 'received', kind: 'swap', ...usdc, swap })
			],
			balances,
			superseded: [`${WRAP}:deposit`, `${WRAP}:ft:w1:0`]
		};
		const second = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(second.superseded).toBe(1);
		expect(second.totals.new).toBe(1);

		const all = await s.transactions.list({ includeDeleted: true });
		const live = all.filter((t) => !t.deleted);
		// This wallet's wrap payment is out; the other wallet's stays.
		expect(all.find((t) => t.id === wrapPaid?.id)?.deleted).toBeTruthy();
		expect(live.filter((t) => t.sourceId === `${WRAP}:deposit`)).toHaveLength(1);
		// The NEAR left once: 0.35 in the swap, and the two fees.
		const nearAccount = ours.find((a) => a.asset === 'NEAR');
		const left = live
			.filter((t) => t.accountId === nearAccount?.id)
			.reduce((sum, t) => sum + BigInt(t.quantity), 0n);
		expect(left).toBe(-350_800_000_000_000_000_000_000n);
		// The USDC that arrived is the swap's other leg now, the same booking.
		expect(live.find((t) => t.sourceId === `${SWAP}:ft:s2:0`)).toMatchObject({ movement: 'trade' });
		// What pointed at the booking went with it, and the Verlauf says so.
		expect(
			(await s.matches.list({ includeDeleted: true })).find((m) => m.id === match.id)
		).toMatchObject({ state: 'rejected' });
		expect(await s.questions.list()).toHaveLength(0);
		const event = (await s.events.list()).find((x) => x.kind === 'wallet-superseded');
		expect(event).toMatchObject({ source: 'near', bookings: 1, matches: 1 });

		// Once more: nothing left to take out.
		const third = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(third.superseded).toBe(0);
		expect(third.totals.new).toBe(0);
	});

	it('a storage deposit booked alone before becomes a cost of its swap on the next sync (#968)', async () => {
		const s = store();
		const wallet = await addWallet(s.settings, { chain: 'near', address: NEAR.wallet });
		const now = new Date('2026-11-21T08:00:00Z');
		const { fetch, dex, hashes } = storageBeforeSwap();
		const service = createWalletService({ fetch });
		const c = client();
		const after = await service.sync({ chain: 'near', address: NEAR.wallet });
		// As a reader before #968 gave it: each deposit a payment of its own, the swap without them.
		const before = {
			...after,
			entries: after.entries.map((/** @type {any} */ e) => {
				const { partOf, ...rest } = e;
				const swap = rest.swap && { ...rest.swap };
				if (swap) delete swap.storage;
				if (partOf && rest.id.endsWith(':deposit'))
					return { ...rest, type: 'sent', kind: 'transfer', swap: undefined };
				return partOf ? { ...rest, swap: undefined } : { ...rest, ...(swap ? { swap } : {}) };
			})
		};
		const first = await bookWalletHistory({ client: c, store: s, wallet, result: before, now });
		const ids = (await s.transactions.list()).map((t) => t.id).sort();
		const deposit = `${hashes.atToken}:deposit`;
		const of = async (/** @type {string} */ sourceId) =>
			(await s.transactions.list()).find((t) => t.sourceId === sourceId);
		expect(await of(deposit)).toMatchObject({ movement: 'transfer' });

		const second = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(second.totals.new).toBe(0);
		expect(second.totals.updated).toBeGreaterThan(0);
		// The same bookings, none twice.
		expect((await s.transactions.list()).map((t) => t.id).sort()).toEqual(ids);
		expect(first.totals.new).toBe(ids.length);

		const booked = /** @type {Record<string, any>} */ (await of(deposit));
		expect(booked).toMatchObject({
			movement: 'fee',
			partOf: hashes.swap,
			txRef: hashes.atToken,
			counterpartyAddress: NEAR.usdc,
			quantity: '-1250000000000000000000'
		});
		expect(booked.purpose).toMatch(/^Storage-Deposit für Tausch: 2 NEAR → 5,67 USDC über /);
		expect(booked.purpose).toContain('Storage-Deposit 0,0025 NEAR');
		// The swap's legs name it too: what the swap's receipt shows.
		const leg = /** @type {Record<string, any>} */ (await of(`${hashes.swap}:ft:s1:0`));
		expect(leg.swap.storage).toEqual({ asset: 'NEAR', amount: '0.0025' });
		expect(leg.swap.via).toBe(dex);

		// A network fee: it needs no receipt of its own.
		expect(classifyTransaction(booked, /** @type {any} */ ({ rules: [] }))).toMatchObject({
			kind: 'bank-fee',
			via: 'network-fee'
		});
		// Shown with the swap, like its gas.
		const related = relatedIndex(await s.transactions.list());
		expect(
			(related.get(String(leg.id)) ?? [])
				.filter((r) => r.kind === 'fee')
				.map((r) => r.other.sourceId)
				.sort()
		).toEqual(
			[
				`${hashes.atDex}:deposit`,
				`${hashes.atDex}:fee`,
				deposit,
				`${hashes.atToken}:fee`,
				`${hashes.swap}:fee`
			].sort()
		);
		expect((related.get(String(booked.id)) ?? []).map((r) => r.kind)).toContain('fee-of');

		// It takes the account the swap's gas is booked on.
		const gas = /** @type {Record<string, any>} */ (await of(`${hashes.swap}:fee`));
		await s.transactions.put({
			...gas,
			booking: { account: '4970', taxKey: '', confirmedAt: '2026-11-21T09:00:00Z' }
		});
		await applyFeeRule(/** @type {any} */ (s));
		expect((await of(deposit))?.booking).toMatchObject({ account: '4970', via: 'swap' });
		expect((await of(`${hashes.atDex}:fee`))?.booking).toMatchObject({ account: '4970' });
		await s.transactions.put({ ...gas, booking: null });
		await applyFeeRule(/** @type {any} */ (s));
		expect((await of(deposit))?.booking).toBeNull();

		// Once more: nothing changes.
		const third = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(third.totals).toMatchObject({ new: 0, updated: 0 });
	});

	it('a storage deposit for a transfer, for a receipt, or of its own: a network fee with its reason', async () => {
		const s = store();
		const wallet = await addWallet(s.settings, { chain: 'near', address: NEAR.wallet });
		const now = new Date('2026-11-21T08:00:00Z');
		const { fetch, other, token, hashes } = storageWithoutSwap();
		const after = await createWalletService({ fetch }).sync({
			chain: 'near',
			address: NEAR.wallet
		});
		const c = client();
		// As a reader before gave it: each deposit a payment of its own that waits for a receipt.
		const before = {
			...after,
			entries: after.entries.map((/** @type {any} */ e) => {
				const rest = { ...e };
				for (const k of ['enables', 'purpose', 'registration']) delete rest[k];
				return e.purpose === 'storage' ? { ...rest, type: 'sent', kind: 'transfer' } : rest;
			})
		};
		await bookWalletHistory({ client: c, store: s, wallet, result: before, now });
		const of = async (/** @type {string} */ sourceId) =>
			/** @type {Record<string, any>} */ (
				(await s.transactions.list()).find((t) => t.sourceId === sourceId)
			);
		expect(await of(`${hashes.alone}:deposit`)).toMatchObject({ movement: 'transfer' });
		const ids = (await s.transactions.list()).map((t) => t.id).sort();

		const second = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(second.totals.new).toBe(0);
		// Updated in place: the same bookings, none twice.
		expect((await s.transactions.list()).map((t) => t.id).sort()).toEqual(ids);

		const forTransfer = await of(`${hashes.forTransfer}:deposit`);
		expect(forTransfer).toMatchObject({
			movement: 'fee',
			enables: hashes.transfer,
			storageDeposit: { for: 'transfer', registers: other },
			counterpartyAddress: NEAR.usdc,
			quantity: '-1250000000000000000000'
		});
		expect(forTransfer.partOf).toBeUndefined();
		expect(forTransfer.purpose).toMatch(
			new RegExp(`^Storage-Deposit für die Überweisung an ${other}, Tx PayT1111…1111`)
		);
		const forReceipt = await of(`${hashes.forReceipt}:deposit`);
		expect(forReceipt).toMatchObject({
			movement: 'fee',
			enables: hashes.receipt,
			storageDeposit: { for: 'receipt', registers: NEAR.wallet }
		});
		expect(forReceipt.purpose).toMatch(/^Storage-Deposit für den ersten Eingang des Tokens, Tx /);
		const alone = await of(`${hashes.alone}:deposit`);
		expect(alone).toMatchObject({ movement: 'fee', storageDeposit: { for: 'own' } });
		expect(alone.enables).toBeUndefined();
		expect(alone.purpose).toMatch(new RegExp(`^Storage-Deposit Registrierung bei ${token}`));
		// Its gas names the same transfer, and is a plain network fee.
		const gas = await of(`${hashes.forTransfer}:fee`);
		expect(gas).toMatchObject({ movement: 'fee', enables: hashes.transfer });
		expect(gas.storageDeposit).toBeUndefined();

		// No receipt of its own, each with its reason.
		const ctx = /** @type {any} */ ({ rules: [] });
		for (const [tx, storage, words] of /** @type {const} */ ([
			[forTransfer, 'transfer', 'Storage-Deposit für eine Überweisung'],
			[forReceipt, 'receipt', 'Storage-Deposit für einen Eingang'],
			[alone, 'own', 'Storage-Deposit: NEAR, das ein Vertrag']
		])) {
			const classified = classifyTransaction(tx, ctx);
			expect(classified).toMatchObject({ kind: 'bank-fee', via: 'network-fee', storage });
			expect(classificationLine(/** @type {any} */ (classified))).toContain(words);
		}
		expect(classifyTransaction(gas, ctx)).not.toHaveProperty('storage');

		// Shown with the transfer and with the receipt, as a swap's gas is.
		const related = relatedIndex(await s.transactions.list());
		const payment = await of(`${hashes.transfer}:ft:r0:0`);
		expect(
			(related.get(String(payment.id)) ?? [])
				.filter((r) => r.kind === 'fee')
				.map((r) => r.other.sourceId)
				.sort()
		).toEqual(
			[
				`${hashes.forTransfer}:deposit`,
				`${hashes.forTransfer}:fee`,
				`${hashes.transfer}:fee`
			].sort()
		);
		const receipt = await of(`${hashes.receipt}:ft:r0:0`);
		expect(
			(related.get(String(receipt.id)) ?? [])
				.filter((r) => r.kind === 'fee')
				.map((r) => r.other.sourceId)
				.sort()
		).toEqual([`${hashes.forReceipt}:deposit`, `${hashes.forReceipt}:fee`].sort());
		expect((related.get(String(alone.id)) ?? []).filter((r) => r.kind === 'fee-of')).toEqual([]);

		// The transfer's deposit takes the account its gas is booked on; the others the rule's.
		const transferGas = await of(`${hashes.transfer}:fee`);
		await s.transactions.put({
			...transferGas,
			booking: { account: '4970', taxKey: '', confirmedAt: '2026-11-21T09:00:00Z' }
		});
		await applyFeeRule(/** @type {any} */ (s));
		expect((await of(`${hashes.forTransfer}:deposit`)).booking).toMatchObject({
			account: '4970',
			via: 'swap'
		});
		expect((await of(`${hashes.forReceipt}:deposit`)).booking ?? null).toBeNull();

		// With the network fee rule, each goes into the DATEV export as a fee line of its own.
		await setFeeRule(/** @type {any} */ (s), '4970');
		const plan = planMonth({
			month: '2026-11',
			transactions: await s.transactions.list(),
			// The wallet's accounts on a made-up ledger account.
			accounts: (await s.accounts.list()).map((a) => ({ ...a, ledgerAccount: '1550' })),
			receipts: [],
			matches: [],
			classifications: {},
			collectFees: false
		});
		for (const hash of [hashes.forTransfer, hashes.forReceipt, hashes.alone]) {
			const line = plan.lines.find((l) => l.tx.sourceId === `${hash}:deposit`)?.line;
			expect(line, hash).toBeDefined();
			expect([line?.account, line?.contra], hash).toContain('4970');
		}

		// Once more: nothing changes.
		const third = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(third.totals).toMatchObject({ new: 0, updated: 0 });

		// Tied to a swap by an earlier reader, a transfer's cost now: the swap goes.
		const tied = await of(`${hashes.forTransfer}:deposit`);
		await s.transactions.put({ ...tied, partOf: 'OldSwap1111111111111111111111111111111111111' });
		const fourth = await bookWalletHistory({ client: c, store: s, wallet, result: after, now });
		expect(fourth.totals).toMatchObject({ new: 0, updated: 1 });
		const retied = await of(`${hashes.forTransfer}:deposit`);
		expect(retied.partOf ?? null).toBeNull();
		// Settled: the next sync finds nothing to change.
		expect(
			(await bookWalletHistory({ client: c, store: s, wallet, result: after, now })).totals.updated
		).toBe(0);
		expect(retied.enables).toBe(hashes.transfer);
	});
});

// DEX swaps on a wallet (issue #115): named, classified, related. Made-up data only.
import { describe, expect, it } from 'vitest';

import { describeWalletEntry, swapText } from './wallet-sync.js';
import { buildMatchingContext } from '../matching/context.js';
import { classifyTransaction } from '../matching/classify.js';
import { classificationLine } from '../matching/explain.js';
import { relatedIndex } from '../matching/related.js';

const swap = {
	gave: [{ asset: 'XYZ', amount: '30000', listed: false }],
	got: [{ asset: 'ETH', amount: '0.143', listed: true }],
	via: 'MetaMask Swap (Router)'
};

describe('a swap leg', () => {
	it('is a Tausch, a trade, with both sides in its text', () => {
		expect(describeWalletEntry(/** @type {any} */ ({ type: 'received', kind: 'swap' }))).toEqual({
			label: 'Tausch',
			movement: 'trade'
		});
		expect(swapText(swap)).toBe(
			'Tausch: 30.000 XYZ (nicht gelistet) → 0,143 ETH über MetaMask Swap (Router)'
		);
		expect(swapText({ ...swap, fee: { asset: 'ETH', amount: '0.0002' } })).toBe(
			'Tausch: 30.000 XYZ (nicht gelistet) → 0,143 ETH über MetaMask Swap (Router) · Gas 0,0002 ETH'
		);
		expect(
			swapText({
				gave: [{ asset: 'ETH', amount: '1.5', listed: true }],
				got: [{ asset: 'USDC', amount: '3200', listed: true }],
				via: ''
			})
		).toBe('Tausch: 1,5 ETH → 3.200 USDC');
	});

	it('needs no receipt, says why, and two booked legs relate as Tausch', async () => {
		const hash = `0x${'ab'.repeat(32)}`;
		const accounts = [
			{
				id: 'acc-eth',
				source: 'ethereum',
				name: 'Wallet ETH',
				walletAddress: `0x${'a1'.repeat(20)}`,
				asset: 'ETH'
			},
			{
				id: 'acc-usdc',
				source: 'ethereum',
				name: 'Wallet USDC',
				walletAddress: `0x${'a1'.repeat(20)}`,
				asset: 'USDC'
			}
		];
		const base = {
			source: 'ethereum',
			bookedOn: '2026-07-19',
			currency: 'EUR',
			movement: 'trade',
			txRef: hash,
			deleted: false
		};
		const out = { ...base, id: 'eth-out', accountId: 'acc-eth', amountCents: -300000, swap };
		const into = { ...base, id: 'usdc-in', accountId: 'acc-usdc', amountCents: 299000, swap };
		const ctx = await buildMatchingContext({ accounts, transactions: [out, into], settings: null });
		const c = classifyTransaction(out, ctx);
		expect(c).toEqual({ kind: 'crypto-swap' });
		expect(classificationLine(c)).toContain('Block-Explorer');
		const rel = relatedIndex([out, into], {});
		expect(rel.get('eth-out')).toMatchObject([
			{ kind: 'trade', via: 'hash', other: { id: 'usdc-in' } }
		]);
	});

	it('a bank or exchange trade is not a wallet swap', async () => {
		const ctx = await buildMatchingContext({ accounts: [], transactions: [], settings: null });
		const kraken = {
			id: 'k',
			source: 'kraken',
			accountId: 'k-eth',
			movement: 'trade',
			amountCents: -100,
			bookedOn: '2026-07-19'
		};
		expect(classifyTransaction(kraken, ctx)?.kind).not.toBe('crypto-swap');
	});
});

describe('a token not in the list (#115, part 2)', () => {
	it('is priced by its contract, a listed asset by its symbol', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		/** @type {any[][]} */
		const asked = [];
		const entries = /** @type {any[]} */ ([
			{
				id: 'h:log:1',
				hash: `0x${'ab'.repeat(32)}`,
				date: '2026-07-19',
				time: '2026-07-19T08:35:00Z',
				type: 'sent',
				kind: 'swap',
				asset: 'XYZ',
				amount: '-30000',
				decimals: 18,
				counterparty: '',
				counterpartyLabel: '',
				memo: '',
				success: true,
				explorerUrl: '',
				contract: `0x${'5e'.repeat(20)}`,
				listed: false
			},
			{
				id: 'h:internal:1',
				hash: `0x${'ab'.repeat(32)}`,
				date: '2026-07-19',
				time: '2026-07-19T08:35:00Z',
				type: 'received',
				kind: 'swap',
				asset: 'ETH',
				amount: '0.143',
				decimals: 18,
				counterparty: '',
				counterpartyLabel: '',
				memo: '',
				success: true,
				explorerUrl: ''
			}
		]);
		const { byAsset } = await walletTransactions(entries, async (asset, date, contract) => {
			asked.push([asset, contract]);
			return {
				asset,
				date,
				currency: 'EUR',
				rate: asset === 'ETH' ? '2000' : '0.0001',
				usdRate: null,
				source: 'coingecko',
				at: `${date}T00:00:00Z`
			};
		});
		expect(asked).toEqual([
			['XYZ', `0x${'5e'.repeat(20)}`],
			['ETH', undefined]
		]);
		expect(byAsset.get('XYZ')?.[0].amountCents).toBe(-300);
	});
});

describe('a swap leg without a rate (#163)', () => {
	const hash = `0x${'cd'.repeat(32)}`;
	/** @param {Record<string, any>} over */
	const leg = (over) => ({
		hash,
		date: '2026-07-19',
		time: '2026-07-19T08:35:00Z',
		kind: 'swap',
		decimals: 18,
		counterparty: '',
		counterpartyLabel: '',
		memo: '',
		success: true,
		explorerUrl: '',
		...over
	});
	const gave = leg({
		id: `${hash}:log:1`,
		type: 'sent',
		asset: 'XYZ',
		amount: '-30000',
		contract: `0x${'5e'.repeat(20)}`,
		listed: false
	});
	const got = leg({ id: `${hash}:internal:1`, type: 'received', asset: 'ETH', amount: '0.143' });
	const gas = leg({ id: `${hash}:fee`, type: 'fee', kind: 'fee', asset: 'ETH', amount: '-0.0002' });
	/** ETH has a rate, XYZ has none. @param {string} asset @param {string} date */
	const rates = async (asset, date) => {
		if (asset !== 'ETH') throw new Error(`no rate source for ${asset}`);
		return {
			asset,
			date,
			currency: /** @type {const} */ ('EUR'),
			rate: '2000',
			usdRate: null,
			source: /** @type {const} */ ('coingecko'),
			at: `${date}T00:00:00Z`
		};
	};

	it('is worth what came back for it: the price of the trade', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		const { byAsset, unpriced } = await walletTransactions(
			/** @type {any[]} */ ([gave, got, gas]),
			rates
		);
		expect(unpriced).toEqual([]);
		const xyz = byAsset.get('XYZ')?.[0];
		// 0.143 ETH × 2000 EUR = 286 EUR for 30,000 XYZ.
		expect(xyz?.amountCents).toBe(-28600);
		expect(xyz?.crypto?.valuation).toMatchObject({
			source: 'trade',
			rate: '0.009533333333',
			at: '2026-07-19T08:35:00Z'
		});
		// The gas is not part of the price.
		expect(byAsset.get('ETH')?.map((t) => t.amountCents)).toEqual([28600, -40]);
	});

	it('not when the other side has no rate either, or is missing', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		const none = await walletTransactions(/** @type {any[]} */ ([gave, got]), async (a) => {
			throw new Error(`no rate source for ${a}`);
		});
		expect(none.unpriced.map((u) => u.asset)).toEqual(['XYZ', 'ETH']);
		const alone = await walletTransactions(/** @type {any[]} */ ([gave]), rates);
		expect(alone.unpriced.map((u) => u.asset)).toEqual(['XYZ']);
	});

	it('two tokens given for ETH, one priced: the other gets the rest', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		const usdc = leg({
			id: `${hash}:log:2`,
			type: 'sent',
			asset: 'USDC',
			amount: '-100',
			decimals: 6
		});
		const { byAsset } = await walletTransactions(
			/** @type {any[]} */ ([gave, usdc, got]),
			async (asset, date) => {
				if (asset === 'USDC') return { ...(await rates('ETH', date)), asset, rate: '0.9' };
				return rates(asset, date);
			}
		);
		// 286 EUR back, 90 EUR of it for the USDC: 196 EUR for the XYZ.
		expect(byAsset.get('XYZ')?.[0].amountCents).toBe(-19600);
	});
});

describe('a token priced by its pool (#163, step 3)', () => {
	it('asks with the block and decimals, and shows pool and block', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		const { valuationText } = await import('../assets/valuation.js');
		const pool = `0x${'a2'.repeat(20)}`;
		/** @type {any[]} */
		const asked = [];
		const entries = /** @type {any[]} */ ([
			{
				id: 'h:erc20:1',
				hash: `0x${'ef'.repeat(32)}`,
				height: 1000,
				date: '2026-05-02',
				time: '2026-05-02T10:41:47Z',
				type: 'sent',
				kind: 'transfer',
				asset: 'XYZ',
				amount: '-1000000',
				decimals: 18,
				counterparty: `0x${'0'.repeat(40)}`,
				counterpartyLabel: '',
				memo: '',
				success: true,
				explorerUrl: '',
				contract: `0x${'5e'.repeat(20)}`,
				listed: false
			}
		]);
		const { byAsset } = await walletTransactions(entries, async (asset, date, contract, at) => {
			asked.push({ asset, contract, at });
			return {
				asset,
				date,
				currency: 'EUR',
				rate: '0.000000697',
				usdRate: null,
				source: 'dex',
				at: '2026-05-02T10:41:47Z',
				ref: `uniswap-v2:${pool}@1000`
			};
		});
		expect(asked).toEqual([
			{ asset: 'XYZ', contract: `0x${'5e'.repeat(20)}`, at: { block: 1000, decimals: 18 } }
		]);
		const tx = byAsset.get('XYZ')?.[0];
		expect(tx?.amountCents).toBe(-70);
		const shown = valuationText({
			asset: 'XYZ',
			quantity: tx?.crypto?.quantity,
			decimals: 18,
			valuation: tx?.crypto?.valuation
		});
		expect(shown).toContain('DEX-Pool (Uniswap V2, Pool 0xa2a2…a2a2, Block 1000)');
		// A V4 pool is named by its id in the PoolManager.
		const v4 = valuationText({
			asset: 'XYZ',
			quantity: tx?.crypto?.quantity,
			decimals: 18,
			valuation: { ...tx?.crypto?.valuation, ref: `uniswap-v4:0x${'b4'.repeat(32)}@1000` }
		});
		expect(v4).toContain('DEX-Pool (Uniswap V4, Pool 0xb4b4…b4b4, Block 1000)');
	});
});

describe('a sent IBC transfer whose memo plans a swap (#170)', () => {
	it('keeps the plan on the booking; any other memo keeps none', async () => {
		const { walletTransactions } = await import('./wallet-sync.js');
		const { skipMemo, bech } = await import('./cross-swap.fixtures.js');
		const base = {
			hash: 'AB'.repeat(32),
			height: 1,
			date: '2026-04-11',
			time: '2026-04-11T15:22:31Z',
			type: 'sent',
			kind: 'ibc',
			asset: 'NYM',
			amount: '-200',
			decimals: 6,
			counterparty: bech('osmo', 5),
			counterpartyLabel: 'IBC-Transfer',
			success: true,
			explorerUrl: ''
		};
		const entries = /** @type {any[]} */ ([
			// As the chain has it: the plan in the IBC message's memo, the transaction's own empty.
			{ ...base, id: 'a', memo: '', ibcMemo: skipMemo() },
			{ ...base, id: 'b', hash: 'CD'.repeat(32), memo: 'Miete' }
		]);
		const { byAsset } = await walletTransactions(entries, async (asset, date) => ({
			asset,
			date,
			currency: 'EUR',
			rate: '0.03',
			usdRate: null,
			source: 'coingecko',
			at: `${date}T00:00:00Z`
		}));
		const [withPlan, without] = byAsset.get('NYM') ?? [];
		expect(withPlan?.crossSwap).toMatchObject({
			receiver: bech('akash', 2),
			minAmount: '15000000'
		});
		expect(without?.crossSwap).toBeUndefined();
	});
});

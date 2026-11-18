// A NEAR account as an own wallet: the account id as its address, its name,
// a sync through the bridge's wallet service against a made-up NearBlocks and
// RPC (@le-space/chains/testing/near), and the hash an exchange names for a
// withdrawal. Every account, hash and amount is made up.
import { describe, expect, it } from 'vitest';

import { createWalletService } from '@le-space/chains';
import { NEAR, fakeNear } from '@le-space/chains/testing/near';
import { memoryCollection } from '../bank/test-support.js';
import { chainOfHash } from '../assets/hash-chain.js';
import { assetOf } from '../assets/registry.js';
import { txRefsOf } from '../matching/context.js';
import {
	WALLET_CHAINS,
	addressExplorerUrl,
	looksLikeAddress,
	normalizeAddress,
	walletAccountName
} from './chains.js';
import { addWallet, syncWallet } from './wallet-sync.js';

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
});

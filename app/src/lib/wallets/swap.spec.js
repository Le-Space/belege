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

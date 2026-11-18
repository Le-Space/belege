// A withdrawal's address offered as an own wallet. Made-up addresses.
import { describe, expect, it } from 'vitest';
import { walletSuggestion } from './suggest.js';
import { HASH_CHAINS } from '../assets/hash-chain.js';

const EVM = '0x' + 'ab'.repeat(20);
const evmChains = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'].map(
	(id) => HASH_CHAINS[id]
);

describe('walletSuggestion', () => {
	it('offers a NEAR account the books do not have', () => {
		const s = walletSuggestion({
			address: 'wolkenfabrik.near',
			chains: [HASH_CHAINS.near],
			wallets: []
		});
		expect(s).toMatchObject({ state: 'add', address: 'wolkenfabrik.near' });
		expect(s?.state === 'add' && s.chains.map((c) => c.id)).toEqual(['near']);
	});

	it('offers nothing for an own wallet, whatever the case of the address', () => {
		expect(
			walletSuggestion({
				address: 'Wolkenfabrik.near',
				chains: [HASH_CHAINS.near],
				wallets: [{ chain: 'near', address: 'wolkenfabrik.near' }]
			})
		).toBeNull();
		expect(
			walletSuggestion({
				address: EVM.toUpperCase().replace('0X', '0x'),
				chains: [HASH_CHAINS.base],
				wallets: [{ chain: 'base', address: EVM }]
			})
		).toBeNull();
	});

	it('without a hash, takes the network the exchange named, else the asset’s home', () => {
		const byMethod = walletSuggestion({
			address: EVM,
			method: 'Ether (Arbitrum One)',
			asset: 'ETH',
			wallets: []
		});
		expect(byMethod?.state === 'add' && byMethod.chains.map((c) => c.id)).toEqual(['arbitrum']);
		const byAsset = walletSuggestion({ address: 'wolkenfabrik.near', asset: 'NEAR', wallets: [] });
		expect(byAsset?.state === 'add' && byAsset.chains.map((c) => c.id)).toEqual(['near']);
		expect(walletSuggestion({ address: EVM, asset: 'ETH', wallets: [] })).toBeNull();
	});

	it('an EVM hash of no named chain: every EVM chain is offered, none when one has the wallet', () => {
		const open = walletSuggestion({ address: EVM, chains: evmChains, wallets: [] });
		expect(open?.state === 'add' && open.chains.length).toBe(5);
		expect(
			walletSuggestion({
				address: EVM,
				chains: evmChains,
				wallets: [{ chain: 'polygon', address: EVM }]
			})
		).toBeNull();
	});

	it('names a chain Belege cannot read', () => {
		expect(
			walletSuggestion({
				address: 'So1' + '1'.repeat(40),
				chains: [HASH_CHAINS.solana],
				wallets: []
			})
		).toEqual({ state: 'unsupported', address: 'So1' + '1'.repeat(40), chainName: 'Solana' });
	});

	it('offers nothing for Bitcoin, for an address of another form, or without an address', () => {
		expect(
			walletSuggestion({
				address: 'bc1q' + 'a'.repeat(38),
				chains: [HASH_CHAINS.bitcoin],
				wallets: []
			})
		).toBeNull();
		expect(
			walletSuggestion({
				address: 'wolkenfabrik.near:memo',
				chains: [HASH_CHAINS.near],
				wallets: []
			})
		).toBeNull();
		expect(walletSuggestion({ address: '', chains: [HASH_CHAINS.near], wallets: [] })).toBeNull();
	});
});

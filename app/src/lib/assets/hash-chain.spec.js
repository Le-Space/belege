import { describe, expect, it } from 'vitest';

import { chainOfHash, hashUrl, HASH_CHAINS } from './hash-chain.js';

// Made-up hashes, in the forms the chains use.
const CID = `bafy2bzace${'a'.repeat(52)}`;
const EVM = `0x${'ab'.repeat(32)}`;
const HEX = 'cd'.repeat(32);
const SOL = '1'.repeat(44) + 'A'.repeat(44);

const ids = (/** @type {ReturnType<typeof chainOfHash>} */ a) => a.chains.map((c) => c.id);

describe('which chain an exchange’s hash is on (#215)', () => {
	it('a Filecoin message CID is Filecoin, whatever the asset', () => {
		const a = chainOfHash({ hash: CID, asset: 'FIL' });
		expect(ids(a)).toEqual(['filecoin']);
		expect(a.via).toBe('hash-form');
		expect(hashUrl(a.chains[0], CID)).toBe(`https://filfox.info/en/message/${CID}`);
	});

	it('64 hex: Bitcoin for BTC, Nyx for NYM, Akash for AKT; for other assets not clear', () => {
		expect(ids(chainOfHash({ hash: HEX, asset: 'BTC' }))).toEqual(['bitcoin']);
		expect(ids(chainOfHash({ hash: HEX.toUpperCase(), asset: 'NYM' }))).toEqual(['nyx']);
		expect(ids(chainOfHash({ hash: HEX, asset: 'AKT' }))).toEqual(['akash']);
		expect(chainOfHash({ hash: HEX, asset: 'DOT' })).toEqual({ chains: [], via: null });
	});

	it('an EVM hash: the asset’s home where it has one, else every EVM chain as candidates', () => {
		expect(ids(chainOfHash({ hash: EVM, asset: 'POL' }))).toEqual(['polygon']);
		expect(ids(chainOfHash({ hash: EVM, asset: 'ETH' }))).toEqual([
			'ethereum',
			'base',
			'arbitrum',
			'optimism',
			'polygon'
		]);
	});

	it('the exchange’s network name settles it, but only where it fits the hash', () => {
		const arb = chainOfHash({ hash: EVM, asset: 'ETH', method: 'Ether (Arbitrum One)' });
		expect(ids(arb)).toEqual(['arbitrum']);
		expect(arb.via).toBe('method');
		expect(ids(chainOfHash({ hash: EVM, asset: 'USDC', method: 'USDC (ERC20)' }))).toEqual([
			'ethereum'
		]);
		// A name that does not fit the form is passed over.
		expect(ids(chainOfHash({ hash: CID, asset: 'FIL', method: 'Ethereum' }))).toEqual(['filecoin']);
	});

	it('an own wallet with a booking of this hash settles it for good', () => {
		const a = chainOfHash({ hash: EVM, asset: 'ETH', method: 'Ethereum', walletChain: 'base' });
		expect(ids(a)).toEqual(['base']);
		expect(a.via).toBe('wallet');
	});

	it('Solana by its base58 form; anything else is not clear and gets no link', () => {
		expect(ids(chainOfHash({ hash: SOL, asset: 'SOL' }))).toEqual(['solana']);
		expect(chainOfHash({ hash: 'BANKREF-0001', asset: 'EUR' })).toEqual({ chains: [], via: null });
		expect(chainOfHash({ hash: '' })).toEqual({ chains: [], via: null });
	});

	it('every explorer is https and takes the hash', () => {
		for (const c of Object.values(HASH_CHAINS)) {
			expect(c.tx, c.id).toMatch(/^https:\/\/[^/]+\/.*\{tx\}/);
		}
	});
});

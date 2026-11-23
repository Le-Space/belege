import { describe, expect, it } from 'vitest';
import {
	apiService,
	groupWallets,
	rememberTab,
	rememberedTab,
	roundedQuantity,
	syncedAgo,
	walletMatches
} from './wallet-groups.js';

/** @param {string} id @param {string} chain @param {string} [name] */
const w = (id, chain, name = '') =>
	/** @type {import('./wallet-sync.js').Wallet} */ ({ id, chain, address: `0x000${id}`, name });

describe('groupWallets', () => {
	const wallets = [
		w('a', 'ethereum', 'Wallet A'),
		w('b', 'filecoin', 'Wallet B'),
		w('c', 'ethereum', 'Wallet C'),
		w('d', 'akash', 'Wallet D'),
		w('e', 'nyx', 'Wallet E'),
		w('f', 'base', 'Wallet F')
	];
	const values = new Map([
		['ethereum', '5000'],
		['filecoin', '9000'],
		['akash', '10'],
		['nyx', null],
		['base', '700']
	]);

	it('puts failed chains first, then gaps, then by value, then by name', () => {
		const groups = groupWallets({
			wallets,
			values,
			problem: (x) => (x.id === 'd' ? 'error' : x.id === 'c' ? 'gap' : null)
		});
		expect(groups.map((g) => g.chain)).toEqual(['akash', 'ethereum', 'filecoin', 'base', 'nyx']);
		expect(groups[1]).toMatchObject({ total: 2, errors: 0, gaps: 1 });
		expect(groups[1].wallets.map((x) => x.id)).toEqual(['a', 'c']);
	});

	it('orders by name where no chain has a value', () => {
		const groups = groupWallets({
			wallets: [w('a', 'zz'), w('b', 'aa')],
			problem: () => null,
			name: (c) => c
		});
		expect(groups.map((g) => g.chain)).toEqual(['aa', 'zz']);
	});

	it('keeps only what the search finds, and counts the whole chain', () => {
		const groups = groupWallets({
			wallets,
			values,
			problem: () => null,
			found: (x) => x.name === 'Wallet C'
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ chain: 'ethereum', total: 2 });
		expect(groups[0].wallets.map((x) => x.id)).toEqual(['c']);
	});
});

describe('walletMatches', () => {
	const wallet = { name: 'Wallet A', address: '0xABCDEF', chainName: 'Base', assets: ['USDC'] };
	it('finds by name, address, chain and asset, case aside', () => {
		expect(walletMatches('', wallet)).toBe(true);
		expect(walletMatches('wallet a', wallet)).toBe(true);
		expect(walletMatches('abcd', wallet)).toBe(true);
		expect(walletMatches('base', wallet)).toBe(true);
		expect(walletMatches(' usdc ', wallet)).toBe(true);
		expect(walletMatches('eth', wallet)).toBe(false);
	});
});

describe('roundedQuantity', () => {
	const de = { locale: 'de-DE' };
	it('keeps at most four fraction digits, rounded half up', () => {
		expect(roundedQuantity('1234567890123456789012', 18, 'XYZ', de)).toBe('1.234,5679 XYZ');
		expect(roundedQuantity('2999939', 6, 'XMR', de)).toBe('2,9999 XMR');
		expect(roundedQuantity('149995000', 6, '', de)).toBe('149,995');
		expect(roundedQuantity('999960', 6, '', de)).toBe('1');
		expect(roundedQuantity('100000000', 6, '', de)).toBe('100');
		expect(roundedQuantity('0', 18, '', de)).toBe('0');
	});
	it('shows four significant digits below 1, and a floor below 0.0001', () => {
		expect(roundedQuantity('4213370000000001', 18, '', de)).toBe('0,004213');
		expect(roundedQuantity('123456', 9, '', de)).toBe('0,0001235');
		expect(roundedQuantity('10', 6, 'ABC', de)).toBe('< 0,0001 ABC');
		expect(roundedQuantity('-10', 6, '', de)).toBe('> -0,0001');
	});
	it('keeps the sign and the locale', () => {
		expect(roundedQuantity('-1234567', 3, '', de)).toBe('-1.234,567');
		expect(roundedQuantity('1234567', 3, '', { locale: 'en-GB' })).toBe('1,234.567');
	});
});

describe('apiService', () => {
	it('names the API by the chain kind', () => {
		expect(apiService('evm')).toBe('blockscout');
		expect(apiService('bitcoin')).toBe('esplora');
		expect(apiService('filecoin')).toBe('filfox');
		expect(apiService('near')).toBe('nearblocks');
		expect(apiService('cosmos')).toBeNull();
	});
});

describe('syncedAgo', () => {
	const now = Date.parse('2026-01-31T12:00:00Z');
	it('says when, in steps', () => {
		expect(syncedAgo(undefined, now)).toEqual({ key: 'never' });
		expect(syncedAgo('2026-01-31T11:30:00Z', now)).toEqual({ key: 'now' });
		expect(syncedAgo('2026-01-31T09:00:00Z', now)).toEqual({ key: 'hours', count: 3 });
		expect(syncedAgo('2026-01-30T10:00:00Z', now)).toEqual({ key: 'yesterday' });
		expect(syncedAgo('2026-01-26T12:00:00Z', now)).toEqual({ key: 'days', count: 5 });
		expect(syncedAgo('2025-11-02T12:00:00Z', now)).toEqual({ key: 'date', date: '2025-11-02' });
	});
});

describe('the remembered tab', () => {
	it('keeps a known tab and falls back to the list', () => {
		/** @type {Map<string, string>} */
		const m = new Map();
		const storage = {
			getItem: (/** @type {string} */ k) => m.get(k) ?? null,
			setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, v)
		};
		expect(rememberedTab(storage)).toBe('wallets');
		rememberTab('statements', storage);
		expect(rememberedTab(storage)).toBe('statements');
		m.set('belege.walletsTab', 'nonsense');
		expect(rememberedTab(storage)).toBe('wallets');
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			}
		};
		expect(rememberedTab(broken)).toBe('wallets');
	});
});

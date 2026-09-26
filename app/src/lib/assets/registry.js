// The assets Belege knows: currencies and crypto assets an account can hold.
//
// A crypto account holds one asset. Its transactions keep the amount of that
// asset exactly, as an integer of the smallest unit (satoshi, wei, uNYM) in a
// string, next to the euro amount they are booked with (valuation.js).
//
// `symbol` is the key Belege uses everywhere, also towards the bridge's rate
// sources (bridge/src/rates.js RATE_SOURCES). `caip19` names the asset in a
// chain-agnostic way (CAIP-19) where it is certain; the others get theirs
// when their connector is built.

/**
 * @typedef {object} Asset
 * @property {string} symbol
 * @property {string} name
 * @property {number} decimals digits of the smallest unit
 * @property {'fiat' | 'crypto'} kind
 * @property {string | null} chain CAIP-2 chain id, null for fiat
 * @property {string | null} caip19
 * @property {string | null} [denom] the chain's base denomination (Cosmos)
 */

/** @type {Readonly<Record<string, Asset>>} */
export const ASSETS = Object.freeze({
	EUR: { symbol: 'EUR', name: 'Euro', decimals: 2, kind: 'fiat', chain: null, caip19: null },
	USD: { symbol: 'USD', name: 'US-Dollar', decimals: 2, kind: 'fiat', chain: null, caip19: null },
	BTC: {
		symbol: 'BTC',
		name: 'Bitcoin',
		decimals: 8,
		kind: 'crypto',
		chain: 'bip122:000000000019d6689c085ae165831e93',
		caip19: 'bip122:000000000019d6689c085ae165831e93/slip44:0'
	},
	ETH: {
		symbol: 'ETH',
		name: 'Ether',
		decimals: 18,
		kind: 'crypto',
		chain: 'eip155:1',
		caip19: 'eip155:1/slip44:60'
	},
	USDC: {
		symbol: 'USDC',
		name: 'USD Coin',
		decimals: 6,
		kind: 'crypto',
		chain: 'eip155:1',
		caip19: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
	},
	ALEPH: {
		symbol: 'ALEPH',
		name: 'Aleph',
		decimals: 18,
		kind: 'crypto',
		chain: 'eip155:1',
		caip19: null
	},
	NYM: {
		symbol: 'NYM',
		name: 'NYM',
		decimals: 6,
		kind: 'crypto',
		chain: 'cosmos:nyx',
		caip19: null,
		denom: 'unym'
	},
	NYX: {
		symbol: 'NYX',
		name: 'NYX (Nyx-Staking)',
		decimals: 6,
		kind: 'crypto',
		chain: 'cosmos:nyx',
		caip19: null,
		denom: 'unyx'
	},
	AKT: {
		symbol: 'AKT',
		name: 'Akash',
		decimals: 6,
		kind: 'crypto',
		chain: 'cosmos:akashnet-2',
		caip19: null,
		denom: 'uakt'
	},
	POL: {
		symbol: 'POL',
		name: 'Polygon',
		decimals: 18,
		kind: 'crypto',
		chain: 'eip155:137',
		caip19: null
	},
	FIL: { symbol: 'FIL', name: 'Filecoin', decimals: 18, kind: 'crypto', chain: null, caip19: null }
});

/**
 * @param {string | null | undefined} symbol
 * @returns {Asset | null}
 */
export function assetOf(symbol) {
	const key = String(symbol ?? '').toUpperCase();
	return Object.hasOwn(ASSETS, key) ? ASSETS[key] : null;
}

/** @param {string | null | undefined} symbol */
export function isCrypto(symbol) {
	return assetOf(symbol)?.kind === 'crypto';
}

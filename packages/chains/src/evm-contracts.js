// SPDX-License-Identifier: AGPL-3.0-or-later
// The EVM contracts a swap is named after, on their own so that the EVM
// reader does not bundle every chain's data (registry.js re-exports them).

/**
 * Contracts a wallet meets when it swaps (issue #115), by their lower-case
 * address, and what they are called. Routers of the big aggregators and DEXes
 * sit at the same address on most EVM chains; WETH is Ethereum's. Checked
 * against the projects' own documentation; an address not here stays
 * "Vertrag".
 */
export const KNOWN_EVM_CONTRACTS = /** @type {Readonly<Record<string, string>>} */ (
	Object.freeze({
		'0x881d40237659c251811cec9c364ef91dc08d300c': 'MetaMask Swap (Router)',
		'0x74de5d4fcbf63e00296fd95d33236b9794016631': 'MetaMask Swap (Spender)',
		'0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap (Universal Router)',
		'0x66a9893cc07d91d95644aedd05d03f95e1dba8af': 'Uniswap (Universal Router v4)',
		'0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 (Router)',
		'0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 (Router)',
		'0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3 (Router 2)',
		'0x1111111254eeb25477b68fb85ed929f73a960582': '1inch (Router v5)',
		'0x111111125421ca6dc452d289314280a0f8842a65': '1inch (Router v6)',
		'0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x (Exchange Proxy)',
		'0x9008d19f58aabd9ed0d60971565aa8510560ab41': 'CoW Protocol (Settlement)',
		'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH'
	})
);

// The chains a wallet can be on, and what the bridge needs to read one:
// the kind of API, the address format, the assets it books, the default
// endpoints and the block explorer to link to.
//
// Two kinds so far:
//   cosmos  CometBFT RPC (tx_search, header, status) + the REST (LCD) API
//           for balances. Nym's Nyx and Akash.
//   evm     Blockscout's Etherscan-compatible API (`/api?module=account…`),
//           no key needed. Ethereum, Base, Arbitrum, Optimism, Polygon.
//
// Only assets listed here are booked. A Cosmos denom or an ERC-20 contract
// that is not listed is counted and left out: a token contract can name
// itself "USDC" and be worthless, so a symbol is never taken from the chain.
//
// Where each value comes from, and what was checked on 2026-09-26, is in
// docs/crypto.md ("Own wallets").

/**
 * @typedef {object} ChainAsset
 * @property {string} symbol as in the app's assets/registry.js and the bridge's rates.js
 * @property {number} decimals
 */

/**
 * @typedef {object} Explorer
 * @property {string} name
 * @property {string} tx URL with `{tx}`
 * @property {string} address URL with `{address}`
 */

/**
 * @typedef {object} CosmosChain
 * @property {string} id
 * @property {'cosmos'} kind
 * @property {string} name
 * @property {string} shortName in account names: `Wallet USDC (Base) ···…`
 * @property {string} chainId
 * @property {string} caip2
 * @property {string} bech32Prefix
 * @property {string} nativeDenom
 * @property {Record<string, ChainAsset>} denoms base denom → asset
 * @property {{ rpc: string, rest: string }} endpoints the defaults
 * @property {{ rpc: string[], rest: string[] }} alternatives also public, e.g. an archive node
 * @property {Explorer} explorer
 */

/**
 * @typedef {object} EvmChain
 * @property {string} id
 * @property {'evm'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {number} chainId
 * @property {string} caip2
 * @property {ChainAsset} native
 * @property {Record<string, ChainAsset>} tokens lower-case contract address → asset
 * @property {{ api: string }} endpoints Blockscout, …/api
 * @property {{ api: string[] }} alternatives
 * @property {Explorer} explorer
 */

/** @typedef {CosmosChain | EvmChain} Chain */

const USDC = { symbol: 'USDC', decimals: 6 };
const ETH = { symbol: 'ETH', decimals: 18 };

/** @param {string} base e.g. https://etherscan.io */
const etherscanLike = (/** @type {string} */ name, /** @type {string} */ base) => ({
	name,
	tx: `${base}/tx/{tx}`,
	address: `${base}/address/{address}`
});

/** @type {Readonly<Record<string, Chain>>} */
export const CHAINS = Object.freeze({
	nyx: {
		id: 'nyx',
		kind: 'cosmos',
		name: 'Nym (Nyx)',
		shortName: 'Nyx',
		chainId: 'nyx',
		caip2: 'cosmos:nyx',
		bech32Prefix: 'n',
		nativeDenom: 'unym',
		denoms: {
			unym: { symbol: 'NYM', decimals: 6 },
			unyx: { symbol: 'NYX', decimals: 6 }
		},
		endpoints: { rpc: 'https://rpc.nymtech.net', rest: 'https://api.nymtech.net' },
		// Nym's own RPC keeps only the recent part of the chain (pruned);
		// Nodes Guru's goes back to the first block.
		alternatives: {
			rpc: ['https://rpc.nyx.nodes.guru'],
			rest: ['https://api.nyx.nodes.guru']
		},
		explorer: {
			name: 'Nym Explorer (Nodes Guru)',
			tx: 'https://nym.explorers.guru/transaction/{tx}',
			address: 'https://nym.explorers.guru/account/{address}'
		}
	},
	akash: {
		id: 'akash',
		kind: 'cosmos',
		name: 'Akash',
		shortName: 'Akash',
		chainId: 'akashnet-2',
		caip2: 'cosmos:akashnet-2',
		bech32Prefix: 'akash',
		nativeDenom: 'uakt',
		denoms: { uakt: { symbol: 'AKT', decimals: 6 } },
		// Akash runs no public RPC of its own; Polkachu's is in the chain registry.
		endpoints: {
			rpc: 'https://akash-rpc.polkachu.com',
			rest: 'https://akash-api.polkachu.com'
		},
		alternatives: {
			rpc: ['https://rpc-akash.ecostake.com'],
			rest: ['https://rest-akash.ecostake.com']
		},
		explorer: {
			name: 'Mintscan',
			tx: 'https://www.mintscan.io/akash/transactions/{tx}',
			address: 'https://www.mintscan.io/akash/accounts/{address}'
		}
	},
	ethereum: {
		id: 'ethereum',
		kind: 'evm',
		name: 'Ethereum',
		shortName: 'Ethereum',
		chainId: 1,
		caip2: 'eip155:1',
		native: ETH,
		tokens: { '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': USDC },
		endpoints: { api: 'https://eth.blockscout.com/api' },
		alternatives: { api: [] },
		explorer: etherscanLike('Etherscan', 'https://etherscan.io')
	},
	base: {
		id: 'base',
		kind: 'evm',
		name: 'Base',
		shortName: 'Base',
		chainId: 8453,
		caip2: 'eip155:8453',
		native: ETH,
		tokens: { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': USDC },
		endpoints: { api: 'https://base.blockscout.com/api' },
		alternatives: { api: [] },
		explorer: etherscanLike('Basescan', 'https://basescan.org')
	},
	arbitrum: {
		id: 'arbitrum',
		kind: 'evm',
		name: 'Arbitrum One',
		shortName: 'Arbitrum',
		chainId: 42161,
		caip2: 'eip155:42161',
		native: ETH,
		tokens: { '0xaf88d065e77c8cc2239327c5edb3a432268e5831': USDC },
		endpoints: { api: 'https://arbitrum.blockscout.com/api' },
		alternatives: { api: [] },
		explorer: etherscanLike('Arbiscan', 'https://arbiscan.io')
	},
	optimism: {
		id: 'optimism',
		kind: 'evm',
		name: 'OP Mainnet',
		shortName: 'Optimism',
		chainId: 10,
		caip2: 'eip155:10',
		native: ETH,
		tokens: { '0x0b2c639c533813f4aa9d7837caf62653d097ff85': USDC },
		endpoints: { api: 'https://explorer.optimism.io/api' },
		alternatives: { api: [] },
		explorer: etherscanLike('Optimistic Etherscan', 'https://optimistic.etherscan.io')
	},
	polygon: {
		id: 'polygon',
		kind: 'evm',
		name: 'Polygon PoS',
		shortName: 'Polygon',
		chainId: 137,
		caip2: 'eip155:137',
		native: { symbol: 'POL', decimals: 18 },
		tokens: { '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': USDC },
		endpoints: { api: 'https://polygon.blockscout.com/api' },
		alternatives: { api: [] },
		explorer: etherscanLike('Polygonscan', 'https://polygonscan.com')
	}
});

/** @param {string} id @returns {Chain | null} */
export function chainOf(id) {
	return typeof id === 'string' && Object.hasOwn(CHAINS, id) ? CHAINS[id] : null;
}

/** @param {Explorer} explorer @param {string} tx */
export const txUrl = (explorer, tx) => explorer.tx.replace('{tx}', encodeURIComponent(tx));
/** @param {Explorer} explorer @param {string} address */
export const addressUrl = (explorer, address) =>
	explorer.address.replace('{address}', encodeURIComponent(address));

/**
 * What the app is told about the chains: everything but code.
 */
export function publicChains() {
	return Object.values(CHAINS).map((c) => ({
		id: c.id,
		kind: c.kind,
		name: c.name,
		shortName: c.shortName,
		caip2: c.caip2,
		...(c.kind === 'cosmos'
			? {
					bech32Prefix: c.bech32Prefix,
					assets: Object.values(c.denoms).map((a) => a.symbol),
					nativeSymbol: c.denoms[c.nativeDenom].symbol
				}
			: {
					assets: [c.native.symbol, ...Object.values(c.tokens).map((a) => a.symbol)],
					nativeSymbol: c.native.symbol
				}),
		endpoints: c.endpoints,
		alternatives: c.alternatives,
		explorer: c.explorer
	}));
}

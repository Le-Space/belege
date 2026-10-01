// The chains a wallet can be on, and what the bridge needs to read one:
// the kind of API, the address format, the assets it books, the default
// endpoints and the block explorer to link to.
//
// Three kinds:
//   cosmos   CometBFT RPC (tx_search, header, status) + the REST (LCD) API
//            for balances. Nym's Nyx and Akash.
//   evm      Blockscout's Etherscan-compatible API (`/api?module=account…`),
//            no key needed. Ethereum, Base, Arbitrum, Optimism, Polygon.
//            With an Alchemy key (`pnpm setup:alchemy`) Alchemy instead
//            (chains/alchemy.js); the network names are below.
//   bitcoin  an Esplora API (mempool.space), read by the addresses derived
//            from a zpub kept in the bridge's keychain (bitcoin.js).
//   filecoin Filfox's public API, by the address (filecoin.js).
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
 * @property {{ rpc: string, rest: string, indexer?: string }} endpoints the defaults; `indexer`: the
 *   Akash Console indexer, read for what the pruned node no longer knows (akash-console.js)
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
 * @property {AlchemyNetwork} [alchemy] read through Alchemy instead, when a key is set up
 */

/**
 * @typedef {object} AlchemyNetwork
 * @property {string} network the host's first label: `https://<network>.g.alchemy.com/v2/<key>`
 * @property {boolean} internal whether alchemy_getAssetTransfers offers the category `internal`
 *   there; where it does not, internal transactions still come from Blockscout
 */

/**
 * @typedef {object} BitcoinChain
 * @property {string} id
 * @property {'bitcoin'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} caip2
 * @property {ChainAsset} native
 * @property {{ api: string }} endpoints an Esplora API, …/api
 * @property {{ api: string[] }} alternatives
 * @property {Explorer} explorer
 */

/**
 * @typedef {object} FilecoinChain
 * @property {string} id
 * @property {'filecoin'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} caip2
 * @property {ChainAsset} native
 * @property {{ api: string }} endpoints Filfox's API, …/api/v1
 * @property {{ api: string[] }} alternatives
 * @property {Explorer} explorer
 */

/** @typedef {CosmosChain | EvmChain | BitcoinChain | FilecoinChain} Chain */

const USDC = { symbol: 'USDC', decimals: 6 };
const ETH = { symbol: 'ETH', decimals: 18 };

/** @param {string} base e.g. https://etherscan.io */
const etherscanLike = (/** @type {string} */ name, /** @type {string} */ base) => ({
	name,
	tx: `${base}/tx/{tx}`,
	address: `${base}/address/{address}`
});

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
		// Akash runs no public RPC of its own, and the public ones are pruned:
		// checked 2026-09-27, PublicNode's keeps the longest history (from
		// 2026-05-25), Polkachu's and Ecostake's only a few weeks (issue #105).
		// The history before the node's window comes from the Akash Console
		// indexer (akash-console.js, issue #105).
		endpoints: {
			rpc: 'https://akash-rpc.publicnode.com',
			rest: 'https://akash-rest.publicnode.com',
			indexer: 'https://console-api.akash.network'
		},
		alternatives: {
			rpc: ['https://akash-rpc.polkachu.com', 'https://rpc-akash.ecostake.com'],
			rest: ['https://akash-api.polkachu.com', 'https://rest-akash.ecostake.com']
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
		explorer: etherscanLike('Etherscan', 'https://etherscan.io'),
		alchemy: { network: 'eth-mainnet', internal: true }
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
		explorer: etherscanLike('Basescan', 'https://basescan.org'),
		alchemy: { network: 'base-mainnet', internal: true }
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
		explorer: etherscanLike('Arbiscan', 'https://arbiscan.io'),
		alchemy: { network: 'arb-mainnet', internal: false }
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
		explorer: etherscanLike('Optimistic Etherscan', 'https://optimistic.etherscan.io'),
		alchemy: { network: 'opt-mainnet', internal: false }
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
		explorer: etherscanLike('Polygonscan', 'https://polygonscan.com'),
		alchemy: { network: 'polygon-mainnet', internal: true }
	},
	bitcoin: {
		id: 'bitcoin',
		kind: 'bitcoin',
		name: 'Bitcoin',
		shortName: 'Bitcoin',
		caip2: 'bip122:000000000019d6689c085ae165831e93',
		native: { symbol: 'BTC', decimals: 8 },
		endpoints: { api: 'https://mempool.space/api' },
		alternatives: { api: ['https://blockstream.info/api'] },
		explorer: {
			name: 'mempool.space',
			tx: 'https://mempool.space/tx/{tx}',
			address: 'https://mempool.space/address/{address}'
		}
	},
	// Read through Filfox, by address; a message CID is the hash (filecoin.js).
	filecoin: {
		id: 'filecoin',
		kind: 'filecoin',
		name: 'Filecoin',
		shortName: 'Filecoin',
		caip2: 'fil:f',
		native: { symbol: 'FIL', decimals: 18 },
		endpoints: { api: 'https://filfox.info/api/v1' },
		alternatives: { api: [] },
		explorer: {
			name: 'Filfox',
			tx: 'https://filfox.info/en/message/{tx}',
			address: 'https://filfox.info/en/address/{address}'
		}
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
			: c.kind === 'evm'
				? {
						assets: [c.native.symbol, ...Object.values(c.tokens).map((a) => a.symbol)],
						nativeSymbol: c.native.symbol
					}
				: { assets: [c.native.symbol], nativeSymbol: c.native.symbol }),
		endpoints: c.endpoints,
		alternatives: c.alternatives,
		// Whether Alchemy reads this chain when a key is set up, and its internal transfers too.
		...(c.kind === 'evm'
			? { alchemySupported: Boolean(c.alchemy), alchemyInternal: Boolean(c.alchemy?.internal) }
			: {}),
		explorer: c.explorer
	}));
}

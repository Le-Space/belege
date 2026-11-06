// The Cosmos chains the bridge reads (#105, #264): Nym's Nyx and Akash –
// their denoms, default endpoints (CometBFT RPC, REST, Akash's indexer) and
// explorers.

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
 * @property {Record<string, import('@belege/chain-core/entry').ChainAsset>} denoms base denom → asset
 * @property {{ rpc: string, rest: string, indexer?: string }} endpoints the defaults; `indexer`: the
 *   Akash Console indexer, read for what the pruned node no longer knows (akash-console.js)
 * @property {{ rpc: string[], rest: string[] }} alternatives also public, e.g. an archive node
 * @property {import('@belege/chain-core/explorer').Explorer} explorer
 */

/** @type {CosmosChain} */
export const NYX_CHAIN = {
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
};

/** @type {CosmosChain} */
export const AKASH_CHAIN = {
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
};

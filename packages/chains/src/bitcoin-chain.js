// SPDX-License-Identifier: AGPL-3.0-or-later
// Bitcoin as a chain a reader asks: its coin, its address prefixes, the
// Esplora API (mempool.space by default) and the explorer. The registry and
// the reader of one address (bitcoin-address.js) share it, so the reader
// bundles without the registry.

/** @type {import('./registry.js').BitcoinChain & { address: { bech32: string, pubKeyHash: number, scriptHash: number } }} */
export const BITCOIN = {
	id: 'bitcoin',
	kind: 'bitcoin',
	name: 'Bitcoin',
	shortName: 'Bitcoin',
	caip2: 'bip122:000000000019d6689c085ae165831e93',
	native: { symbol: 'BTC', decimals: 8 },
	// P2PKH addresses start with 1, P2SH with 3, SegWit and Taproot with bc1.
	address: { bech32: 'bc', pubKeyHash: 0, scriptHash: 5 },
	endpoints: { api: 'https://mempool.space/api' },
	alternatives: { api: ['https://blockstream.info/api'] },
	explorer: {
		name: 'mempool.space',
		tx: 'https://mempool.space/tx/{tx}',
		address: 'https://mempool.space/address/{address}'
	}
};

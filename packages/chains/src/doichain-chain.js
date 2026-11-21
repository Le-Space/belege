// SPDX-License-Identifier: AGPL-3.0-or-later
// Doichain as a chain a reader asks (issue #884): its coin, its address
// prefixes (from Doichain Core's chainparams, as @doichain/doichainjs-lib has
// them), public ElectrumX servers over WebSocket, the block that tells the
// valid chain from the old one, and the explorer.
//
// Since Doichain Core v31 there are two chains with one genesis block: the
// rules of v31 took effect at block 431,017, and at 431,018 the old nodes
// went their own way. Only the v31 chain counts. A server is asked for the
// header at 431,018 before anything is read from it (doichain.js
// `verifyChain`); the CAIP-2 id alone cannot tell the two apart.

/**
 * @typedef {object} DoichainChain
 * @property {string} id
 * @property {'doichain'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} caip2
 * @property {import('@le-space/ledger/wallet-entry').ChainAsset} native
 * @property {{ bech32: string, pubKeyHash: number, scriptHash: number }} address
 * @property {{ height: number, hash: string }} checkpoint the first block only the valid chain has
 * @property {{ electrum: string[] }} endpoints ElectrumX servers, `wss://host:port`, tried in order
 * @property {{ electrum: string[] }} alternatives
 * @property {import('./explorer.js').Explorer} explorer
 */

/** @type {DoichainChain} */
export const DOICHAIN = {
	id: 'doichain',
	kind: 'doichain',
	name: 'Doichain',
	shortName: 'Doichain',
	caip2: 'bip122:000006fdd8b4d786fd9bdde5bae9486c',
	native: { symbol: 'DOI', decimals: 8 },
	// P2PKH addresses start with M or N, P2SH with 6, SegWit with dc1.
	address: { bech32: 'dc', pubKeyHash: 52, scriptHash: 13 },
	checkpoint: {
		height: 431018,
		hash: '71d50ff12b090561cc918ddb560334b4350758c7eace3f058dd332fb112f4b67'
	},
	// Checked 2026-11-21: each answers over wss with a valid certificate,
	// follows the valid chain and takes blockchain.transaction.broadcast.
	endpoints: {
		electrum: [
			'wss://big-parrot-60.doi.works:50004',
			'wss://ugly-bird-70.doi.works:50004',
			'wss://pink-deer-69.doi.works:50004',
			'wss://itchy-jellyfish-89.doi.works:50004'
		]
	},
	alternatives: { electrum: [] },
	explorer: {
		name: 'Doichain Explorer',
		tx: 'https://doi-explorer.le-space.de/tx/{tx}',
		address: 'https://doi-explorer.le-space.de/address/{address}'
	}
};

// Filecoin as a chain the bridge reads (#242): its assets, the FEVM tokens
// and contracts listed for it, Filfox as the default API and explorer.

/**
 * @typedef {object} FilecoinChain
 * @property {string} id
 * @property {'filecoin'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} caip2
 * @property {import('@le-space/ledger/wallet-entry').ChainAsset} native
 * @property {Record<string, import('@le-space/ledger/wallet-entry').ChainAsset>} tokens FEVM ERC-20s booked here: lower-case `0x` contract → asset
 * @property {Record<string, string>} contracts FEVM contracts a swap is named after: lower-case `0x` → name
 * @property {{ api: string }} endpoints Filfox's API, …/api/v1
 * @property {{ api: string[] }} alternatives
 * @property {import('./explorer.js').Explorer} explorer
 */

/** @type {FilecoinChain} */
export const FILECOIN = {
	id: 'filecoin',
	kind: 'filecoin',
	name: 'Filecoin',
	shortName: 'Filecoin',
	caip2: 'fil:f',
	native: { symbol: 'FIL', decimals: 18 },
	// USDFC, Secured Finance's FIL-backed stablecoin (issue #301): checked
	// 2026-10-05 against Secured Finance's contract list, CoinGecko's
	// platform entry and the contract's own symbol() and decimals().
	tokens: { '0x80b98d3aa09ffff255c3ba4a241111ff1262f045': { symbol: 'USDFC', decimals: 18 } },
	// From Sushi's own config (sushi-labs/sushi, src/evm/config): the
	// router its app sends swaps through, its V2 router, and the wrapped FIL.
	contracts: {
		'0xac4c6e212a361c968f1725b4d055b47e63f80b75': 'SushiSwap',
		'0x46b3fdf7b5cde91ac049936bf0bdb12c5d22202e': 'SushiSwap V2 (Router)',
		'0x60e1773636cf5e4a227d9ac24f20feca034ee25a': 'WFIL'
	},
	endpoints: { api: 'https://filfox.info/api/v1' },
	alternatives: { api: [] },
	explorer: {
		name: 'Filfox',
		tx: 'https://filfox.info/en/message/{tx}',
		address: 'https://filfox.info/en/address/{address}'
	}
};

// Which blockchain a transaction hash is on, for a deposit to or a withdrawal
// from an exchange (issue #215), and where to look it up. Pure; nothing is
// asked of any explorer – a link opens only on the person's click.
//
// Settled, in this order:
//   1. an own wallet in the books with a booking of the same hash (`wallet`);
//   2. the network the exchange named for it, e.g. Kraken's `Filecoin` or
//      `Ether (Arbitrum One)` (`method`);
//   3. the hash's form together with the asset (`hash-form`):
//        CID `bafy2bzace…`                → Filecoin (a message id)
//        `0x` + 64 hex                    → an EVM chain; the asset's home
//                                           where it has one (POL → Polygon),
//                                           else every EVM chain, unclear
//        64 hex                           → Bitcoin for BTC; Nyx for NYM,
//                                           Akash for AKT
//        base58, 87–88 characters         → Solana
//   Anything else: not clear, and no link.

/**
 * @typedef {object} HashChain a chain an exchange's hash can be on
 * @property {string} id
 * @property {string} name
 * @property {string} explorer the explorer's name
 * @property {string} tx https template with `{tx}`
 */

/** @type {Readonly<Record<string, HashChain>>} */
export const HASH_CHAINS = Object.freeze({
	filecoin: {
		id: 'filecoin',
		name: 'Filecoin',
		explorer: 'Filfox',
		tx: 'https://filfox.info/en/message/{tx}'
	},
	bitcoin: {
		id: 'bitcoin',
		name: 'Bitcoin',
		explorer: 'mempool.space',
		tx: 'https://mempool.space/tx/{tx}'
	},
	ethereum: {
		id: 'ethereum',
		name: 'Ethereum',
		explorer: 'Etherscan',
		tx: 'https://etherscan.io/tx/{tx}'
	},
	base: { id: 'base', name: 'Base', explorer: 'Basescan', tx: 'https://basescan.org/tx/{tx}' },
	arbitrum: {
		id: 'arbitrum',
		name: 'Arbitrum One',
		explorer: 'Arbiscan',
		tx: 'https://arbiscan.io/tx/{tx}'
	},
	optimism: {
		id: 'optimism',
		name: 'OP Mainnet',
		explorer: 'Optimistic Etherscan',
		tx: 'https://optimistic.etherscan.io/tx/{tx}'
	},
	polygon: {
		id: 'polygon',
		name: 'Polygon PoS',
		explorer: 'Polygonscan',
		tx: 'https://polygonscan.com/tx/{tx}'
	},
	nyx: {
		id: 'nyx',
		name: 'Nym (Nyx)',
		explorer: 'Nym Explorer (Nodes Guru)',
		tx: 'https://nym.explorers.guru/transaction/{tx}'
	},
	akash: {
		id: 'akash',
		name: 'Akash',
		explorer: 'Mintscan',
		tx: 'https://www.mintscan.io/akash/transactions/{tx}'
	},
	solana: { id: 'solana', name: 'Solana', explorer: 'Solscan', tx: 'https://solscan.io/tx/{tx}' }
});

const EVM = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'];

/** A network name as an exchange writes it → a chain; the more specific first. */
const METHOD_WORDS = /** @type {const} */ ([
	[/arbitrum/i, 'arbitrum'],
	[/optimism|\bop mainnet\b/i, 'optimism'],
	[/\bbase\b/i, 'base'],
	[/polygon|\bmatic\b/i, 'polygon'],
	[/filecoin|\bfil\b/i, 'filecoin'],
	[/solana|\bspl\b/i, 'solana'],
	[/akash/i, 'akash'],
	[/\bnym\b|\bnyx\b/i, 'nyx'],
	[/bitcoin|\bbtc\b/i, 'bitcoin'],
	[/ethereum|\bether\b|erc-?20/i, 'ethereum']
]);

/** The chain an asset lives on natively, where the asset says so. */
const HOME = /** @type {Record<string, string>} */ ({
	BTC: 'bitcoin',
	FIL: 'filecoin',
	NYM: 'nyx',
	AKT: 'akash',
	POL: 'polygon',
	SOL: 'solana'
});

/**
 * @typedef {object} ChainAnswer
 * @property {HashChain[]} chains one when clear; several when it is one of them; none when not clear
 * @property {'wallet' | 'method' | 'hash-form' | null} via how it was found
 */

/**
 * @param {object} params
 * @param {string} params.hash the on-chain hash (`chainTxRef`)
 * @param {string} [params.asset] the booking's asset symbol
 * @param {string} [params.method] the exchange's name for the network
 * @param {string | null} [params.walletChain] the chain of an own wallet's booking with this hash
 * @returns {ChainAnswer}
 */
export function chainOfHash({ hash, asset = '', method = '', walletChain = null }) {
	const h = String(hash ?? '').trim();
	/** @param {string[]} ids @param {ChainAnswer['via']} via */
	const answer = (ids, via) => ({ chains: ids.map((id) => HASH_CHAINS[id]).filter(Boolean), via });
	if (!h) return answer([], null);
	if (walletChain && HASH_CHAINS[walletChain]) return answer([walletChain], 'wallet');

	const form = formOf(h);
	if (method) {
		const named = METHOD_WORDS.find(([re]) => re.test(method))?.[1];
		// The network must fit the hash's form: an exchange's method never overrides it.
		if (named && fits(named, form)) return answer([named], 'method');
	}
	const home = HOME[String(asset).toUpperCase()];
	if (form === 'cid') return answer(['filecoin'], 'hash-form');
	if (form === 'solana') return answer(['solana'], 'hash-form');
	if (form === 'evm') {
		return home && EVM.includes(home) ? answer([home], 'hash-form') : answer(EVM, 'hash-form');
	}
	if (form === 'hex64') {
		if (home === 'bitcoin' || home === 'nyx' || home === 'akash')
			return answer([home], 'hash-form');
		return answer([], null);
	}
	return answer([], null);
}

/** @param {string} h @returns {'cid' | 'evm' | 'hex64' | 'solana' | null} */
function formOf(h) {
	if (/^bafy2bzace[a-z2-7]{40,}$/.test(h)) return 'cid';
	if (/^0x[0-9a-fA-F]{64}$/.test(h)) return 'evm';
	if (/^[0-9a-fA-F]{64}$/.test(h)) return 'hex64';
	if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(h)) return 'solana';
	return null;
}

/** @param {string} chain @param {ReturnType<typeof formOf>} form */
function fits(chain, form) {
	if (chain === 'filecoin') return form === 'cid';
	if (chain === 'solana') return form === 'solana';
	if (EVM.includes(chain)) return form === 'evm';
	return form === 'hex64';
}

/** The explorer link for a hash on a chain. @param {HashChain} chain @param {string} hash */
export const hashUrl = (chain, hash) =>
	chain.tx.replace('{tx}', encodeURIComponent(String(hash).trim()));

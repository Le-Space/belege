// The chains an own wallet can be on, as the app needs them without asking
// the bridge: names for accounts and the Verlauf, the kind of address, the
// native asset. Endpoints and explorers come from the bridge (GET /chains,
// bridge/src/chains/registry.js); wallets.spec.js checks both tables agree.
//
// A wallet's accounts carry the chain's id as their `source` (`nyx`,
// `ethereum`, …), one account per asset.

import { isEthStyle, toFilecoinAddress } from './filecoin-address.js';

/**
 * @typedef {object} WalletChain
 * @property {string} id
 * @property {'cosmos' | 'evm' | 'bitcoin' | 'filecoin' | 'monero'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string} nativeSymbol
 * @property {string} caip2 the chain as CAIP-2, as the bridge's registry names it
 * @property {number | null} nativeSlip44 the native asset's SLIP-44 coin type, for its CAIP-19 id
 *   (`<caip2>/slip44:<n>`); null where no such id is established (Cosmos denoms, Monero)
 * @property {Readonly<Record<string, string>>} [tokens] evm and filecoin (FEVM): symbol → lower-case contract
 *   of the tokens the bridge books there (registry.js `tokens`)
 * @property {string} [evmCaip2] filecoin only: the FEVM's CAIP-2, for its tokens' CAIP-19
 * @property {string} [bech32Prefix] cosmos only
 */

/** @type {Readonly<Record<string, WalletChain>>} */
export const WALLET_CHAINS = Object.freeze({
	nyx: {
		id: 'nyx',
		kind: 'cosmos',
		name: 'Nym (Nyx)',
		shortName: 'Nyx',
		nativeSymbol: 'NYM',
		caip2: 'cosmos:nyx',
		nativeSlip44: null,
		bech32Prefix: 'n'
	},
	akash: {
		id: 'akash',
		kind: 'cosmos',
		name: 'Akash',
		shortName: 'Akash',
		nativeSymbol: 'AKT',
		caip2: 'cosmos:akashnet-2',
		nativeSlip44: null,
		bech32Prefix: 'akash'
	},
	ethereum: {
		id: 'ethereum',
		kind: 'evm',
		name: 'Ethereum',
		shortName: 'Ethereum',
		nativeSymbol: 'ETH',
		caip2: 'eip155:1',
		nativeSlip44: 60,
		tokens: { USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }
	},
	base: {
		id: 'base',
		kind: 'evm',
		name: 'Base',
		shortName: 'Base',
		nativeSymbol: 'ETH',
		caip2: 'eip155:8453',
		nativeSlip44: 60,
		tokens: { USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }
	},
	arbitrum: {
		id: 'arbitrum',
		kind: 'evm',
		name: 'Arbitrum One',
		shortName: 'Arbitrum',
		nativeSymbol: 'ETH',
		caip2: 'eip155:42161',
		nativeSlip44: 60,
		tokens: { USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' }
	},
	optimism: {
		id: 'optimism',
		kind: 'evm',
		name: 'OP Mainnet',
		shortName: 'Optimism',
		nativeSymbol: 'ETH',
		caip2: 'eip155:10',
		nativeSlip44: 60,
		tokens: { USDC: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' }
	},
	polygon: {
		id: 'polygon',
		kind: 'evm',
		name: 'Polygon PoS',
		shortName: 'Polygon',
		nativeSymbol: 'POL',
		caip2: 'eip155:137',
		nativeSlip44: 966,
		tokens: { USDC: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' }
	},
	// The key stays in the bridge's keychain; the app knows the wallet by the
	// key's fingerprint (`btc-…`), taken from the bridge (bridge/src/chains/bitcoin.js).
	bitcoin: {
		id: 'bitcoin',
		kind: 'bitcoin',
		name: 'Bitcoin',
		shortName: 'Bitcoin',
		nativeSymbol: 'BTC',
		caip2: 'bip122:000000000019d6689c085ae165831e93',
		nativeSlip44: 0
	},
	// Read by address through Filfox; a message CID is the hash, the same an
	// exchange reports for a deposit (bridge/src/chains/filecoin.js).
	filecoin: {
		id: 'filecoin',
		kind: 'filecoin',
		name: 'Filecoin',
		shortName: 'Filecoin',
		nativeSymbol: 'FIL',
		caip2: 'fil:f',
		nativeSlip44: 461,
		// FEVM tokens, by contract (#301); their CAIP-19 is on the FEVM's chain id.
		tokens: { USDFC: '0x80b98d3aa09ffff255c3ba4a241111ff1262f045' },
		evmCaip2: 'eip155:314'
	},
	// Not read by address: Monero hides amounts and parties on its chain. The
	// wallet's own export is imported in the browser (monero-import.js); the
	// address names the account.
	monero: {
		id: 'monero',
		kind: 'monero',
		name: 'Monero',
		shortName: 'Monero',
		nativeSymbol: 'XMR',
		caip2: 'monero:418015bb9ae982a1975da7d79277c270',
		nativeSlip44: null
	}
});

/**
 * Whether a chain is imported from the wallet's own export rather than read by
 * its address through the bridge.
 *
 * @param {WalletChain | null} chain
 */
export const importedChain = (chain) => chain?.kind === 'monero';

/** @param {unknown} id @returns {WalletChain | null} */
export function walletChain(id) {
	return typeof id === 'string' && Object.hasOwn(WALLET_CHAINS, id) ? WALLET_CHAINS[id] : null;
}

/** Whether an account or booking comes from an own wallet. @param {unknown} source */
export const isWalletSource = (source) => walletChain(source) !== null;

/**
 * An address as the app keeps and compares it: bech32 as it is (lower
 * case by definition), EVM in lower case (the checksum is only for typing).
 *
 * @param {WalletChain} chain
 * @param {string} address
 */
export function normalizeAddress(chain, address) {
	const a = String(address ?? '').trim();
	if (chain.kind === 'filecoin') return toFilecoinAddress(a);
	return chain.kind === 'evm' ? a.toLowerCase() : a;
}

/**
 * A first check in the browser; the bridge checks the bech32 or EIP-55
 * checksum itself before it asks any node.
 *
 * @param {WalletChain} chain
 * @param {string} address
 */
export function looksLikeAddress(chain, address) {
	const a = String(address ?? '').trim();
	if (chain.kind === 'evm') return /^0x[0-9a-fA-F]{40}$/.test(a);
	if (chain.kind === 'bitcoin') return /^btc-[0-9a-f]{8}$/.test(a);
	if (chain.kind === 'filecoin') {
		return isEthStyle(a) || /^f(0\d{1,20}|1[a-z2-7]{39}|3[a-z2-7]{84}|410f[a-z2-7]{39})$/.test(a);
	}
	// A primary address (4…) or a subaddress (8…), base58, 95 characters.
	if (chain.kind === 'monero') return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(a);
	const prefix = chain.bech32Prefix ?? '';
	return new RegExp(`^${prefix}1[02-9ac-hj-np-z]{38,58}$`).test(a);
}

/**
 * The Cosmos chain an address belongs to, by its bech32 prefix: an IBC
 * transfer names its receiver on the other chain. Null when none in the list.
 *
 * @param {string} address
 * @returns {WalletChain | null}
 */
export function cosmosChainOf(address) {
	return (
		Object.values(WALLET_CHAINS).find((c) => c.kind === 'cosmos' && looksLikeAddress(c, address)) ??
		null
	);
}

/** The last six characters, for names: `···trw6d0y`. @param {string} address */
export const addressTail = (address) => String(address ?? '').slice(-6);

/**
 * `Wallet NYM ···w6d0y`, `Wallet USDC (Base) ···81efcf`: an EVM address is
 * the same on every EVM chain, so the chain is named there.
 *
 * @param {WalletChain} chain
 * @param {string} asset
 * @param {string} address
 */
export function walletAccountName(chain, asset, address) {
	const where = chain.kind === 'evm' ? ` (${chain.shortName})` : '';
	return `Wallet ${asset}${where} ···${addressTail(address)}`;
}

/**
 * The explorer's page of an address, from the booking's link to its
 * transaction: the same explorer, `/address/<address>` where the link has
 * `/tx/<hash>` or `/message/<hash>` (Filfox). Null when the link has neither.
 *
 * @param {unknown} explorerUrl
 * @param {unknown} hash
 * @param {unknown} address
 */
export function addressExplorerUrl(explorerUrl, hash, address) {
	const url = safeExplorerUrl(explorerUrl);
	const h = String(hash ?? '');
	const a = String(address ?? '').trim();
	if (!url || !h || !a || !/^[A-Za-z0-9]+$/.test(a)) return null;
	for (const kind of ['tx', 'message']) {
		const at = url.indexOf(`/${kind}/${h}`);
		if (at > 0) return `${url.slice(0, at)}/address/${a}`;
	}
	return null;
}

/** Only an https link is shown as a link. @param {unknown} url */
export function safeExplorerUrl(url) {
	if (typeof url !== 'string') return null;
	try {
		return new URL(url).protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

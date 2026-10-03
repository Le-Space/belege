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
		bech32Prefix: 'n'
	},
	akash: {
		id: 'akash',
		kind: 'cosmos',
		name: 'Akash',
		shortName: 'Akash',
		nativeSymbol: 'AKT',
		bech32Prefix: 'akash'
	},
	ethereum: {
		id: 'ethereum',
		kind: 'evm',
		name: 'Ethereum',
		shortName: 'Ethereum',
		nativeSymbol: 'ETH'
	},
	base: { id: 'base', kind: 'evm', name: 'Base', shortName: 'Base', nativeSymbol: 'ETH' },
	arbitrum: {
		id: 'arbitrum',
		kind: 'evm',
		name: 'Arbitrum One',
		shortName: 'Arbitrum',
		nativeSymbol: 'ETH'
	},
	optimism: {
		id: 'optimism',
		kind: 'evm',
		name: 'OP Mainnet',
		shortName: 'Optimism',
		nativeSymbol: 'ETH'
	},
	polygon: {
		id: 'polygon',
		kind: 'evm',
		name: 'Polygon PoS',
		shortName: 'Polygon',
		nativeSymbol: 'POL'
	},
	// The key stays in the bridge's keychain; the app knows the wallet by the
	// key's fingerprint (`btc-…`), taken from the bridge (bridge/src/chains/bitcoin.js).
	bitcoin: {
		id: 'bitcoin',
		kind: 'bitcoin',
		name: 'Bitcoin',
		shortName: 'Bitcoin',
		nativeSymbol: 'BTC'
	},
	// Read by address through Filfox; a message CID is the hash, the same an
	// exchange reports for a deposit (bridge/src/chains/filecoin.js).
	filecoin: {
		id: 'filecoin',
		kind: 'filecoin',
		name: 'Filecoin',
		shortName: 'Filecoin',
		nativeSymbol: 'FIL'
	},
	// Not read by address: Monero hides amounts and parties on its chain. The
	// wallet's own export is imported in the browser (monero-import.js); the
	// address names the account.
	monero: {
		id: 'monero',
		kind: 'monero',
		name: 'Monero',
		shortName: 'Monero',
		nativeSymbol: 'XMR'
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

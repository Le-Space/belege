// The chains an own wallet can be on, as the app needs them without asking
// the bridge: names for accounts and the Verlauf, the kind of address, the
// native asset. Endpoints and explorers come from the bridge (GET /chains,
// bridge/src/chains/registry.js); wallets.spec.js checks both tables agree.
//
// A wallet's accounts carry the chain's id as their `source` (`nyx`,
// `ethereum`, …), one account per asset.

/**
 * @typedef {object} WalletChain
 * @property {string} id
 * @property {'cosmos' | 'evm'} kind
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
	}
});

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
	const prefix = chain.bech32Prefix ?? '';
	return new RegExp(`^${prefix}1[02-9ac-hj-np-z]{38,58}$`).test(a);
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

/** Only an https link is shown as a link. @param {unknown} url */
export function safeExplorerUrl(url) {
	if (typeof url !== 'string') return null;
	try {
		return new URL(url).protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

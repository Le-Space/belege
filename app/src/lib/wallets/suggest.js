// A withdrawal from an exchange to an address that is no own wallet yet:
// whether to offer it as one. Pure; nothing is asked of any node – the wallet
// is added, and read, only when the person says so.
//
// The chain comes from the booking's hash (assets/hash-chain.js), else from
// the network the exchange named or the asset's home chain. Offered only
// where Belege reads a wallet by its address and the address has the chain's
// form. Bitcoin (read by a key in the bridge) and Monero (imported) are never
// offered. A chain Belege cannot read at all is named, so the person knows why
// nothing pairs.
//
// An address is not proof of ownership: a withdrawal can pay someone else.
// So this is an offer, and the text beside it says so.

import { chainNamed } from '../assets/hash-chain.js';
import { looksLikeAddress, normalizeAddress, walletChain } from './chains.js';

/**
 * @typedef {{ state: 'add', address: string, chains: import('./chains.js').WalletChain[] }
 *   | { state: 'unsupported', address: string, chainName: string }} WalletSuggestion
 */

/**
 * @param {object} params
 * @param {unknown} params.address where the withdrawal went (`chainAddress`)
 * @param {{ id: string, name: string }[]} [params.chains] what the hash says (chainOfHash)
 * @param {string} [params.method] the exchange's name for the network
 * @param {string} [params.asset]
 * @param {{ chain: string, address: string }[]} params.wallets the own wallets
 * @returns {WalletSuggestion | null}
 */
export function walletSuggestion({ address, chains = [], method = '', asset = '', wallets }) {
	const a = String(address ?? '').trim();
	if (!a) return null;
	const named = chains.length ? chains : [chainNamed({ method, asset })].filter((c) => c !== null);
	if (!named.length) return null;

	/** @type {import('./chains.js').WalletChain[]} */
	const readable = [];
	for (const c of named) {
		const chain = walletChain(c.id);
		if (!chain) continue;
		// Not added by an address.
		if (chain.kind === 'bitcoin' || chain.kind === 'monero') return null;
		if (looksLikeAddress(chain, a)) readable.push(chain);
	}
	if (!readable.length) {
		// One clear chain Belege has no reader for.
		return named.length === 1 && !walletChain(named[0].id)
			? { state: 'unsupported', address: a, chainName: named[0].name }
			: null;
	}
	const open = readable.filter((chain) => {
		const normal = normalizeAddress(chain, a);
		return !wallets.some((w) => w.chain === chain.id && w.address === normal);
	});
	// Known on one of the chains it can be on: an own wallet already.
	if (open.length < readable.length && named.length > 1) return null;
	return open.length ? { state: 'add', address: a, chains: open } : null;
}

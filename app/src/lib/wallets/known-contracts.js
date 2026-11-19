// Contracts a wallet pays into that are known for what they are – so that the
// books can say what such a payment was without asking. Only contracts whose
// address comes from their makers' own published list, each with where it
// was read; an address here is public, like a bank's BIC. Pure.

import { normalizeAddress, walletChain } from './chains.js';

/**
 * @typedef {object} KnownContract
 * @property {string} name what the contract is called
 * @property {'payment-account'} kind
 *   `payment-account`: the payer's own balance in a payment contract. What is
 *   paid in stays the payer's (and can be taken out again) until a service is
 *   settled from it: paying in is an own transfer, not an expense.
 */

/**
 * By chain, then by the address as the chain writes it.
 *
 * Filecoin Pay (Filecoin Onchain Cloud): the contract a wallet deposits USDFC
 * into to pay storage providers over time. Mainnet address from
 * `@filoz/synapse-core` 0.10.0 (`filecoinPayV1Address[314]`,
 * 0x23b1e018F08BB982348b15a86ee926eEBf7F4DAa), in its f410 form.
 *
 * @type {Record<string, Record<string, KnownContract>>}
 */
const CONTRACTS = {
	filecoin: {
		f410feoy6aghqro4yenelcwug52jg527x6tnkxl36cyi: { name: 'Filecoin Pay', kind: 'payment-account' }
	}
};

/**
 * The known contract on the other side of a wallet booking, or null.
 *
 * @param {{ source?: unknown, counterpartyAddress?: unknown }} tx
 * @returns {(KnownContract & { address: string }) | null}
 */
export function knownContract(tx) {
	const chain = walletChain(String(tx.source ?? ''));
	const address = String(tx.counterpartyAddress ?? '');
	if (!chain || !address) return null;
	const found = CONTRACTS[chain.id]?.[normalizeAddress(chain, address).toLowerCase()];
	return found ? { ...found, address } : null;
}

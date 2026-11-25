// What "✦ Konto vorschlagen" must never answer, and what the app tells the
// model it already knows. Pure.
//
// The contra account of a payment is never the account the money is on: a
// staking reward on an exchange's ETH balance is not booked against that
// balance, a wallet's payment not against the wallet. Nor is it another of
// our own bank, wallet or exchange accounts – unless the payment is an own
// transfer, where the other side is exactly that. Those accounts are not
// offered to the model, and an answer naming one is dropped: no suggestion
// rather than a wrong one.

import { ledgerOf } from './settings.js';
import { accountRuleOf } from './suggest.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'reward' | 'cloud-credits' | 'fee' | 'own-transfer'} Known what the app knows of a payment, for the model */

/** @type {readonly Known[]} */
export const KNOWN = Object.freeze(['reward', 'cloud-credits', 'fee', 'own-transfer']);

/**
 * The accounts the model may not name for this payment: the ledger account of
 * the payment's own account, and – unless it is an own transfer – those of all
 * our own accounts (bank, wallet, exchange).
 *
 * @param {object} p
 * @param {Rec} p.tx
 * @param {Rec[]} p.accounts the books' own accounts (`accounts` collection)
 * @param {import('../matching/classify.js').Classification | null | undefined} [p.classification]
 * @returns {Set<string>}
 */
export function forbiddenAccounts({ tx, accounts, classification = null }) {
	/** @type {Set<string>} */
	const out = new Set();
	const ownTransfer = classification?.kind === 'own-transfer';
	for (const a of accounts) {
		if (a?.deleted) continue;
		if (ownTransfer && a.id !== tx.accountId) continue;
		const ledger = ledgerOf(a);
		if (ledger) out.add(ledger);
	}
	return out;
}

/**
 * What the app already knows of the payment, for the model's question.
 *
 * @param {Rec} tx
 * @param {import('../matching/classify.js').Classification | null | undefined} classification
 * @returns {Known | null}
 */
export function knownOf(tx, classification) {
	const rule = accountRuleOf(tx, classification);
	if (rule) return rule;
	if (classification?.kind === 'bank-fee') return 'fee';
	if (classification?.kind === 'own-transfer') return 'own-transfer';
	return null;
}

/**
 * The model's picks without a forbidden account; none left is no suggestion.
 *
 * @template {{ account?: unknown }} P
 * @param {P[] | null | undefined} picks
 * @param {Set<string>} forbidden
 * @returns {P[]}
 */
export function allowedPicks(picks, forbidden) {
	return (picks ?? []).filter((p) => !forbidden.has(String(p?.account ?? '').trim()));
}

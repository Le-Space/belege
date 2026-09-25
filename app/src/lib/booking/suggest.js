// "Konto": which account a booking goes on (the contra account, DATEV
// "Gegenkonto") and its BU key. The app suggests, the person confirms; only
// a confirmed booking is exported (export/plan.js). Pure.
//
// In this order:
//   1. what the person confirmed (`tx.booking`)
//   2. an own transfer (classify.js): 1360 Geldtransit, no BU key
//   3. a bank fee: 4970 Nebenkosten des Geldverkehrs, no BU key
//   4. learned: the account the person gave this vendor last time
//      (partners.js `account`), found by the receipt's vendor or the
//      counterparty on the statement
//   5. nothing: the person picks from the catalogue (skr03.js) or types a number
// The BU key comes from the linked receipt (tax-keys.js); without one, a
// learned vendor's key.

import { findPartner, partnerOfTx } from '../matching/partners.js';
import { FEE_ACCOUNT, TRANSFER_ACCOUNT, isAccountNumber } from './skr03.js';
import { DEFAULT_TAX_KEYS } from './settings.js';
import { taxKeyFor } from './tax-keys.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'confirmed' | 'transfer' | 'fee' | 'learned' | null} SuggestionSource */

/**
 * @typedef {object} Suggestion
 * @property {string | null} account
 * @property {string} taxKey '' for none
 * @property {SuggestionSource} source where the account comes from; null: none known
 * @property {import('./tax-keys.js').TaxVia | 'learned' | 'confirmed' | 'none'} taxVia where the key comes from
 * @property {string | null} vendor the learned vendor's name
 */

/**
 * Whether a person confirmed an account for this booking.
 *
 * @param {Rec | null | undefined} tx
 */
export function isBookingConfirmed(tx) {
	return Boolean(tx?.booking?.confirmedAt) && isAccountNumber(tx?.booking?.account);
}

/**
 * The partner whose account applies: by the receipt's vendor, else by the
 * counterparty on the statement (an alias a link taught).
 *
 * @param {Rec[]} partners
 * @param {Rec | null} receipt
 * @param {Rec} tx
 * @returns {Rec | null}
 */
export function learnedPartner(partners, receipt, tx) {
	const vendor = String(receipt?.vendor ?? receipt?.extraction?.vendor ?? '').trim();
	const byVendor = vendor ? findPartner(partners, vendor) : null;
	if (byVendor && isAccountNumber(byVendor.account)) return byVendor;
	const byAlias = partnerOfTx(partners, tx);
	return byAlias && isAccountNumber(byAlias.account) ? byAlias : null;
}

/**
 * @param {Rec} tx
 * @param {object} context
 * @param {import('../matching/classify.js').Classification | null} [context.classification]
 * @param {Rec[]} [context.receipts] the booking's linked receipts, first one first
 * @param {Rec[]} [context.partners]
 * @param {import('./settings.js').TaxKeys} [context.keys]
 * @returns {Suggestion}
 */
export function suggestBooking(
	tx,
	{ classification = null, receipts = [], partners = [], keys = DEFAULT_TAX_KEYS }
) {
	if (isBookingConfirmed(tx)) {
		return {
			account: String(tx.booking.account),
			taxKey: String(tx.booking.taxKey ?? ''),
			source: 'confirmed',
			taxVia: 'confirmed',
			vendor: null
		};
	}
	if (classification?.kind === 'own-transfer') {
		return {
			account: TRANSFER_ACCOUNT,
			taxKey: '',
			source: 'transfer',
			taxVia: 'none',
			vendor: null
		};
	}
	if (classification?.kind === 'bank-fee') {
		return { account: FEE_ACCOUNT, taxKey: '', source: 'fee', taxVia: 'none', vendor: null };
	}
	const income = Number(tx.amountCents ?? 0) > 0;
	const receipt = receipts[0] ?? null;
	const partner = learnedPartner(partners, receipt, tx);
	const account = partner ? String(partner.account) : null;
	const fromReceipt = taxKeyFor(receipt, { income, keys, account });
	const useLearnedKey =
		partner && fromReceipt.via === 'no-receipt' && /^\d{0,4}$/.test(String(partner.taxKey ?? ''));
	return {
		account,
		taxKey: useLearnedKey ? String(partner.taxKey ?? '') : fromReceipt.taxKey,
		source: partner ? 'learned' : null,
		taxVia: useLearnedKey ? 'learned' : fromReceipt.via,
		vendor: partner ? String(partner.name ?? '') : null
	};
}

// "Konto": which account a booking goes on (the contra account, DATEV
// "Gegenkonto") and its BU key. The app suggests, the person confirms; only
// a confirmed booking is exported (export/plan.js). Pure.
//
// In this order:
//   1. what the person confirmed (`tx.booking`)
//   2. an own transfer (classify.js): 1360 Geldtransit, no BU key
//   3. a bank fee: 4970 Nebenkosten des Geldverkehrs, no BU key
//   (before both: a private payment or its repayment, by the legal form, #172)
//   3b. travel (#213): a line of a travel statement carries its account; its
//      payout goes on the clearing account, as a private repayment; a receipt
//      on a trip, or a hospitality bill, goes on the travel account of its
//      category, by the legal form (travel/accounts.js)
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
import { privateKind } from '../matching/private-kind.js';
import { receiptCategory, travelAccount } from '../travel/accounts.js';
import { travelKind } from '../travel/view.js';
import { isStatementReceipt } from '../travel/payout.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'confirmed' | 'transfer' | 'fee' | 'payroll' | 'learned' | 'private' | 'travel' | null} SuggestionSource */

/**
 * @typedef {object} Suggestion
 * @property {string | null} account
 * @property {string} taxKey '' for none
 * @property {SuggestionSource} source where the account comes from; null: none known
 * @property {import('./tax-keys.js').TaxVia | 'learned' | 'confirmed' | 'none'} taxVia where the key comes from
 * @property {string | null} [category] a travel cost's category (travel/accounts.js)
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
 * @param {{ payment: string | null, repayment: string | null }} [context.privateAccounts]
 *   where a private payment and its repayment go, by the legal form (#172)
 * @param {import('../travel/accounts.js').TravelSet | ((receipt: Record<string, any>) => import('../travel/accounts.js').TravelSet) | null} [context.travelSet]
 *   the travel accounts' set (#213): one, or per receipt, by its trip's traveller (#380)
 * @param {((p: { travellerId?: string | null, receiptId?: string | null }) => string | null) | null} [context.travelClearing]
 *   a traveller's clearing account, for an advance (#381) and a statement's payout (travel/accounts.js clearingAccountOf)
 * @returns {Suggestion}
 */
export function suggestBooking(
	tx,
	{
		classification = null,
		receipts = [],
		partners = [],
		keys = DEFAULT_TAX_KEYS,
		privateAccounts = { payment: null, repayment: null },
		travelSet = null,
		travelClearing = null
	}
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
	// A private payment from the business account, or its repayment (#172): by the
	// legal form; null for a UG/GmbH until its shareholder clearing account is set.
	const priv = privateKind(tx);
	if (priv) {
		return {
			// By the money's way, not the kind: out of the business is a withdrawal,
			// in is a deposit – a private payment and its repayment, or private
			// money that came in by mistake and its pass-on.
			account:
				Number(tx.amountCents ?? 0) < 0 ? privateAccounts.payment : privateAccounts.repayment,
			taxKey: '',
			source: 'private',
			taxVia: 'none',
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
	// Wages, wage tax, contributions, tax payments (#233): the account the
	// payroll or the tax office books them against, where one is known.
	if (
		classification &&
		['wage', 'payroll-tax', 'social-security', 'tax-payment'].includes(classification.kind) &&
		classification.account
	) {
		return {
			account: classification.account,
			taxKey: '',
			source: 'payroll',
			taxVia: 'none',
			vendor: null
		};
	}
	if (classification?.kind === 'bank-fee') {
		return { account: FEE_ACCOUNT, taxKey: '', source: 'fee', taxVia: 'none', vendor: null };
	}
	// A line of a travel statement (#213): its account and key were set with it.
	if (tx.travelLine?.account) {
		return {
			account: String(tx.travelLine.account),
			taxKey: String(tx.travelLine.taxKey ?? ''),
			source: 'travel',
			taxVia: tx.travelLine.taxVia ?? 'none',
			vendor: null,
			category: tx.travelLine.category ?? null
		};
	}
	const income = Number(tx.amountCents ?? 0) > 0;
	const receipt = receipts[0] ?? null;
	// An advance to a traveller (#381): against their clearing account, as the payout.
	if (tx.travelAdvance?.travellerId && !income) {
		return {
			account: travelClearing?.({ travellerId: String(tx.travelAdvance.travellerId) }) ?? null,
			taxKey: '',
			source: 'travel',
			taxVia: 'none',
			vendor: null,
			category: 'advance'
		};
	}
	// The payout of a travel statement (#213, step 7): against the traveller's clearing
	// account (#380: an employee's own), by the money's way, as a private repayment.
	if (receipt && isStatementReceipt(receipt) && !income) {
		return {
			account: travelClearing
				? travelClearing({ receiptId: String(receipt.id) })
				: privateAccounts.payment,
			taxKey: '',
			source: 'travel',
			taxVia: 'none',
			vendor: null,
			category: 'payout'
		};
	}
	// A receipt on a trip, or a hospitality bill, paid from a business account (#213).
	if (travelSet && receipt && !income && (receipt.travel?.tripId || receipt.hospitality)) {
		const category = receiptCategory(receipt, travelKind(receipt));
		const set = typeof travelSet === 'function' ? travelSet(receipt) : travelSet;
		const account = travelAccount(set, category).number;
		const key = taxKeyFor(receipt, { income, keys, account });
		return {
			account,
			taxKey: key.taxKey,
			source: 'travel',
			taxVia: key.via,
			vendor: null,
			category
		};
	}
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

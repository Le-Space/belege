// What the DATEV export needs to know about the books, stored sealed under
// the settings key `datev`: the header values of a Buchungsstapel (consultant
// and client number, start of the fiscal year, length of the ledger
// accounts) and the BU keys the tax-key suggestion uses (tax-keys.js).
//
// The ledger account of each bank account ("Sachkonto in MonkeyOffice") lives
// on its `accounts` record as `ledgerAccount`, so a new bank account starts
// without one. Pure.

import { isAccountNumber } from './skr03.js';

/**
 * @typedef {object} TaxKeys the BU keys per case; '' leaves the field empty
 * @property {string} input19 input tax 19 % (expenses)
 * @property {string} input7 input tax 7 % (expenses)
 * @property {string} output19 VAT 19 % (income)
 * @property {string} output7 VAT 7 % (income)
 * @property {string} reverseCharge §13b UStG, the recipient owes the VAT
 */

/**
 * @typedef {object} DatevSettings
 * @property {string} consultantNumber Beraternummer, 1001–9999999
 * @property {string} clientNumber Mandantennummer, 1–99999
 * @property {number} fiscalYearStartMonth 1–12; the fiscal year starts on the 1st of it
 * @property {number} accountLength Sachkontenlänge, 4–8
 * @property {TaxKeys} taxKeys
 * @property {LegalForm} legalForm how private payments are booked (issue #172); '' not said yet
 * @property {string} shareholderAccount a UG/GmbH's shareholder clearing account, '' until set
 * @property {'month' | 'quarter'} vatPeriod how the VAT figures are grouped (issue #195)
 * @property {boolean} smallBusiness Kleinunternehmer (§19 UStG): no VAT charged, none deducted
 */

/**
 * SKR 03 keys as DATEV documents them; 94 for §13b is the usual key for a
 * service from abroad at 19 %, but which one applies is the tax adviser's
 * call (docs/export.md).
 *
 * @type {Readonly<TaxKeys>}
 */
export const DEFAULT_TAX_KEYS = Object.freeze({
	input19: '9',
	input7: '8',
	output19: '3',
	output7: '2',
	reverseCharge: '94'
});

/**
 * The legal form, for how a private payment from the business account is
 * booked (issue #172): a sole proprietor or partnership withdraws privately
 * (1800) and deposits (1890); a UG or GmbH has no private withdrawals – it
 * paid for its shareholder, a claim on the shareholder clearing account.
 *
 * @typedef {'' | 'sole' | 'partnership' | 'corporation'} LegalForm
 */
export const LEGAL_FORMS = /** @type {const} */ (['sole', 'partnership', 'corporation']);

/**
 * The accounts a private payment and its repayment go on, and whether it
 * must be settled; null accounts where the person has to name one.
 *
 * @param {DatevSettings} settings cleaned
 * @returns {{ payment: string | null, repayment: string | null, settle: boolean }}
 */
export function privateAccounts(settings) {
	if (settings.legalForm === 'sole' || settings.legalForm === 'partnership') {
		return { payment: '1800', repayment: '1890', settle: false };
	}
	// A UG/GmbH, or not said yet: the claim is settled by the repayment.
	const clearing =
		settings.legalForm === 'corporation' ? settings.shareholderAccount || null : null;
	return { payment: clearing, repayment: clearing, settle: true };
}

/** @returns {DatevSettings} */
export function defaultDatevSettings() {
	return {
		legalForm: /** @type {LegalForm} */ (''),
		shareholderAccount: '',
		vatPeriod: /** @type {'month' | 'quarter'} */ ('quarter'),
		smallBusiness: false,
		// A number MonkeyOffice accepts for a company of its own; check what it expects.
		consultantNumber: '1001',
		clientNumber: '1',
		fiscalYearStartMonth: 1,
		accountLength: 4,
		taxKeys: { ...DEFAULT_TAX_KEYS }
	};
}

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function int(v, min, max, fallback) {
	const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** A BU key: one to four digits, or empty. @param {unknown} v @param {string} fallback */
function key(v, fallback) {
	if (v === '' || v === null) return '';
	const s = String(v ?? '').trim();
	return /^\d{1,4}$/.test(s) ? s : fallback;
}

/**
 * A stored value, cleaned: bad entries fall back to the defaults.
 *
 * @param {any} value
 * @returns {DatevSettings}
 */
export function cleanDatevSettings(value) {
	const d = defaultDatevSettings();
	const keys = value?.taxKeys ?? {};
	return {
		legalForm: LEGAL_FORMS.includes(value?.legalForm) ? value.legalForm : '',
		shareholderAccount: /^\d{4,8}$/.test(String(value?.shareholderAccount ?? '').trim())
			? String(value.shareholderAccount).trim()
			: '',
		vatPeriod: value?.vatPeriod === 'month' ? 'month' : 'quarter',
		smallBusiness: value?.smallBusiness === true,
		consultantNumber: String(int(value?.consultantNumber, 1001, 9999999, 1001)),
		clientNumber: String(int(value?.clientNumber, 1, 99999, 1)),
		fiscalYearStartMonth: int(value?.fiscalYearStartMonth, 1, 12, d.fiscalYearStartMonth),
		accountLength: int(value?.accountLength, 4, 8, d.accountLength),
		taxKeys: {
			input19: key(keys.input19, d.taxKeys.input19),
			input7: key(keys.input7, d.taxKeys.input7),
			output19: key(keys.output19, d.taxKeys.output19),
			output7: key(keys.output7, d.taxKeys.output7),
			reverseCharge: key(keys.reverseCharge, d.taxKeys.reverseCharge)
		}
	};
}

/**
 * The ledger account suggested for the n-th bank account (by creation):
 * SKR 03 1200, 1210, 1220, … – a placeholder only; the person enters the
 * number their books use.
 *
 * @param {number} index 0-based
 */
export function suggestedLedgerAccount(index) {
	return String(1200 + 10 * Math.max(0, Math.min(index, 9)));
}

/**
 * The bank accounts in the order the suggestion counts them (oldest first).
 *
 * @template {{ id: string, deleted?: boolean }} A
 * @param {A[]} accounts
 * @returns {A[]}
 */
export function accountsInOrder(accounts) {
	return accounts.filter((a) => !a.deleted).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The ledger account a bank account has, or null.
 *
 * @param {Record<string, any> | null | undefined} account
 * @returns {string | null}
 */
export function ledgerOf(account) {
	return account && isAccountNumber(account.ledgerAccount) ? String(account.ledgerAccount) : null;
}

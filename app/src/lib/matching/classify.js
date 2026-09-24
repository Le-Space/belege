// Transactions that need no receipt. Pure; configurable through the
// "Eigene Anweisungen" (settings key `matching`).
//
// In this order:
//   1. the person's own rules: counterparty or purpose contains a text →
//      ignore (with the reason given) or private
//   2. bank fees: booking type Abschluss, Entgelt, Mehrwertsteuerbelastung –
//      the account statement is the receipt
//   3. own transfers: the counterparty IBAN is one of our own accounts (or ends
//      like one and that account shows the counter-booking), or the
//      counterparty is our own company – neutral account 1360, no receipt
//   4. loans: "Darlehen" in the purpose – the contract is the receipt
// (docs/phase-0.md, "Matching").

import { compactIban, normalizeRef } from './normalize.js';

/** Legal forms dropped before two company names are compared. */
const LEGAL_FORMS = new Set([
	'gmbh',
	'mbh',
	'ag',
	'se',
	'ug',
	'kg',
	'ohg',
	'gbr',
	'eg',
	'ev',
	'co',
	'haftungsbeschrankt',
	'haftungsbeschraenkt',
	'ltd',
	'inc',
	'llc'
]);

/** @param {unknown} s */
function nameWords(s) {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !LEGAL_FORMS.has(w));
}

/**
 * Whether `name` names our company `company`: the company's words (legal form
 * dropped), in order, inside the name. "LE SPACE UG (HAFTUNGSBESCHRAENKT)"
 * and "Le Space" are "le space UG"; "Space Cafe GmbH" is not.
 *
 * @param {unknown} name
 * @param {unknown} company
 */
export function isOwnName(name, company) {
	const needle = nameWords(company);
	const hay = nameWords(name);
	if (!needle.length || normalizeRef(needle.join('')).length < 4) return false;
	for (let i = 0; i + needle.length <= hay.length; i++) {
		if (needle.every((w, j) => hay[i + j] === w)) return true;
	}
	return false;
}

/**
 * @typedef {object} Rule a person's own instruction
 * @property {string} id
 * @property {'counterparty' | 'purpose' | 'any'} field
 * @property {string} contains
 * @property {'ignore' | 'private'} action
 * @property {string} [reason]
 */

/**
 * @typedef {object} MatchingSettings stored under the settings key `matching`
 * @property {string[]} companyNames
 * @property {string[]} ownIbans full IBANs the person typed in
 * @property {Rule[]} rules
 */

/** @returns {MatchingSettings} */
export function defaultMatchingSettings() {
	return { companyNames: [], ownIbans: [], rules: [] };
}

/**
 * A stored value, cleaned: unknown fields dropped, bad entries left out.
 *
 * @param {any} value
 * @returns {MatchingSettings}
 */
export function cleanMatchingSettings(value) {
	const strings = (/** @type {unknown} */ v) =>
		Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
	const rules = Array.isArray(value?.rules) ? value.rules : [];
	return {
		companyNames: strings(value?.companyNames),
		ownIbans: strings(value?.ownIbans)
			.map((s) => compactIban(s))
			.filter(Boolean),
		rules: rules
			.filter(
				(/** @type {any} */ r) =>
					r &&
					typeof r.contains === 'string' &&
					r.contains.trim().length >= 2 &&
					(r.action === 'ignore' || r.action === 'private')
			)
			.map((/** @type {any} */ r) => ({
				id: String(r.id ?? r.contains),
				field: r.field === 'purpose' || r.field === 'any' ? r.field : 'counterparty',
				contains: r.contains.trim(),
				action: r.action,
				reason: typeof r.reason === 'string' ? r.reason.trim() : ''
			}))
	};
}

/**
 * @typedef {object} ClassifyContext
 * @property {string[]} companyNames
 * @property {Set<string>} ownIbans compact IBANs: typed in, or resolved from the accounts
 * @property {Map<string, string[]>} ownLast4 last four digits → ids of our accounts whose full IBAN we do not keep (Hibiscus hands out only those)
 * @property {(tx: Record<string, any>, accountIds: string[]) => boolean} [mirrored] whether one of those accounts booked the same amount the other way within a few days
 * @property {Rule[]} rules
 */

/**
 * @typedef {object} Classification
 * @property {'rule-ignore' | 'rule-private' | 'bank-fee' | 'own-transfer' | 'loan'} kind
 * @property {string} [reason] the person's own words, for a rule
 * @property {string} [account] SKR 03 account, where one is known
 * @property {string} [ruleId]
 */

const BANK_FEE = /abschluss|entgelt|mehrwertsteuerbelast|kontof(?:u|ü)hrung/i;
const LOAN = /darlehen/i;

/**
 * Whether a transaction needs no receipt, and why; null when it needs one.
 *
 * @param {Record<string, any>} tx a transactions record
 * @param {ClassifyContext} ctx
 * @returns {Classification | null}
 */
export function classifyTransaction(tx, ctx) {
	const counterparty = String(tx.counterparty ?? '');
	const purpose = String(tx.purpose ?? '');
	for (const rule of ctx.rules) {
		const needle = rule.contains.toLowerCase();
		const inName = counterparty.toLowerCase().includes(needle);
		const inPurpose = purpose.toLowerCase().includes(needle);
		const hit =
			rule.field === 'counterparty'
				? inName
				: rule.field === 'purpose'
					? inPurpose
					: inName || inPurpose;
		if (hit) {
			return {
				kind: rule.action === 'private' ? 'rule-private' : 'rule-ignore',
				reason: rule.reason || rule.contains,
				ruleId: rule.id
			};
		}
	}
	if (BANK_FEE.test(String(tx.bookingType ?? ''))) return { kind: 'bank-fee' };
	const iban = compactIban(tx.counterpartyIban);
	if (iban && ctx.ownIbans.has(iban)) return { kind: 'own-transfer', account: '1360' };
	// Four digits alone match a vendor's IBAN one time in 10 000: only with the
	// counter-booking on that account.
	const last4 = iban ? ctx.ownLast4.get(iban.slice(-4)) : undefined;
	if (last4?.length && ctx.mirrored?.(tx, last4)) return { kind: 'own-transfer', account: '1360' };
	if (ctx.companyNames.some((c) => isOwnName(counterparty, c))) {
		return { kind: 'own-transfer', account: '1360' };
	}
	if (LOAN.test(purpose)) return { kind: 'loan' };
	return null;
}

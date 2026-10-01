// Wages, payroll taxes, social-security contributions and tax payments
// (issue #233). Pure.
//
// None of them gets a receipt of its own in bookkeeping practice: the payroll
// run is the receipt for a wage (payslip, payroll journal), the wage-tax
// return for the wage tax, the contribution statement for social security,
// the advance return or the assessment for a tax payment. The bank payment
// only settles what those documents booked. So a payment recognised here is
// covered – no "Beleg fehlt" – and says which document stands for it.
//
// Recognised by:
//   tax       the counterparty is a tax office ("Finanzamt", "Finanzkasse",
//             "FK …", "Bundeskasse", "Steuerkasse") or the purpose carries a
//             tax number (`123/456/78901`); which tax, by its word or
//             abbreviation (LSt, USt, KSt, GewSt, SolZ); a municipality's
//             cash office for "Gewerbesteuer"
//   social    the Minijob-Zentrale, the Knappschaft, a health insurer or an
//             employers' liability insurance (Berufsgenossenschaft)
//   wage      an outgoing payment to a person on the employees list in
//             Einstellungen, or one whose purpose says Lohn, Gehalt or Minijob
// The period, where the purpose names one: `12/2025`, `IV/2025` or `Q4 2025`,
// else a year (`2024`, `2020/2021`).
//
// The accounts suggested (SKR 03) are a starting point, as everywhere in
// booking/skr03.js: which one is right is the tax adviser's call.

import { isOwnName } from './classify.js';

/** @typedef {'wage' | 'payroll-tax' | 'social-security' | 'tax-payment'} PayrollKind */
/** @typedef {'wage-tax' | 'vat' | 'corporate' | 'trade' | null} TaxKind */

const TAX_OFFICE = /\b(finanzamt|finanzkasse|fk|bundeskasse|steuerkasse|bundeszentralamt)\b/i;
const MUNICIPAL = /\b(stadtkasse|gemeindekasse|stadt|gemeinde|kreiskasse)\b/i;
/** A German tax number as banks print it: 12/345/67890, 123/456/78901, or 13 digits. */
const TAX_NUMBER = /\b\d{2,3}\/\d{3,4}\/\d{4,5}\b|\bStNr\.?\s*\d/i;
const SOCIAL =
	/\b(minijob-?zentrale|knappschaft|aok|barmer|techniker krankenkasse|dak|ikk|bkk|hkk|krankenkasse|berufsgenossenschaft|sozialversicherung)\b/i;
const WAGE_WORDS = /\b(lohn|gehalt|gehälter|minijob|aushilfslohn|gehaltszahlung|lohnzahlung)\b/i;

/** Which tax a purpose names. @param {string} text @returns {TaxKind} */
function taxOf(text) {
	// The long words also start compounds: "Umsatzsteuerrestzahlung", "Lohnsteueranmeldung".
	if (/\b(lst|kist)\b|\b(lohnsteuer|kirchensteuer)/i.test(text)) return 'wage-tax';
	if (/\b(ust|ust-?va|mwst)\b|\bumsatzsteuer/i.test(text)) return 'vat';
	if (/\b(kst|solz)\b|\b(körperschaftsteuer|koerperschaftsteuer|solidaritätszuschlag)/i.test(text))
		return 'corporate';
	if (/\bgewst\b|\bgewerbesteuer/i.test(text)) return 'trade';
	return null;
}

const ROMAN = /** @type {Record<string, number>} */ ({ I: 1, II: 2, III: 3, IV: 4 });

/**
 * The period a purpose names: `2025-12`, `2025-Q4`, `2024`, `2020/2021`, or null.
 *
 * @param {string} text
 */
export function periodOf(text) {
	const month = /\b(0?[1-9]|1[0-2])\s*[/.-]\s*(20\d{2})\b/.exec(text);
	if (month) return `${month[2]}-${month[1].padStart(2, '0')}`;
	const quarter =
		/\b(IV|III|II|I)\s*[/.]?\s*(?:Q(?:uartal)?\.?)?\s*[/.]?\s*(20\d{2})\b/.exec(text) ??
		/\bQ\s*([1-4])\s*[/.]?\s*(20\d{2})\b/i.exec(text);
	if (quarter) {
		const q = ROMAN[quarter[1]] ?? Number(quarter[1]);
		return `${quarter[2]}-Q${q}`;
	}
	const span = /\b(20\d{2})\s*\/\s*(20\d{2})\b/.exec(text);
	if (span) return `${span[1]}/${span[2]}`;
	const year = /\b(20\d{2})\b/.exec(text);
	return year ? year[1] : null;
}

/**
 * @typedef {object} PayrollClassification
 * @property {PayrollKind} kind
 * @property {TaxKind} [tax] for a tax payment and the payroll tax
 * @property {string | null} period
 * @property {string} [employee] for a wage: the name from the list, where it was that
 * @property {string} [insurer] for contributions: who receives them, as the bank names them
 * @property {'employee' | 'wage-words' | 'tax-office' | 'tax-number' | 'municipality' | 'insurer'} via
 */

/**
 * @param {Record<string, any>} tx
 * @param {{ employees?: string[] }} ctx
 * @returns {PayrollClassification | null}
 */
export function payrollKind(tx, { employees = [] } = {}) {
	const counterparty = String(tx.counterparty ?? '');
	const purpose = String(tx.purpose ?? '');
	const both = `${counterparty} ${purpose}`;
	const amount = Number(tx.amountCents ?? 0);
	if (!amount || tx.movement) return null; // bank payments only, not crypto

	const office = TAX_OFFICE.test(counterparty);
	const numbered = TAX_NUMBER.test(purpose);
	if (office || numbered) {
		const tax = taxOf(both);
		return {
			kind: tax === 'wage-tax' ? 'payroll-tax' : 'tax-payment',
			tax,
			period: periodOf(purpose),
			via: office ? 'tax-office' : 'tax-number'
		};
	}
	if (MUNICIPAL.test(counterparty) && taxOf(both) === 'trade') {
		return { kind: 'tax-payment', tax: 'trade', period: periodOf(purpose), via: 'municipality' };
	}
	if (SOCIAL.test(counterparty)) {
		return {
			kind: 'social-security',
			insurer: counterparty.trim().slice(0, 80),
			period: periodOf(purpose),
			via: 'insurer'
		};
	}
	if (amount < 0) {
		const employee = employees.find((name) => isOwnName(counterparty, name));
		if (employee) return { kind: 'wage', employee, period: periodOf(purpose), via: 'employee' };
		if (WAGE_WORDS.test(purpose))
			return { kind: 'wage', period: periodOf(purpose), via: 'wage-words' };
	}
	return null;
}

/**
 * The SKR 03 account a payment of this kind is usually booked against.
 *
 * @param {PayrollClassification} c
 * @param {string} bookedOn YYYY-MM-DD
 * @returns {string | null}
 */
export function payrollAccount(c, bookedOn) {
	if (c.kind === 'wage') return '1740';
	if (c.kind === 'payroll-tax') return '1741';
	if (c.kind === 'social-security') return '1742';
	if (c.tax === 'vat') {
		// A period before the booking's year is the previous year's VAT.
		const year = /^(\d{4})/.exec(c.period ?? '')?.[1];
		return year && Number(year) < Number(bookedOn.slice(0, 4)) ? '1790' : '1780';
	}
	if (c.tax === 'corporate') return '2200';
	if (c.tax === 'trade') return '4320';
	return null;
}

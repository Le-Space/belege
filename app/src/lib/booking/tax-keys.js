// The BU key (DATEV "BU-Schlüssel") a booking gets from its receipt: the VAT
// the receipt shows, and whether money came in or went out. Pure; the keys
// themselves come from the settings (settings.js `taxKeys`), so a tax adviser
// who wants other ones changes them there.
//
//   money out, VAT 19 %   → input19   (SKR 03: 9, Vorsteuer 19 %)
//   money out, VAT  7 %   → input7    (8, Vorsteuer 7 %)
//   money in,  VAT 19 %   → output19  (3, Umsatzsteuer 19 %)
//   money in,  VAT  7 %   → output7   (2, Umsatzsteuer 7 %)
//   money out, §13b       → reverseCharge (94, to be checked with the tax adviser)
//   no VAT, another rate, several rates, an Automatikkonto → empty

import { catalogueAccount } from './skr03.js';
import { DEFAULT_TAX_KEYS } from './settings.js';

/**
 * @typedef {'no-receipt' | 'automatic' | 'reverse-charge' | 'reverse-charge-income' | 'vat19' | 'vat7' | 'no-vat' | 'other-rate' | 'mixed'} TaxVia
 */

/**
 * The VAT rates on a receipt that carry an amount (or at least a rate).
 *
 * @param {Record<string, any> | null | undefined} receipt
 * @returns {number[]}
 */
export function vatRates(receipt) {
	const vat = receipt?.extraction?.vat;
	if (!Array.isArray(vat)) return [];
	const rates = vat
		.filter(
			(/** @type {any} */ v) =>
				v && typeof v.rate === 'number' && Number.isFinite(v.rate) && v.amount !== 0
		)
		.map((/** @type {any} */ v) => Math.round(v.rate * 100) / 100)
		.filter((r) => r > 0);
	return [...new Set(rates)];
}

/**
 * @param {Record<string, any> | null | undefined} receipt the booking's (first) receipt
 * @param {object} context
 * @param {boolean} context.income money came in
 * @param {import('./settings.js').TaxKeys} [context.keys]
 * @param {string | null} [context.account] the contra account, when one is known
 * @returns {{ taxKey: string, via: TaxVia, rate?: number }}
 */
export function taxKeyFor(receipt, { income, keys = DEFAULT_TAX_KEYS, account = null }) {
	if (account && catalogueAccount(account)?.automatic) return { taxKey: '', via: 'automatic' };
	if (!receipt) return { taxKey: '', via: 'no-receipt' };
	if (receipt.extraction?.reverse_charge === true) {
		return income
			? { taxKey: '', via: 'reverse-charge-income' }
			: { taxKey: keys.reverseCharge, via: 'reverse-charge' };
	}
	const rates = vatRates(receipt);
	if (rates.length === 0) return { taxKey: '', via: 'no-vat' };
	if (rates.length > 1) return { taxKey: '', via: 'mixed' };
	const [rate] = rates;
	if (rate === 19) return { taxKey: income ? keys.output19 : keys.input19, via: 'vat19', rate };
	if (rate === 7) return { taxKey: income ? keys.output7 : keys.input7, via: 'vat7', rate };
	return { taxKey: '', via: 'other-rate', rate };
}

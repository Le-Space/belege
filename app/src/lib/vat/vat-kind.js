// What kind of VAT case an invoice is (issue #354, step 3), on both sides:
// our own invoices (output) and the receipts we received (input). Pure; from
// the extraction's tax fields (#357): the parties' countries, the customer's
// VAT ID, and a category per VAT line.
//
// Own invoices:
//   domestic          German VAT at 19 / 7 %
//   exempt            no VAT, exempt or zero-rated in Germany (§4 UStG, …)
//   reverseChargeDe   §13b in Germany: the German customer owes the VAT
//   intraEu           to a business in another EU country, with its VAT ID:
//                     an intra-EU supply or a §13b service; no German VAT,
//                     reported in the Zusammenfassende Meldung (ZM)
//   thirdCountry      to a customer outside the EU: export, or a service not
//                     taxable in Germany
// Received receipts:
//   domestic          German VAT, deductible as input VAT
//   foreignVat        VAT of another country: not German input VAT
//   reverseCharge     §13b: no VAT charged, we owe it and deduct it at once
//   intraEuAcquisition goods from another EU country (category intra_eu):
//                     acquisition VAT, owed and deducted at once
//   thirdCountry      from outside the EU without VAT (import VAT, if any,
//                     comes with customs, not with the invoice)
// Either side:
//   unclear           cannot be told without guessing – named with its reason
//
// Which case applies, and how it is reported, is the tax adviser's to
// confirm: this sorts what the invoices say.

import { fiscalYearOf } from '../year/year.js';
import { periodsOf, vatDay } from './input-vat.js';

/** @typedef {Record<string, any>} Rec */
/**
 * @typedef {'domestic' | 'exempt' | 'reverseChargeDe' | 'intraEu' | 'thirdCountry'} OutputKind
 * @typedef {'domestic' | 'foreignVat' | 'reverseCharge' | 'intraEuAcquisition' | 'thirdCountry'} InputKind
 * @typedef {object} VatCase
 * @property {'output' | 'input'} side
 * @property {OutputKind | InputKind | 'unclear'} kind
 * @property {string | null} reason why it is unclear: 'noCustomerVatId', 'noCountry', 'noCategory'
 * @property {string | null} country the other party's country (ISO 3166 alpha-2)
 * @property {string | null} vatId the other party's VAT ID (for the ZM: the customer's)
 * @property {number} netCents
 * @property {number} vatCents German or foreign VAT charged on it
 */

/** The EU member states, by country code. */
export const EU = Object.freeze(
	new Set(
		'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' ')
	)
);
/** A VAT ID's prefix as a country: Greece writes EL, Northern Ireland XI. @param {string | null | undefined} id */
export function vatIdCountry(id) {
	const p = String(id ?? '')
		.slice(0, 2)
		.toUpperCase();
	if (!/^[A-Z]{2}$/.test(p)) return null;
	return p === 'EL' ? 'GR' : p;
}
const isEu = (/** @type {string | null} */ c) => Boolean(c && (EU.has(c) || c === 'XI'));

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;
const GERMAN_RATES = new Set([19, 7]);

/**
 * @param {Rec} r a receipt as read
 * @param {boolean} own whether it is our own invoice (own-invoice.js)
 * @returns {VatCase}
 */
export function vatCase(r, own) {
	const e = r.extraction ?? {};
	const lines = (Array.isArray(e.vat) ? e.vat : []).filter(
		(/** @type {any} */ v) => v && typeof v.rate === 'number'
	);
	const categories = new Set(lines.map((/** @type {any} */ v) => v.category).filter(Boolean));
	const vatCents = lines.reduce(
		(/** @type {number} */ s, /** @type {any} */ v) => s + cents(v.amount),
		0
	);
	const gross = Number.isSafeInteger(r.amountCents) ? r.amountCents : cents(e.gross);
	const netCents = typeof e.net === 'number' ? cents(e.net) : gross - vatCents;
	const base = { reason: null, netCents, vatCents };

	if (own) {
		const vatId = e.customer_vat_id ?? null;
		const country = e.customer_country ?? vatIdCountry(vatId);
		const out = (
			/** @type {OutputKind | 'unclear'} */ kind,
			/** @type {string | null} */ reason = null
		) => ({
			...base,
			side: /** @type {const} */ ('output'),
			kind,
			reason,
			country,
			vatId
		});
		const germanVat = lines.some(
			(/** @type {any} */ v) =>
				cents(v.amount) !== 0 && GERMAN_RATES.has(Math.round(v.rate * 100) / 100)
		);
		if (germanVat && (!country || country === 'DE')) return out('domestic');
		if (categories.has('reverse_charge') && country === 'DE') return out('reverseChargeDe');
		if (
			categories.has('intra_eu') ||
			((categories.has('reverse_charge') || vatCents === 0) && isEu(country) && country !== 'DE')
		) {
			// The ZM needs the customer's VAT ID: without it this cannot be an intra-EU supply.
			if (!vatId || !isEu(vatIdCountry(vatId))) return out('unclear', 'noCustomerVatId');
			return out('intraEu');
		}
		if (categories.has('export') || (country && !isEu(country) && vatCents === 0)) {
			return out('thirdCountry');
		}
		if (categories.has('not_taxable'))
			return country ? out('thirdCountry') : out('unclear', 'noCountry');
		if (categories.has('exempt') || categories.has('zero')) return out('exempt');
		if (germanVat) return out('domestic');
		if (vatCents === 0) return out('unclear', country ? 'noCategory' : 'noCountry');
		return out('domestic');
	}

	const vatId = e.vendor_vat_id ?? null;
	const country = e.vendor_country ?? vatIdCountry(vatId);
	const input = (
		/** @type {InputKind | 'unclear'} */ kind,
		/** @type {string | null} */ reason = null
	) => ({
		...base,
		side: /** @type {const} */ ('input'),
		kind,
		reason,
		country,
		vatId
	});
	if (e.reverse_charge === true || categories.has('reverse_charge')) return input('reverseCharge');
	if (categories.has('intra_eu') && isEu(country) && country !== 'DE')
		return input('intraEuAcquisition');
	const foreign =
		(country && country !== 'DE') ||
		lines.some(
			(/** @type {any} */ v) =>
				cents(v.amount) !== 0 && !GERMAN_RATES.has(Math.round(v.rate * 100) / 100)
		);
	if (vatCents !== 0) return input(foreign ? 'foreignVat' : 'domestic');
	if (country && !isEu(country)) return input('thirdCountry');
	if (country && country !== 'DE') return input('unclear', 'noCategory');
	return input('domestic');
}

/**
 * @typedef {{ netCents: number, vatCents: number, receipts: string[] }} KindSum
 */

/**
 * The cases of a fiscal year, by the invoice date: sums per kind on each side,
 * what is unclear and why, and the ZM's lines – per period and customer VAT
 * ID, the net of our intra-EU invoices.
 *
 * @param {object} p
 * @param {Rec[]} p.receipts
 * @param {(r: Rec) => boolean} p.isOwn own-invoice.js
 * @param {number} p.year
 * @param {number} [p.startMonth]
 * @param {'month' | 'quarter'} [p.period] the ZM's period
 * @returns {{
 *   output: Record<string, KindSum>,
 *   input: Record<string, KindSum>,
 *   unclear: { id: string, side: 'output' | 'input', reason: string | null }[],
 *   zm: { period: string, vatId: string, country: string | null, netCents: number, invoices: number }[]
 * }}
 */
export function vatKinds({ receipts, isOwn, year, startMonth = 1, period = 'quarter' }) {
	const periods = periodsOf(year, startMonth, period);
	const periodOf = new Map(periods.flatMap((p) => p.months.map((m) => [m, p.key])));
	/** @type {{ output: Record<string, KindSum>, input: Record<string, KindSum> }} */
	const sums = { output: {}, input: {} };
	/** @type {{ id: string, side: 'output' | 'input', reason: string | null }[]} */
	const unclear = [];
	/** @type {Map<string, { period: string, vatId: string, country: string | null, netCents: number, invoices: number }>} */
	const zm = new Map();
	for (const r of receipts) {
		if (r.deleted || !r.extraction || r.status === 'ignoriert' || r.status === 'rückfrage')
			continue;
		const day = vatDay(r);
		if (!day || fiscalYearOf(day, startMonth) !== year) continue;
		const c = vatCase(r, isOwn(r));
		if (c.kind === 'unclear') {
			unclear.push({ id: String(r.id), side: c.side, reason: c.reason });
			continue;
		}
		const sum = (sums[c.side][c.kind] ??= { netCents: 0, vatCents: 0, receipts: [] });
		sum.netCents += c.netCents;
		sum.vatCents += c.vatCents;
		sum.receipts.push(String(r.id));
		if (c.kind === 'intraEu' && c.vatId) {
			const key = `${periodOf.get(day.slice(0, 7))}|${c.vatId}`;
			const line = zm.get(key) ?? {
				period: String(periodOf.get(day.slice(0, 7))),
				vatId: c.vatId,
				country: c.country,
				netCents: 0,
				invoices: 0
			};
			line.netCents += c.netCents;
			line.invoices++;
			zm.set(key, line);
		}
	}
	return {
		...sums,
		unclear,
		zm: [...zm.values()].sort((a, b) => (a.period + a.vatId).localeCompare(b.period + b.vatId))
	};
}

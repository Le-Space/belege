// Input VAT (Vorsteuer) of a fiscal year, from the receipts as read (issue
// #195). Pure; all amounts in cents.
//
// What counts as deductible here: the VAT lines at the German rates (19 % and
// 7 %) of receipts in euros from a vendor without a foreign VAT ID. Counted in
// the period of the receipt's date: the deduction follows the invoice, not the
// payment – also for a business that pays its own VAT by receipts (Ist), where
// only the output VAT follows the money. How much of it belongs to receipts
// not linked to a payment yet is shown beside it.
//
// Shown apart, never in the sum:
//   foreign     VAT of another country (another rate, or a foreign VAT ID):
//               not German input VAT; a refund runs through that country
//   reverse     §13b UStG: the vendor abroad charges none, the recipient owes
//               the VAT and deducts it at once – net zero; the base is shown
//   other       receipts in another currency
//   noLines     receipts with an amount but no VAT line and no §13b: nothing
//               to deduct, or not read – worth a look
// Own invoices (output VAT) and receipts set aside are no input.
//
// This is what the receipts say, as read by the model and confirmed by no
// one: a help for the advance return, not the return itself.

import { needsConfirmation } from '../receipts/import.js';
import { isActive } from '../matching/engine.js';
import { fiscalYearOf } from '../year/year.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'month' | 'quarter'} PeriodKind */

/** The German rates whose VAT is deductible as input VAT. */
export const GERMAN_RATES = /** @type {const} */ ([19, 7]);

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;

/**
 * The day a receipt counts on: the document's own date.
 *
 * @param {Rec} r
 * @returns {string | null} YYYY-MM-DD
 */
export function vatDay(r) {
	const d = r.documentDate ?? r.extraction?.invoice_date;
	return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** Read, not waiting for a yes, not set aside, not one of our own invoices. @param {Rec} r */
const counts = (r) =>
	!r.deleted &&
	Boolean(r.extraction) &&
	!needsConfirmation(r) &&
	r.status !== 'ignoriert' &&
	!r.ownInvoice &&
	!r.outgoing;

/** A VAT ID of another country (`ATU…`, `IE…`); none or a German one is not. @param {unknown} id */
const foreignVatId = (id) => {
	const s = String(id ?? '')
		.replace(/\s+/g, '')
		.toUpperCase();
	return /^[A-Z]{2}/.test(s) && !s.startsWith('DE');
};

/**
 * What one receipt adds.
 *
 * @param {Rec} r
 * @returns {{ kind: 'german', byRate: Record<number, number> } | { kind: 'foreign' | 'reverse' | 'other' | 'noLines', cents: number }}
 */
export function receiptVat(r) {
	const e = r.extraction ?? {};
	const gross = cents(e.gross);
	if (e.currency && e.currency !== 'EUR') return { kind: 'other', cents: gross };
	if (e.reverse_charge === true) return { kind: 'reverse', cents: cents(e.net) || gross };
	const lines = (Array.isArray(e.vat) ? e.vat : []).filter(
		(/** @type {any} */ v) => v && typeof v.rate === 'number' && cents(v.amount) !== 0
	);
	if (lines.length === 0) return { kind: 'noLines', cents: gross };
	const foreign =
		foreignVatId(e.vendor_vat_id) ||
		lines.some(
			(/** @type {any} */ v) =>
				!(/** @type {readonly number[]} */ (GERMAN_RATES).includes(Math.round(v.rate * 100) / 100))
		);
	if (foreign) {
		return {
			kind: 'foreign',
			cents: lines.reduce((/** @type {number} */ n, /** @type {any} */ v) => n + cents(v.amount), 0)
		};
	}
	/** @type {Record<number, number>} */
	const byRate = {};
	for (const v of lines) {
		const rate = Math.round(v.rate * 100) / 100;
		byRate[rate] = (byRate[rate] ?? 0) + cents(v.amount);
	}
	return { kind: 'german', byRate };
}

/**
 * The periods of a fiscal year: twelve months or four quarters, from the
 * month the year starts in.
 *
 * @param {number} year
 * @param {number} startMonth 1–12
 * @param {PeriodKind} kind
 * @returns {{ key: string, months: string[] }[]} months as YYYY-MM
 */
export function periodsOf(year, startMonth, kind) {
	const months = Array.from({ length: 12 }, (_, i) => {
		const m = startMonth - 1 + i;
		return `${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
	});
	if (kind === 'month') return months.map((m) => ({ key: m, months: [m] }));
	return [0, 1, 2, 3].map((q) => ({ key: `Q${q + 1}`, months: months.slice(q * 3, q * 3 + 3) }));
}

/**
 * @typedef {object} VatSum
 * @property {number} r19
 * @property {number} r7
 * @property {number} total r19 + r7
 * @property {number} receipts how many receipts are in it
 */

/**
 * @param {object} p
 * @param {Rec[]} p.receipts
 * @param {Rec[]} p.matches
 * @param {number} p.year the fiscal year
 * @param {number} [p.startMonth]
 * @param {PeriodKind} [p.period]
 * @returns {{
 *   periods: ({ key: string, months: string[] } & VatSum)[],
 *   year: VatSum,
 *   unlinked: { cents: number, receipts: number },
 *   foreign: { cents: number, receipts: number },
 *   reverse: { cents: number, receipts: number },
 *   other: { receipts: number },
 *   noLines: { receipts: number },
 *   undated: number
 * }}
 */
export function inputVat({ receipts, matches, year, startMonth = 1, period = 'quarter' }) {
	const linked = new Set(matches.filter((m) => isActive(m)).map((m) => String(m.receiptId)));
	const periods = periodsOf(year, startMonth, period).map((p) => ({
		...p,
		r19: 0,
		r7: 0,
		total: 0,
		receipts: 0
	}));
	const byMonth = new Map(periods.flatMap((p) => p.months.map((m) => [m, p])));
	const out = {
		periods,
		year: { r19: 0, r7: 0, total: 0, receipts: 0 },
		unlinked: { cents: 0, receipts: 0 },
		foreign: { cents: 0, receipts: 0 },
		reverse: { cents: 0, receipts: 0 },
		other: { receipts: 0 },
		noLines: { receipts: 0 },
		undated: 0
	};
	for (const r of receipts) {
		if (!counts(r)) continue;
		const day = vatDay(r);
		if (!day) {
			out.undated++;
			continue;
		}
		if (fiscalYearOf(day, startMonth) !== year) continue;
		const vat = receiptVat(r);
		if (vat.kind !== 'german') {
			if (vat.kind === 'foreign' || vat.kind === 'reverse') out[vat.kind].cents += vat.cents;
			out[vat.kind].receipts++;
			continue;
		}
		const r19 = vat.byRate[19] ?? 0;
		const r7 = vat.byRate[7] ?? 0;
		for (const sum of [byMonth.get(day.slice(0, 7)), out.year]) {
			if (!sum) continue;
			sum.r19 += r19;
			sum.r7 += r7;
			sum.total += r19 + r7;
			sum.receipts++;
		}
		if (!linked.has(String(r.id))) {
			out.unlinked.cents += r19 + r7;
			out.unlinked.receipts++;
		}
	}
	return out;
}

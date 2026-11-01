// Output VAT (Umsatzsteuer) of a fiscal year, from our own invoices (issue
// #195), and what it leaves to pay against the input VAT (input-vat.js).
// Pure; all amounts in cents.
//
// Our own invoices come from the invoicing app over UCEP (ucep/issued.js).
// Their VAT per rate is the app's to say (decided 29.09.: no reading of our
// own PDFs); an invoice it sent without one is counted as "VAT missing",
// never as zero.
//
// When it counts, by the setting under Buchhaltung:
//   ist   (default) when the money comes in: each payment linked to the
//         invoice carries its share of the invoice's VAT to the payment's
//         month; what is not paid yet is not due yet, and is shown apart
//   soll  on the invoice date, paid or not
//
// A small business (§19 UStG) charges no VAT: then the year's turnover is
// set against the limits (SMALL_BUSINESS_LIMITS), as the card shows it.
//
// A help for the advance return, as the invoices say it – not the return.

import { isActive } from '../matching/engine.js';
import { euroOf, receiptCurrency } from '../travel/view.js';
import { fiscalYearOf } from '../year/year.js';
import { periodsOf, vatDay } from './input-vat.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'ist' | 'soll'} VatBasis */

/**
 * The limits of §19 UStG in euros, by the year they apply from: the
 * previous year's turnover, and the current year's.
 */
export const SMALL_BUSINESS_LIMITS = Object.freeze([
	{ from: 2020, previousYear: 22_000, currentYear: 50_000 },
	{ from: 2025, previousYear: 25_000, currentYear: 100_000 }
]);

/** @param {number} year */
export const smallBusinessLimits = (year) =>
	[...SMALL_BUSINESS_LIMITS].reverse().find((l) => year >= l.from) ?? SMALL_BUSINESS_LIMITS[0];

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;

/** An invoice number to compare: `RE-2026/007` and `re2026007` are one. @param {unknown} n */
const numberKey = (n) =>
	String(n ?? '')
		.replace(/[^0-9a-z]/gi, '')
		.toLowerCase();
/** @param {Rec} r */
const numberOf = (r) => numberKey(r.invoiceNumber ?? r.extraction?.invoice_number);

/**
 * What one own invoice says about its VAT.
 *
 * @param {Rec} r
 * @returns {{ kind: 'vat', byRate: Record<number, number>, gross: number } | { kind: 'none' | 'missing', gross: number }}
 *   none: it says it charges no VAT (an empty list); missing: it says nothing
 */
export function invoiceVat(r) {
	const e = r.extraction ?? {};
	const gross = Number.isSafeInteger(r.amountCents) ? r.amountCents : cents(e.gross);
	if (!Array.isArray(e.vat)) return { kind: 'missing', gross };
	/** @type {Record<number, number>} */
	const byRate = {};
	for (const v of e.vat) {
		if (!v || typeof v.rate !== 'number' || cents(v.amount) === 0) continue;
		const rate = Math.round(v.rate * 100) / 100;
		byRate[rate] = (byRate[rate] ?? 0) + cents(v.amount);
	}
	return Object.keys(byRate).length ? { kind: 'vat', byRate, gross } : { kind: 'none', gross };
}

/**
 * @typedef {object} OutputSum
 * @property {number} r19
 * @property {number} r7
 * @property {number} other VAT at other rates (shown, summed into total)
 * @property {number} total
 * @property {number} invoices how many invoices are in it (with a share)
 */

/**
 * @param {object} p
 * @param {Rec[]} p.receipts
 * @param {Rec[]} p.matches
 * @param {Rec[]} p.transactions
 * @param {number} p.year the fiscal year
 * @param {number} [p.startMonth]
 * @param {'month' | 'quarter'} [p.period]
 * @param {VatBasis} [p.basis]
 * @param {(r: Rec) => boolean} [p.isOwn] which receipts are our own invoices (own-invoice.js, #354)
 * @returns {{
 *   periods: ({ key: string, months: string[] } & OutputSum)[],
 *   year: OutputSum,
 *   turnover: number,
 *   missing: { cents: number, invoices: number },
 *   none: { cents: number, invoices: number },
 *   open: { cents: number, invoices: number },
 *   undated: { cents: number, invoices: number },
 *   foreign: { invoices: number, currencies: string[] },
 *   invoices: number
 * }}
 */
export function outputVat({
	receipts,
	matches,
	transactions,
	year,
	startMonth = 1,
	period = 'quarter',
	basis = 'ist',
	isOwn = (r) => r.ownInvoice === true
}) {
	// Our own invoices that count: not deleted, not set aside, not waiting for a yes.
	const own = receipts.filter(
		(r) => !r.deleted && r.status !== 'ignoriert' && r.status !== 'rückfrage' && isOwn(r)
	);
	// One the invoicing app sent and that was read from a PDF too counts once: the app's.
	const fromApp = new Set(
		own.filter((r) => r.source === 'invoice-app' && numberOf(r)).map(numberOf)
	);
	const ownInvoices = own.filter(
		(r) => r.source === 'invoice-app' || !numberOf(r) || !fromApp.has(numberOf(r))
	);
	const empty = () => ({ r19: 0, r7: 0, other: 0, total: 0, invoices: 0 });
	const periods = periodsOf(year, startMonth, period).map((p) => ({ ...p, ...empty() }));
	const byMonth = new Map(periods.flatMap((p) => p.months.map((m) => [m, p])));
	const out = {
		periods,
		year: empty(),
		turnover: 0,
		missing: { cents: 0, invoices: 0 },
		none: { cents: 0, invoices: 0 },
		open: { cents: 0, invoices: 0 },
		// Soll: an invoice without a date counts in no month – shown, not lost.
		undated: { cents: 0, invoices: 0 },
		// Another currency with no euros known yet (Soll: no rate; Ist: not paid in euros).
		foreign: { invoices: 0, currencies: /** @type {string[]} */ ([]) },
		invoices: 0
	};
	/** @param {string} currency */
	const foreignOne = (currency) => {
		out.foreign.invoices++;
		if (!out.foreign.currencies.includes(currency)) out.foreign.currencies.push(currency);
	};
	const txById = new Map(transactions.filter((t) => !t.deleted).map((t) => [String(t.id), t]));
	/** @type {Map<string, Rec[]>} receipt id → its linked payments */
	const paidBy = new Map();
	for (const m of matches) {
		if (!isActive(m)) continue;
		const tx = txById.get(String(m.transactionId));
		if (!tx) continue;
		const list = paidBy.get(String(m.receiptId)) ?? [];
		list.push(tx);
		paidBy.set(String(m.receiptId), list);
	}
	const inYear = (/** @type {string} */ day) => fiscalYearOf(day, startMonth) === year;

	/**
	 * An invoice's VAT, in shares on their days. Each share takes what the shares
	 * so far leave of the rounded running total, so the parts add up to the
	 * invoice's VAT to the cent (two halves of 1,01 are 0,51 + 0,50, not 0,51 + 0,51).
	 *
	 * @param {{ day: string, share: number }[]} when
	 * @param {Record<number, number>} byRate
	 */
	function addAll(when, byRate) {
		const counted = new Set();
		/** @type {Record<string, number>} */
		const done = {};
		let cumulative = 0;
		for (const w of when) {
			cumulative += w.share;
			const counts = inYear(w.day);
			for (const [rate, amount] of Object.entries(byRate)) {
				const part = Math.round(amount * cumulative) - (done[rate] ?? 0);
				done[rate] = (done[rate] ?? 0) + part;
				if (!counts) continue;
				for (const sum of [byMonth.get(w.day.slice(0, 7)), out.year]) {
					if (!sum) continue;
					if (rate === '19') sum.r19 += part;
					else if (rate === '7') sum.r7 += part;
					else sum.other += part;
					sum.total += part;
				}
			}
			if (!counts) continue;
			for (const sum of [byMonth.get(w.day.slice(0, 7)), out.year]) {
				if (!sum || counted.has(sum)) continue;
				counted.add(sum);
				sum.invoices++;
			}
		}
	}

	for (const r of ownInvoices) {
		let vat = invoiceVat(r);
		const issued = vatDay(r);
		const currency = receiptCurrency(r);
		// Payments in the invoice's own direction: money in for an invoice, out for a
		// credit note (which then takes its VAT off again).
		const sign = Math.sign(vat.gross);
		let payments = (paidBy.get(String(r.id)) ?? [])
			.filter((tx) => sign !== 0 && Math.sign(Number(tx.amountCents)) === sign)
			.sort((a, b) => String(a.bookedOn).localeCompare(String(b.bookedOn)));
		if (currency !== 'EUR') {
			// Never its dollars as euros: in euros by what came in (Ist), or by the
			// euros known for it (Soll: a payment, a rate kept) – else apart, unsummed.
			payments = payments.filter((tx) => String(tx.currency ?? 'EUR').toUpperCase() === 'EUR');
			const paidEuros = payments.reduce((n, tx) => n + Math.abs(Number(tx.amountCents)), 0);
			const known = basis === 'ist' ? paidEuros : euroOf(r, { transactions, matches }).cents;
			const day = basis === 'ist' ? payments.at(-1)?.bookedOn : issued;
			if (!known || vat.gross === 0) {
				if ((day && inYear(String(day))) || (issued && inYear(issued))) foreignOne(currency);
				continue;
			}
			const factor = known / Math.abs(vat.gross);
			const euros = sign * known;
			vat =
				vat.kind === 'vat'
					? {
							kind: 'vat',
							gross: euros,
							byRate: Object.fromEntries(
								Object.entries(vat.byRate).map(([rate, n]) => [rate, Math.round(n * factor)])
							)
						}
					: { kind: vat.kind, gross: euros };
		}
		// The day(s) it counts on: the invoice date (Soll), or each payment with its share (Ist).
		/** @type {{ day: string, share: number }[]} */
		let when = [];
		if (basis === 'soll') {
			if (issued) when = [{ day: issued, share: 1 }];
			else {
				out.undated.cents += vat.gross;
				out.undated.invoices++;
				continue;
			}
		} else if (vat.gross !== 0) {
			let left = Math.abs(vat.gross);
			for (const tx of payments) {
				if (left <= 0) break;
				const paid = Math.min(Math.abs(Number(tx.amountCents)), left);
				left -= paid;
				when.push({ day: String(tx.bookedOn), share: paid / Math.abs(vat.gross) });
			}
		}
		const here = when.filter((w) => inYear(w.day));
		const countsHere = here.length > 0 || (basis === 'ist' && issued && inYear(issued));
		if (!countsHere) continue;
		out.invoices++;
		const share = here.reduce((s, w) => s + w.share, 0);
		out.turnover += Math.round(vat.gross * share);
		if (vat.kind !== 'vat') {
			if (vat.kind === 'missing') {
				out.missing.cents += vat.gross;
				out.missing.invoices++;
			} else {
				out.none.cents += Math.round(vat.gross * share);
				out.none.invoices++;
			}
			continue;
		}
		addAll(when, vat.byRate);
		if (basis === 'ist' && share < 1) {
			const total = Object.values(vat.byRate).reduce((s, n) => s + n, 0);
			out.open.cents += Math.round(total * (1 - share));
			out.open.invoices++;
		}
	}
	// Turnover is net of VAT: the VAT counted is taken off again.
	out.turnover -= out.year.total;
	return out;
}

// "Beleg finden" in a payment's detail: which receipts it lists.
//
// With no search text it proposes only receipts from around the payment – a
// receipt from half a year away is no answer for a direct debit. A typed search
// text looks through every receipt in the books instead, across all years, and
// also through those already assigned to another payment, which say so.
import { isActive } from './engine.js';
import { dayNumber } from './normalize.js';
import { receiptDay } from './view.js';

/** Days before and after a payment's booking day that count as its period. */
export const FIND_PERIOD_DAYS = 30;

/**
 * The days around a booking day that are its period.
 *
 * @param {string | null | undefined} bookedOn YYYY-MM-DD
 * @param {number} [days]
 * @returns {{ from: string, to: string } | null} YYYY-MM-DD
 */
export function findPeriod(bookedOn, days = FIND_PERIOD_DAYS) {
	const day = dayNumber(bookedOn ?? null);
	if (day === null) return null;
	const iso = (/** @type {number} */ n) => new Date(n * 864e5).toISOString().slice(0, 10);
	return { from: iso(day - days), to: iso(day + days) };
}

/**
 * Whether a receipt is from the payment's period: its date, else the day it
 * came in, at most `days` away from the booking day. A receipt with no day at
 * all is not.
 *
 * @param {Record<string, any>} receipt
 * @param {string | null | undefined} bookedOn
 * @param {number} [days]
 */
export function inFindPeriod(receipt, bookedOn, days = FIND_PERIOD_DAYS) {
	const paid = dayNumber(bookedOn ?? null);
	const day = dayNumber(receiptDay(/** @type {any} */ (receipt)));
	return paid !== null && day !== null && Math.abs(day - paid) <= days;
}

/**
 * The receipts already assigned to another payment, and not just in part (a
 * partly paid one is among `receiptChoices` already, as one more instalment).
 * Each carries the payments it belongs to, so the list can say where it is.
 * Only for a search: they are never proposed by themselves.
 *
 * @template {{ id: string } & Record<string, any>} R
 * @param {Record<string, any>} tx
 * @param {R[]} receipts
 * @param {Record<string, any>[]} matches
 * @param {Record<string, any>[]} transactions
 * @param {{ receipt: { id: string } }[]} choices from receiptChoices: left out here
 * @returns {{ receipt: R, score: number, reasons: string[], suggested: false, assignedTo: Record<string, any>[] }[]}
 */
export function assignedElsewhere(tx, receipts, matches, transactions, choices) {
	const offered = new Set(choices.map((c) => c.receipt.id));
	/** @type {Map<string, string[]>} receipt id → the other payments' ids */
	const elsewhere = new Map();
	for (const m of matches) {
		if (!isActive(m)) continue;
		if (m.transactionId === tx.id) continue;
		elsewhere.set(m.receiptId, [...(elsewhere.get(m.receiptId) ?? []), m.transactionId]);
	}
	const linkedHere = new Set(
		matches.filter((m) => isActive(m) && m.transactionId === tx.id).map((m) => m.receiptId)
	);
	const byId = new Map(transactions.map((t) => [t.id, t]));
	const paid = dayNumber(tx.bookedOn ?? null);
	/** @param {R} r */
	const distance = (r) => {
		const day = dayNumber(receiptDay(r));
		return day === null || paid === null ? Infinity : Math.abs(day - paid);
	};
	return receipts
		.filter(
			(r) =>
				!r.deleted &&
				elsewhere.has(r.id) &&
				!offered.has(r.id) &&
				!linkedHere.has(r.id) &&
				r.status !== 'ignoriert'
		)
		.map((r) => ({
			receipt: r,
			score: 0,
			reasons: [],
			suggested: /** @type {const} */ (false),
			assignedTo: (elsewhere.get(r.id) ?? []).flatMap((id) => {
				const t = byId.get(id);
				return t ? [t] : [];
			})
		}))
		.sort((a, b) => distance(a.receipt) - distance(b.receipt));
}

/**
 * The words of a search text, lower-case.
 *
 * @param {string} text
 */
export function searchWords(text) {
	return String(text ?? '')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * What a search text is compared with for a receipt: vendor, sender, subject,
 * file name, invoice and customer number, the shown amount and day, and the
 * amount as typed (`12,34`, `12.34`, `1234`) – lower-case, in one string.
 *
 * @param {Record<string, any>} r
 * @param {string[]} shown what the row shows, e.g. the formatted amount and day
 */
export function receiptSearchText(r, shown = []) {
	const amounts = [];
	if (typeof r.amountCents === 'number') {
		const abs = Math.abs(r.amountCents);
		const whole = String(Math.trunc(abs / 100));
		const cents = String(abs % 100).padStart(2, '0');
		amounts.push(`${whole},${cents}`, `${whole}.${cents}`);
	}
	return [
		r.vendor,
		r.from,
		r.subject,
		r.fileName,
		r.invoiceNumber,
		r.customerNumber,
		...amounts,
		...shown
	]
		.filter((x) => typeof x === 'string' && x)
		.join(' ')
		.toLowerCase();
}

/**
 * Whether every word is somewhere in the text.
 *
 * @param {string} text from receiptSearchText
 * @param {string[]} words from searchWords
 */
export function findsAll(text, words) {
	return words.every((w) => text.includes(w));
}

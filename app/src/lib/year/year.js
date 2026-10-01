// The fiscal year a payment, a receipt or a question belongs to, for the year
// switch (issue #100). Pure; the matching itself stays across years, so a
// payment in January still finds its invoice from December – only what the
// pages show is filtered.
//
// The year of a thing is the year of its payment:
//   - a payment: the fiscal year of its booking day;
//   - a receipt with a payment (an active match, or the payment's
//     `receiptId`): the year of that payment;
//   - a receipt without one: the year of its own date (document date, else
//     the invoice date read from it, else when it arrived or was added – an
//     upload not read yet has no other), and also every
//     year of a payment an open question offers for it;
//   - a question: the years of what it is about – the payment, or the
//     receipt and the payments it offers.
//
// A fiscal year is named by the calendar year it starts in: with a start in
// July, 2025 runs from 1 July 2025 to 30 June 2026 and is shown as "2025/26".

import { isActive } from '../matching/engine.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @param {unknown} day YYYY-MM-DD (or longer ISO)
 * @param {number} [startMonth] 1–12, the month the fiscal year starts in
 * @returns {number | null}
 */
export function fiscalYearOf(day, startMonth = 1) {
	const m = /^(\d{4})-(\d{2})/.exec(String(day ?? ''));
	if (!m) return null;
	const year = Number(m[1]);
	return Number(m[2]) >= startMonth ? year : year - 1;
}

/**
 * "2026", or "2025/26" when the fiscal year does not start in January.
 *
 * @param {number} year
 * @param {number} [startMonth]
 */
export function yearLabel(year, startMonth = 1) {
	return startMonth === 1 ? String(year) : `${year}/${String(year + 1).slice(-2)}`;
}

/** @param {Rec} r */
export const receiptDay = (r) =>
	r.documentDate ??
	r.extraction?.invoice_date ??
	(typeof r.receivedAt === 'string' ? r.receivedAt.slice(0, 10) : null) ??
	(typeof r.createdAt === 'string' ? r.createdAt.slice(0, 10) : null);

/**
 * A receipt with no day of its own yet: uploaded or from a folder, not read
 * and no date typed. It belongs to no year, so the Belege page shows it in
 * every year – else a receipt for last year, uploaded today, would hide
 * under this year until it is read.
 *
 * @param {Rec} r
 */
export const isUndated = (r) =>
	!r.deleted && !r.documentDate && !r.extraction?.invoice_date && typeof r.receivedAt !== 'string';

/**
 * @param {{ transactions: Rec[], receipts: Rec[], matches: Rec[], questions: Rec[] }} books
 * @param {number} [startMonth]
 */
export function yearIndex({ transactions, receipts, matches, questions }, startMonth = 1) {
	/** @param {unknown} day */
	const fy = (day) => fiscalYearOf(day, startMonth);
	/** @type {Map<string, number | null>} */
	const txYear = new Map(transactions.map((t) => [String(t.id), fy(t.bookedOn)]));

	/** @type {Map<string, Set<number>>} receipt id → years of its payments */
	const paidIn = new Map();
	/** @param {unknown} receiptId @param {unknown} transactionId */
	const paid = (receiptId, transactionId) => {
		const y = txYear.get(String(transactionId));
		if (y === undefined || y === null) return;
		const set = paidIn.get(String(receiptId)) ?? new Set();
		paidIn.set(String(receiptId), set.add(y));
	};
	for (const m of matches) if (isActive(m)) paid(m.receiptId, m.transactionId);
	for (const t of transactions) if (t.receiptId && !t.deleted) paid(t.receiptId, t.id);

	/** @type {Map<string, Set<number>>} receipt id → years of payments offered for it */
	const offeredIn = new Map();
	for (const q of questions) {
		if (q.deleted || q.state !== 'open' || !q.receiptId) continue;
		for (const c of q.candidates ?? []) {
			const y = txYear.get(String(c.transactionId));
			if (y === undefined || y === null) continue;
			const set = offeredIn.get(String(q.receiptId)) ?? new Set();
			offeredIn.set(String(q.receiptId), set.add(y));
		}
	}
	const receiptById = new Map(receipts.map((r) => [String(r.id), r]));

	/**
	 * @param {Rec} r
	 * @returns {Set<number>}
	 */
	function receiptYears(r) {
		const paidYears = paidIn.get(String(r.id));
		if (paidYears?.size) return paidYears;
		const years = new Set(offeredIn.get(String(r.id)) ?? []);
		const own = fy(receiptDay(r));
		if (own !== null) years.add(own);
		return years;
	}

	return {
		/** @param {Rec} t */
		txYear: (t) => txYear.get(String(t.id)) ?? fy(t.bookedOn),
		receiptYears,
		/**
		 * The receipt's own year when it differs from the year it is shown in
		 * (an invoice from December paid in January), else null.
		 *
		 * @param {Rec} r
		 * @param {number} year
		 */
		otherYear(r, year) {
			const own = fy(receiptDay(r));
			return own !== null && own !== year && paidIn.get(String(r.id))?.has(year) ? own : null;
		},
		/**
		 * @param {Rec} q
		 * @returns {Set<number>}
		 */
		questionYears(q) {
			/** @type {Set<number>} */
			const years = new Set();
			const ty = q.transactionId ? txYear.get(String(q.transactionId)) : null;
			if (ty !== undefined && ty !== null) years.add(ty);
			const r = q.receiptId ? receiptById.get(String(q.receiptId)) : null;
			if (r) for (const y of receiptYears(r)) years.add(y);
			for (const c of q.candidates ?? []) {
				const y = txYear.get(String(c.transactionId));
				if (y !== undefined && y !== null) years.add(y);
			}
			return years;
		}
	};
}

/**
 * The years to offer: those with bookings or receipts, and the current one, newest first.
 *
 * @param {{ transactions: Rec[], receipts: Rec[] }} books
 * @param {string} now ISO time
 * @param {number} [startMonth]
 */
export function availableYears({ transactions, receipts }, now, startMonth = 1) {
	const years = new Set([/** @type {number} */ (fiscalYearOf(now, startMonth))]);
	for (const t of transactions) {
		const y = t.deleted ? null : fiscalYearOf(t.bookedOn, startMonth);
		if (y !== null) years.add(y);
	}
	for (const r of receipts) {
		const y = r.deleted ? null : fiscalYearOf(receiptDay(r), startMonth);
		if (y !== null) years.add(y);
	}
	return [...years].sort((a, b) => b - a);
}

/**
 * The year shown when none is chosen: the newest with a payment, else today's.
 * Early in January the books are still last year's.
 *
 * @param {{ transactions: Rec[] }} books
 * @param {string} now ISO time
 * @param {number} [startMonth]
 */
export function defaultYear({ transactions }, now, startMonth = 1) {
	let newest = null;
	for (const t of transactions) {
		const y = t.deleted ? null : fiscalYearOf(t.bookedOn, startMonth);
		if (y !== null && (newest === null || y > newest)) newest = y;
	}
	return newest ?? /** @type {number} */ (fiscalYearOf(now, startMonth));
}

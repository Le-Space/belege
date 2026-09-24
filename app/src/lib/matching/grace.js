// The grace period: a debit often comes days before its receipt. A booking
// without a receipt is asked about ("Fehlender Beleg") only once it is older
// than `graceDays` (Eigene Anweisungen, default 7). Until then it still counts
// as uncovered, and the pages say "wartet noch (x Tage)".
//
// Older than: a booking of 1 September with 7 days is asked about from
// 9 September on (8 days old), not on the 8th. 0 turns the grace off.

import { dayNumber } from './normalize.js';

/** The local calendar day of a moment, YYYY-MM-DD: what "today" is for the person. */
export function localDay(/** @type {Date} */ now = new Date()) {
	const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Whole days since the booking, by calendar day; null without a date.
 *
 * @param {Record<string, any>} tx with `bookedOn`
 * @param {string} today YYYY-MM-DD
 */
export function bookingAgeDays(tx, today) {
	const booked = dayNumber(tx.bookedOn);
	const now = dayNumber(today);
	return booked === null || now === null ? null : now - booked;
}

/**
 * How many more days until a missing receipt becomes a question, or null
 * when it is asked about already (or the grace is off, or there is no date).
 *
 * @param {Record<string, any>} tx with `bookedOn`
 * @param {number} graceDays
 * @param {string} today YYYY-MM-DD
 * @returns {number | null}
 */
export function graceWait(tx, graceDays, today) {
	if (!graceDays) return null;
	const age = bookingAgeDays(tx, today);
	if (age === null || age > graceDays) return null;
	return graceDays - age + 1;
}

// What the travel screens show (issue #213, step 3), pure: a trip's
// receipts, the trips a receipt may belong to, who probably paid it, a
// hospitality bill's split, and the questions travel asks.
//
// Questions are worked out from the books each time, not stored: they go
// away as soon as what they ask for is there.
//   receiptWithoutTrip     a ticket not assigned to any trip
//   tripWithoutTimes       no allowance can be computed
//   tripIncomplete         no destination, no reason, a mileage line without km or date
//   hospitalityIncomplete  a hospitality bill without place, participants, occasion or tip recipient

import { matchOfReceipt } from '../matching/view.js';
import { isOutlay } from '../outlays/outlays.js';
import { receiptDate } from '../receipts/view.js';
import { hospitality } from './hospitality.js';
import { cleanTrip } from './records.js';

/** @typedef {Record<string, any>} Rec */

/** @param {Rec} r */
const counts = (r) => !r.deleted && r.status !== 'ignoriert';

/** The trips, earliest first. @param {Rec[]} travel the travel collection's */
export const allTrips = (travel) =>
	travel
		.filter((r) => r.kind === 'trip' && !r.deleted)
		.sort((a, b) => String(a.start).localeCompare(String(b.start)));

/** @param {Rec[]} receipts @param {string} tripId */
export const receiptsOfTrip = (receipts, tripId) =>
	receipts.filter((r) => counts(r) && r.travel?.tripId === tripId);

/** A receipt the extraction read as a ticket: travel, most likely. @param {Rec} r */
export const isTravelReceipt = (r) => r.extraction?.document_type === 'ticket';

/** @param {string} day @param {number} days */
const shift = (day, days) => {
	const d = new Date(`${day}T00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

/**
 * The trips a receipt may belong to: those whose days, a day either side
 * (a ticket bought the day before), take in the receipt's date; the closest
 * first. Trips without times come last, as they cannot be told.
 *
 * @param {Rec} receipt
 * @param {Rec[]} trips
 */
export function suggestTrips(receipt, trips) {
	const day = receiptDate(/** @type {any} */ (receipt));
	if (!day) return [];
	return trips
		.filter((t) => t.start && t.end)
		.filter((t) => shift(t.start.slice(0, 10), -1) <= day && day <= shift(t.end.slice(0, 10), 1))
		.sort(
			(a, b) =>
				Math.abs(Date.parse(a.start.slice(0, 10)) - Date.parse(day)) -
				Math.abs(Date.parse(b.start.slice(0, 10)) - Date.parse(day))
		);
}

/**
 * Who most likely paid a receipt: privately where it is booked as an outlay
 * or linked to nothing, the company where a payment of its account covers it.
 *
 * @param {Rec} receipt
 * @param {{ transactions: Rec[], matches: Rec[] }} books
 * @returns {'private' | 'company'}
 */
export function paidByGuess(receipt, { transactions, matches }) {
	const match = matchOfReceipt(receipt.id, matches);
	if (!match) return 'private';
	const tx = transactions.find((t) => t.id === match.transactionId);
	return tx && !isOutlay(tx) ? 'company' : 'private';
}

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;

/**
 * A hospitality bill's figures, from its amount and the VAT it was read with.
 *
 * @param {Rec} receipt with `hospitality`
 */
export function hospitalityOf(receipt) {
	const e = receipt.extraction ?? {};
	const grossCents = Number.isSafeInteger(receipt.amountCents)
		? receipt.amountCents
		: cents(e.gross);
	const vatCents = (Array.isArray(e.vat) ? e.vat : []).reduce(
		(/** @type {number} */ s, /** @type {any} */ v) => s + cents(v?.amount),
		0
	);
	const h = receipt.hospitality ?? {};
	return hospitality({
		date: receiptDate(/** @type {any} */ (receipt)) ?? new Date().toISOString().slice(0, 10),
		grossCents,
		vatCents,
		tipCents: h.tipCents ?? 0,
		tipTo: h.tipTo,
		place: h.place,
		participants: h.participants,
		occasion: h.occasion
	});
}

/**
 * @typedef {{ kind: 'receiptWithoutTrip', receiptId: string }
 *   | { kind: 'tripWithoutTimes', tripId: string }
 *   | { kind: 'tripIncomplete', tripId: string, problems: string[] }
 *   | { kind: 'hospitalityIncomplete', receiptId: string, missing: string[] }} TravelQuestion
 */

/**
 * @param {{ travel: Rec[], receipts: Rec[] }} books
 * @returns {TravelQuestion[]}
 */
export function travelQuestions({ travel, receipts }) {
	/** @type {TravelQuestion[]} */
	const out = [];
	for (const trip of allTrips(travel)) {
		const { problems } = cleanTrip(trip);
		if (problems.includes('noTimes') || problems.includes('endBeforeStart'))
			out.push({ kind: 'tripWithoutTimes', tripId: trip.id });
		const rest = problems.filter(
			(p) => p !== 'noTimes' && p !== 'endBeforeStart' && p !== 'noTraveller'
		);
		if (rest.length) out.push({ kind: 'tripIncomplete', tripId: trip.id, problems: rest });
	}
	const trips = new Set(allTrips(travel).map((t) => t.id));
	for (const r of receipts) {
		if (!counts(r)) continue;
		if (isTravelReceipt(r) && !(r.travel?.tripId && trips.has(r.travel.tripId)) && !r.hospitality)
			out.push({ kind: 'receiptWithoutTrip', receiptId: r.id });
		if (r.hospitality) {
			const { missing } = hospitalityOf(r);
			if (missing.length) out.push({ kind: 'hospitalityIncomplete', receiptId: r.id, missing });
		}
	}
	return out;
}

/**
 * Euros as typed, either decimal mark, into cents: `5`, `5,5`, `12.40`.
 * Anything else is `null`.
 *
 * @param {string} text
 */
export function euroCents(text) {
	const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(String(text ?? '').trim());
	return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}

/** A trip's days as a short line: `04.05.–05.05.2026`, or the one day. @param {Rec} trip @param {(day: string) => string} formatDate */
export function tripDays(trip, formatDate) {
	if (!trip.start) return '';
	const from = trip.start.slice(0, 10);
	const to = (trip.end || trip.start).slice(0, 10);
	return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

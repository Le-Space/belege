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
import { guessTravel, receiptWords } from './words.js';

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

/**
 * What kind of travel cost a receipt was read as (the extraction's `travel`,
 * #213 step 4): a train, a hotel, a restaurant …; `ticket` where only the
 * document type says so (a reading before the travel fields); else null.
 *
 * @param {Rec} r
 * @returns {string | null}
 */
export function readTravelKind(r) {
	const kind = r.extraction?.travel?.kind;
	if (typeof kind === 'string' && kind) return kind;
	return r.extraction?.document_type === 'ticket' ? 'ticket' : null;
}

/**
 * What the words of a receipt that was not read as travel suggest (#366,
 * words.js): from its PDF's text where this device looked once
 * (`travelGuess`), else from its file name, subject, sender and excerpt.
 *
 * @param {Rec} r
 * @returns {{ kind: string, words: string[] } | null}
 */
export function guessedTravel(r) {
	if (readTravelKind(r)) return null;
	if (r.travelGuess?.kind) return r.travelGuess;
	return guessTravel(receiptWords(r));
}

/**
 * The kind of travel cost a receipt is, as read, or else as its words
 * suggest; null for anything else.
 *
 * @param {Rec} r
 * @returns {string | null}
 */
export const travelKind = (r) => readTravelKind(r) ?? guessedTravel(r)?.kind ?? null;

/** Costs that are travel without doubt: without a trip, they are asked about. */
const ASKED = new Set(['train', 'bus', 'flight', 'hotel', 'rental_car', 'ticket']);

/**
 * What a receipt's kind suggests: a trip (a fare, a hotel, fuel …), a
 * hospitality meal (a restaurant), or an event (a ticket to one); null for
 * anything else.
 *
 * @param {Rec} r
 * @returns {'trip' | 'hospitality' | 'event' | null}
 */
export function travelHint(r) {
	const kind = travelKind(r);
	if (!kind) return null;
	if (kind === 'restaurant') return 'hospitality';
	if (kind === 'event') return 'event';
	return 'trip';
}

/**
 * A receipt read as travel without doubt, asked about without a trip. Words
 * alone (words.js) give a hint, never a question.
 *
 * @param {Rec} r
 */
export const isTravelReceipt = (r) => ASKED.has(readTravelKind(r) ?? '');

/** @param {string} day @param {string} time */
const at = (day, time) => `${day}T${time}`;

/**
 * A new trip's head from a receipt, as far as it was read: a ticket's
 * departure and arrival (the way back where it is a return ticket), a
 * hotel's nights, the destination or the town. The rest is the receipt's
 * day, from 8 to 18, to be put right on the trip's page; with only the way
 * there known, no end.
 *
 * @param {Rec} r
 * @returns {{ destination: string, start: string, end: string } | { destination: string }}
 */
export function tripFromReceipt(r) {
	const t = r.extraction?.travel ?? {};
	const destination = String(t.to ?? t.place ?? '').trim();
	const start = t.departure ?? (t.check_in ? at(t.check_in, '08:00') : null);
	const end =
		t.return_arrival ??
		t.return_departure ??
		(t.check_out ? at(t.check_out, '18:00') : null) ??
		t.arrival ??
		null;
	if (start && end && end > start) return { destination, start, end };
	const day = receiptDate(/** @type {any} */ (r));
	// Only the way there is known: the way back is asked for on the trip's page.
	if (start) return { destination, start, end: '' };
	return day ? { destination, start: at(day, '08:00'), end: at(day, '18:00') } : { destination };
}

/**
 * The mornings a hotel invoice of the trip says breakfast was included, and
 * the trip does not have it yet: the day after each night, within the trip.
 *
 * @param {Rec} trip
 * @param {Rec[]} receipts the trip's
 * @returns {string[]} dates, earliest first
 */
export function breakfastProposals(trip, receipts) {
	if (!trip.start || !trip.end) return [];
	const from = trip.start.slice(0, 10);
	const to = trip.end.slice(0, 10);
	const out = new Set();
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (t?.kind !== 'hotel' || t.breakfast_included !== true || !t.check_in || !t.check_out)
			continue;
		for (let day = shift(t.check_in, 1); day <= t.check_out; day = shift(day, 1)) {
			if (day >= from && day <= to && trip.meals?.[day]?.breakfast !== true) out.add(day);
		}
	}
	return [...out].sort();
}

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
	// An outlay (#293) or a travel statement's own booking (#213): paid privately.
	return tx && !isOutlay(tx) && tx.source !== 'travel' ? 'company' : 'private';
}

/** A receipt's currency, as read: EUR where it says none. @param {Rec} r */
export const receiptCurrency = (r) =>
	String(r.currency ?? r.extraction?.currency ?? 'EUR').toUpperCase();

/**
 * @typedef {object} EuroValue
 * @property {number | null} cents the receipt's gross in euros; null: not known
 * @property {'eur' | 'outlay' | 'payment' | 'rate' | null} via
 *   eur: the receipt is in euros; outlay: booked as a private outlay in euros (#293);
 *   payment: a linked payment in euros; rate: a rate kept with the receipt's trip link
 * @property {string} currency the receipt's own
 * @property {number | null} originalCents its gross in its own currency
 * @property {string | null} rate EUR per unit, for `rate`
 */

/**
 * What a receipt on a trip is in euros (#213): never its amount in another
 * currency taken as euros.
 *
 * @param {Rec} r
 * @param {{ transactions?: Rec[], matches?: Rec[] }} [books]
 * @returns {EuroValue}
 */
export function euroOf(r, { transactions = [], matches = [] } = {}) {
	const currency = receiptCurrency(r);
	const originalCents = Number.isSafeInteger(r.amountCents) ? Math.abs(r.amountCents) : null;
	const base = { currency, originalCents, rate: null };
	if (currency === 'EUR') return { ...base, cents: originalCents, via: 'eur' };
	const outlay = transactions.find(
		(t) => !t.deleted && isOutlay(t) && t.outlay?.receiptId === r.id
	);
	if (outlay && Number.isSafeInteger(outlay.amountCents))
		return { ...base, cents: Math.abs(outlay.amountCents), via: 'outlay' };
	const match = matchOfReceipt(r.id, matches);
	const paid = match ? transactions.find((t) => t.id === match.transactionId && !t.deleted) : null;
	if (
		paid &&
		!isOutlay(paid) &&
		paid.source !== 'travel' &&
		String(paid.currency ?? 'EUR').toUpperCase() === 'EUR' &&
		Number.isSafeInteger(paid.amountCents)
	)
		return { ...base, cents: Math.abs(paid.amountCents), via: 'payment' };
	const kept = r.travel?.euro;
	if (kept && Number.isSafeInteger(kept.cents))
		return { ...base, cents: kept.cents, via: 'rate', rate: String(kept.rate ?? '') };
	return { ...base, cents: null, via: null };
}

/** @param {unknown} amount in euros */
const cents = (amount) =>
	typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;

/**
 * A hospitality bill's figures, from its amount and the VAT it was read with.
 * A bill in another currency counts in euros (euroOf; nothing while no rate
 * is known), and its VAT is no German input VAT: part of the cost.
 *
 * @param {Rec} receipt with `hospitality`
 * @param {{ transactions?: Rec[], matches?: Rec[] }} [books]
 */
export function hospitalityOf(receipt, books = {}) {
	const e = receipt.extraction ?? {};
	const euro = euroOf(receipt, books);
	const grossCents =
		euro.currency === 'EUR'
			? Number.isSafeInteger(receipt.amountCents)
				? receipt.amountCents
				: cents(e.gross)
			: (euro.cents ?? 0);
	const vatCents =
		euro.currency === 'EUR'
			? (Array.isArray(e.vat) ? e.vat : []).reduce(
					(/** @type {number} */ s, /** @type {any} */ v) => s + cents(v?.amount),
					0
				)
			: 0;
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
 *   | { kind: 'hospitalityIncomplete', receiptId: string, missing: string[] }
 *   | { kind: 'statementNotPaidOut', statementId: string, number: string, month: string, openCents: number }} TravelQuestion
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

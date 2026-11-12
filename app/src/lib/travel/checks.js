// Where a trip does not add up (#693, part b): checks by rule on a trip and
// its receipts, each a question for the person, never a change. Pure.
//
//   night       a night of the trip with no accommodation receipt, no flat
//               rate ticked (lodging.js) and no leg running through it – a
//               receipt missing, or a night on a train or plane
//   gap         a leg arrives in one place, the next leaves from another:
//               a ride missing (or made by car, on foot, without a ticket)
//   endsAbroad  the last leg ends in another country than the trip began in,
//               with no way back: where does the business trip end?
//   outside     a leg before the trip's departure or after its return
//
// Long-distance legs only (train, bus, flight): a taxi or a tram ride from a
// hotel to a coworking space joins no chain. Places are the same when their
// airport codes match, or their names share a word; two countries that
// differ are two places. A different script for one town (Latin and
// Cyrillic) may read as a gap – the person answers "Passt so", which is kept
// on the trip (`checked`) and asks no more.

import { placeKey } from './route.js';

/** @typedef {Record<string, any>} Rec */

/** The kinds that carry the traveller between towns. */
const CHAIN = new Set(['train', 'bus', 'flight']);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const IATA = /^[A-Z]{3}$/;

/**
 * @typedef {object} Segment
 * @property {string} receiptId
 * @property {string} dep departure, local time
 * @property {string} arr arrival, local time
 * @property {{ name: string, country: string | null, iata: string | null }} from
 * @property {{ name: string, country: string | null, iata: string | null }} to
 */

/** @param {any} name @param {any} country @param {any} iata */
const place = (name, country, iata) => ({
	name: String(name ?? '').trim(),
	country: typeof country === 'string' && COUNTRY.test(country) ? country : null,
	iata: typeof iata === 'string' && IATA.test(iata) ? iata : null
});

/**
 * The long-distance legs of some receipts with departure and arrival, a
 * return ticket's way back as a leg of its own; earliest first.
 *
 * @param {Rec[]} receipts
 * @returns {Segment[]}
 */
export function segmentsOf(receipts) {
	/** @type {Segment[]} */
	const out = [];
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (!t || !CHAIN.has(t.kind)) continue;
		const a = place(t.from, t.from_country, t.from_iata);
		const b = place(t.to, t.to_country, t.to_iata);
		if (TIME.test(t.departure ?? '') && TIME.test(t.arrival ?? ''))
			out.push({ receiptId: String(r.id), dep: t.departure, arr: t.arrival, from: a, to: b });
		if (TIME.test(t.return_departure ?? '') && TIME.test(t.return_arrival ?? ''))
			out.push({
				receiptId: String(r.id),
				dep: t.return_departure,
				arr: t.return_arrival,
				from: b,
				to: a
			});
	}
	return out.sort((x, y) => x.dep.localeCompare(y.dep));
}

/** The words of a place's name worth comparing. @param {string} name */
const words = (name) =>
	new Set(
		placeKey(name)
			.split(' ')
			.filter((w) => w.length >= 3)
	);

/**
 * Whether two ends of legs are the same place – or cannot be told apart.
 *
 * @param {Segment['to']} a
 * @param {Segment['from']} b
 */
export function samePlace(a, b) {
	if (a.iata && b.iata) return a.iata === b.iata;
	if (a.country && b.country && a.country !== b.country) return false;
	if (!a.name || !b.name) return true;
	const left = words(a.name);
	for (const w of words(b.name)) if (left.has(w)) return true;
	return left.size === 0;
}

/** The day after. @param {string} day */
const nextDay = (day) => {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};

/** The nights between two days: the evening of each, from the first day to the one before the last. @param {string} from @param {string} to */
function nights(from, to) {
	const out = [];
	for (let day = from; day < to && out.length <= 366; day = nextDay(day)) out.push(day);
	return out;
}

/**
 * @typedef {{ kind: 'night', key: string, date: string }
 *   | { kind: 'gap', key: string, after: Segment, before: Segment }
 *   | { kind: 'endsAbroad', key: string, country: string, place: string, at: string, receiptId: string }
 *   | { kind: 'outside', key: string, receiptId: string, at: string, side: 'before' | 'after' }} TripCheck
 */

/**
 * What does not add up on a trip, less what the person has answered
 * ("Passt so": `trip.checked`).
 *
 * @param {Rec} trip
 * @param {Rec[]} receipts the trip's (view.js receiptsOfTrip)
 * @returns {TripCheck[]}
 */
export function tripChecks(trip, receipts) {
	const segments = segmentsOf(receipts);
	/** @type {TripCheck[]} */
	const out = [];
	const start = TIME.test(trip?.start ?? '') ? trip.start : null;
	const end = TIME.test(trip?.end ?? '') ? trip.end : null;

	// Nights: only with both times, not for a day trip, and only where the
	// trip has receipts read as travel – a trip typed by hand, by car, with
	// none at all is not asked about each night.
	const read = receipts.some((r) => r.extraction?.travel?.kind);
	if (read && start && end && end > start && trip.overnight !== false) {
		const covered = new Set(Array.isArray(trip.nights) ? trip.nights : []);
		for (const r of receipts) {
			const t = r.extraction?.travel;
			if (t?.kind === 'hotel' && DAY.test(t.check_in ?? '') && DAY.test(t.check_out ?? ''))
				for (const n of nights(t.check_in, t.check_out)) covered.add(n);
		}
		// A leg running through midnight: the night spent on it.
		for (const s of segments)
			for (const n of nights(s.dep.slice(0, 10), s.arr.slice(0, 10))) covered.add(n);
		for (const date of nights(start.slice(0, 10), end.slice(0, 10)))
			if (!covered.has(date)) out.push({ kind: 'night', key: `night:${date}`, date });
	}

	// Gaps: each leg against the one after it.
	for (let i = 1; i < segments.length; i++) {
		const after = segments[i - 1];
		const before = segments[i];
		if (!samePlace(after.to, before.from))
			out.push({
				kind: 'gap',
				key: `gap:${after.receiptId}:${before.receiptId}:${before.dep}`,
				after,
				before
			});
	}

	// Ends abroad: the last arrival in another country than the start, no way back.
	const home =
		typeof trip?.country === 'string' && COUNTRY.test(trip.country) ? trip.country : 'DE';
	const last = [...segments].sort((x, y) => x.arr.localeCompare(y.arr)).at(-1);
	if (last?.to.country && last.to.country !== home)
		out.push({
			kind: 'endsAbroad',
			key: 'endsAbroad',
			country: last.to.country,
			place: last.to.name,
			at: last.arr,
			receiptId: last.receiptId
		});

	// Legs outside the trip's times.
	for (const s of segments) {
		if (start && s.dep < start)
			out.push({
				kind: 'outside',
				key: `outside:${s.receiptId}:${s.dep}`,
				receiptId: s.receiptId,
				at: s.dep,
				side: 'before'
			});
		else if (end && s.arr > end)
			out.push({
				kind: 'outside',
				key: `outside:${s.receiptId}:${s.dep}`,
				receiptId: s.receiptId,
				at: s.arr,
				side: 'after'
			});
	}

	const answered = new Set(Array.isArray(trip?.checked) ? trip.checked : []);
	return out.filter((c) => !answered.has(c.key));
}

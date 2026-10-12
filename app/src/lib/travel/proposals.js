// Trip proposals (issue #213, step 4b), by rules, not by AI: receipts read
// as travel (extraction.travel, #365) that belong to no trip yet are grouped
// by their days and their route into proposals. One click makes a proposal
// a trip, or adds it to the trip it falls into; one click dismisses it, and
// a dismissed proposal is not offered again. Pure.
//
// What groups:
//   seeds    fares (train, bus, flight) and hotels: they say where and when.
//            Pieces overlap or touch (the same day) → one trip; days between
//            them (up to a week) only while the journey is still away and
//            goes on where it ended: Monday there and Wednesday back is one
//            trip, Monday there and back and Thursday there and back are two.
//   joiners  taxi, fuel, parking, rental car, restaurant, event: their day
//            falls into a seeded trip → they join it; into a trip already
//            there → offered for that trip. Otherwise they propose nothing:
//            a dinner at home is no trip.
// A receipt known only by its words (words.js) proposes nothing either: a
// guess has no days and no route.

import { receiptDate } from '../receipts/view.js';
import { allTrips, travelQuestions } from './view.js';
import { appointmentsOn } from './appointments.js';

/** @typedef {Record<string, any>} Rec */

const FARES = new Set(['train', 'bus', 'flight']);
const JOINERS = new Set([
	'taxi',
	'fuel',
	'parking',
	'rental_car',
	'restaurant',
	'event',
	'public_transport'
]);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} day @param {number} n */
const shift = (day, n) => {
	const d = new Date(`${day}T00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};
/** A place to compare: no case, no accents, no "Hbf". @param {unknown} s */
const placeKey = (s) =>
	String(s ?? '')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\b(hbf|hauptbahnhof|central|centrale|station|airport|flughafen)\b/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/**
 * @typedef {object} Piece
 * @property {Rec} receipt
 * @property {string} kind
 * @property {string} fromDay first day, YYYY-MM-DD
 * @property {string} toDay last day
 * @property {string | null} start a time, where printed
 * @property {string | null} end
 * @property {string} from where a fare starts
 * @property {string} to where it goes, or the hotel's town
 */

/**
 * What one receipt says about the days and the route of a trip.
 *
 * @param {Rec} r
 * @returns {Piece | null}
 */
export function pieceOf(r) {
	const t = r.extraction?.travel;
	const kind = t?.kind;
	if (!kind || (!FARES.has(kind) && kind !== 'hotel' && !JOINERS.has(kind))) return null;
	const day = receiptDate(/** @type {any} */ (r));
	if (kind === 'hotel') {
		if (!DAY.test(t.check_in ?? '') || !DAY.test(t.check_out ?? '') || t.check_out < t.check_in)
			return null;
		return {
			receipt: r,
			kind,
			fromDay: t.check_in,
			toDay: t.check_out,
			start: null,
			end: null,
			from: '',
			to: String(t.place ?? '').trim()
		};
	}
	const times = [t.departure, t.arrival, t.return_departure, t.return_arrival].filter(
		(x) => typeof x === 'string' && TIME.test(x)
	);
	const start = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
	const end = times.length > 1 ? times.reduce((a, b) => (a > b ? a : b)) : null;
	const fromDay = start ? start.slice(0, 10) : day;
	if (!fromDay) return null;
	return {
		receipt: r,
		kind,
		fromDay,
		toDay: end ? end.slice(0, 10) : fromDay,
		start,
		end,
		from: String(t.from ?? '').trim(),
		to: String(t.to ?? t.place ?? '').trim()
	};
}

/**
 * @typedef {object} Proposal
 * @property {string} key the receipts' ids, sorted: what a dismissal keeps
 * @property {string[]} receiptIds
 * @property {string[]} kinds
 * @property {string} destination
 * @property {string} start YYYY-MM-DDTHH:MM, a printed time or the first day's 08:00
 * @property {string} end a printed time or the last day's 18:00
 * @property {string | null} tripId an existing trip these days fall into: added to it, not a new one
 * @property {string} reason the title of an appointment on these days (appointments.js), else ''
 */

/** Whether `b` starts where `a` ended: the journey goes on. @param {Piece} a @param {Piece} b */
const continues = (a, b) => Boolean(placeKey(a.to)) && placeKey(a.to) === placeKey(b.from);

/**
 * Whether a group is still away: its last piece did not lead back to where
 * its first one left from.
 *
 * @param {Piece[]} pieces
 */
const away = (pieces) => {
	const last = pieces[pieces.length - 1];
	return Boolean(placeKey(last.to)) && placeKey(last.to) !== placeKey(pieces[0].from);
};

/** How many days a journey may go on without a receipt between (staying with someone, a company card). */
const GAP_DAYS = 7;

/**
 * The proposals the books make now.
 *
 * @param {{ receipts: Rec[], travel: Rec[] }} books
 * @returns {Proposal[]} earliest first
 */
export function tripProposals({ receipts, travel }) {
	const trips = allTrips(travel);
	const tripIds = new Set(trips.map((x) => x.id));
	const dismissed = new Set(
		travel.filter((r) => r.kind === 'dismissed' && !r.deleted).map((r) => String(r.key))
	);
	const free = receipts.filter(
		(r) =>
			!r.deleted && r.status !== 'ignoriert' && !(r.travel?.tripId && tripIds.has(r.travel.tripId))
	);
	/** @type {Piece[]} */
	const pieces = free.map(pieceOf).filter((p) => p !== null);
	const seeds = pieces
		.filter((p) => FARES.has(p.kind) || p.kind === 'hotel')
		.sort(
			(a, b) => a.fromDay.localeCompare(b.fromDay) || String(a.start).localeCompare(String(b.start))
		);

	/** @type {{ pieces: Piece[], fromDay: string, toDay: string }[]} */
	const groups = [];
	for (const p of seeds) {
		const last = groups[groups.length - 1];
		const touches = last && p.fromDay <= last.toDay;
		const goesOn =
			last &&
			p.fromDay <= shift(last.toDay, GAP_DAYS) &&
			away(last.pieces) &&
			continues(last.pieces[last.pieces.length - 1], p);
		if (last && (touches || goesOn)) {
			last.pieces.push(p);
			if (p.toDay > last.toDay) last.toDay = p.toDay;
		} else {
			groups.push({ pieces: [p], fromDay: p.fromDay, toDay: p.toDay });
		}
	}
	for (const p of pieces) {
		if (!JOINERS.has(p.kind)) continue;
		const g = groups.find((x) => x.fromDay <= p.fromDay && p.fromDay <= x.toDay);
		if (g) g.pieces.push(p);
		// On a day of a trip already there: offered for that trip on its own.
		else if (tripOn(trips, p.fromDay, p.toDay))
			groups.push({ pieces: [p], fromDay: p.fromDay, toDay: p.toDay });
	}
	groups.sort((a, b) => a.fromDay.localeCompare(b.fromDay));

	/** @type {Proposal[]} */
	const out = [];
	for (const g of groups) {
		const ids = g.pieces.map((p) => String(p.receipt.id)).sort();
		const key = ids.join('|');
		if (dismissed.has(key)) continue;
		const starts = g.pieces
			.map((p) => p.start)
			.filter((x) => x !== null)
			.sort();
		const ends = g.pieces
			.map((p) => p.end)
			.filter((x) => x !== null)
			.sort();
		const start =
			starts[0] && starts[0].slice(0, 10) === g.fromDay ? starts[0] : `${g.fromDay}T08:00`;
		const lastEnd = ends[ends.length - 1];
		const end = lastEnd && lastEnd.slice(0, 10) === g.toDay ? lastEnd : `${g.toDay}T18:00`;
		const existing = tripOn(trips, g.fromDay, g.toDay);
		out.push({
			key,
			receiptIds: ids,
			kinds: [...new Set(g.pieces.map((p) => p.kind))],
			destination: destinationOf(g.pieces),
			start,
			end: end > start ? end : `${g.toDay}T23:59`,
			tripId: existing?.id ?? null,
			reason: appointmentsOn(travel, g.fromDay, g.toDay)[0]?.summary ?? ''
		});
	}
	return out;
}

/**
 * The trip whose days overlap these.
 *
 * @param {Rec[]} trips
 * @param {string} fromDay
 * @param {string} toDay
 */
const tripOn = (trips, fromDay, toDay) =>
	trips.find(
		(x) => x.start && x.end && x.start.slice(0, 10) <= toDay && fromDay <= x.end.slice(0, 10)
	) ?? null;

/**
 * Where a group of pieces goes: the town a hotel names, else the place the
 * fares reach most often that is not where the first one left from.
 *
 * @param {Piece[]} pieces
 */
function destinationOf(pieces) {
	const hotel = pieces.find((p) => p.kind === 'hotel' && p.to);
	if (hotel) return hotel.to;
	const fares = pieces.filter((p) => FARES.has(p.kind));
	const home = placeKey(fares[0]?.from);
	/** @type {Map<string, { name: string, n: number }>} */
	const count = new Map();
	for (const p of fares) {
		const k = placeKey(p.to);
		if (!k || k === home) continue;
		const c = count.get(k) ?? { name: p.to, n: 0 };
		c.n++;
		count.set(k, c);
	}
	return [...count.values()].sort((a, b) => b.n - a.n)[0]?.name ?? '';
}

/**
 * What travel still asks (view.js `travelQuestions`), less the receipts a
 * proposal already covers – its click answers them – and those of a
 * proposal dismissed as no trip.
 *
 * @param {{ receipts: Rec[], travel: Rec[] }} books
 * @returns {import('./view.js').TravelQuestion[]}
 */
export function openTravelQuestions(books) {
	const covered = new Set([
		...tripProposals(books).flatMap((p) => p.receiptIds),
		...books.travel
			.filter((r) => r.kind === 'dismissed' && !r.deleted)
			.flatMap((r) => String(r.key).split('|'))
	]);
	return travelQuestions(books).filter(
		(q) => q.kind !== 'receiptWithoutTrip' || !covered.has(q.receiptId)
	);
}

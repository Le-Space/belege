// Splitting a trip in two, and joining two into one (#693, part b). Each on
// a click, never by itself; the rules here say where a split would fall and
// which trips could be one, and how receipts, crossings, meals, nights and
// mileage go along. A trip on a closed statement is neither split nor joined:
// the statement printed it as it was.
//
//   split   at two moments: the first trip ends at `end`, the second starts
//           at `start` (the days between are at home, in neither). A receipt
//           goes by its moment – a ticket's departure, a hotel's check-in, else
//           its day – a crossing, meal, night and mileage line by its time or
//           day: before `start` to the first, from it on to the second.
//   suggest a leg arriving home, the next leg leaving home a day or more later:
//           "In zwei Reisen teilen?"
//   join    two trips of one traveller, at most a week apart: one trip from
//           the earlier start to the later end with all of both.

import { receiptDate } from '../receipts/view.js';
import { saveTrip } from './records.js';

/** @typedef {Record<string, any>} Rec */

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const LEGS = new Set(['train', 'bus', 'flight']);
/** Trips at most this far apart may be joined. */
export const JOIN_DAYS = 7;

/** @param {string} a @param {string} b minutes from a to b */
const minutes = (a, b) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000;

/**
 * The closed statement a trip is printed on, if any: its number.
 *
 * @param {Rec[]} travel
 * @param {string} tripId
 * @returns {string | null}
 */
export function lockedBy(travel, tripId) {
	const s = travel.find(
		(r) =>
			r.kind === 'statement' &&
			r.state === 'closed' &&
			!r.deleted &&
			(r.snapshot?.trips ?? []).some((/** @type {any} */ x) => String(x.tripId) === tripId)
	);
	return s ? String(s.number ?? '') : null;
}

/**
 * When a receipt happened on a trip: a ticket's departure, a hotel's
 * check-in, else its day at noon; null when nothing says.
 *
 * @param {Rec} r
 */
export function momentOf(r) {
	const t = r.extraction?.travel;
	if (TIME.test(t?.departure ?? '')) return t.departure;
	if (DAY.test(t?.check_in ?? '')) return `${t.check_in}T12:00`;
	const day = receiptDate(/** @type {any} */ (r));
	return day ? `${day}T12:00` : null;
}

/**
 * Where a trip would split: a leg arriving in the trip's home country and
 * the next leg leaving from it a day or more later. The first such stretch.
 *
 * @param {Rec} trip
 * @param {Rec[]} receipts the trip's
 * @returns {{ end: string, start: string } | null}
 */
export function suggestSplit(trip, receipts) {
	const home = COUNTRY.test(trip?.country ?? '') ? trip.country : 'DE';
	/** @type {{ dep: string, arr: string, from: string | null, to: string | null }[]} */
	const legs = [];
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (!t || !LEGS.has(t.kind)) continue;
		if (TIME.test(t.departure ?? '') && TIME.test(t.arrival ?? ''))
			legs.push({ dep: t.departure, arr: t.arrival, from: t.from_country, to: t.to_country });
		if (TIME.test(t.return_departure ?? '') && TIME.test(t.return_arrival ?? ''))
			legs.push({
				dep: t.return_departure,
				arr: t.return_arrival,
				from: t.to_country,
				to: t.from_country
			});
	}
	legs.sort((a, b) => a.dep.localeCompare(b.dep));
	for (let i = 1; i < legs.length; i++) {
		const back = legs[i - 1];
		const out = legs[i];
		if (back.to === home && out.from === home && minutes(back.arr, out.dep) >= 24 * 60)
			return { end: back.arr, start: out.dep };
	}
	return null;
}

/**
 * The country a trip is in at a moment: the last crossing before it.
 *
 * @param {Rec} trip
 * @param {string} at
 */
function countryAt(trip, at) {
	let c = COUNTRY.test(trip?.country ?? '') ? trip.country : 'DE';
	for (const s of [...(trip.stops ?? [])].sort((a, b) => String(a.at).localeCompare(b.at)))
		if (s.at < at) c = s.country;
	return c;
}

/**
 * A trip split in two: the first ends at `end`, the second starts at
 * `start`. The second has no id yet.
 *
 * @param {Rec} trip
 * @param {Rec[]} receipts the trip's
 * @param {{ end: string, start: string }} at
 * @returns {{ first: Rec, second: Rec, toSecond: string[] }} the ids of the receipts that move
 */
export function splitTrip(trip, receipts, { end, start }) {
	if (!TIME.test(end) || !TIME.test(start) || start < end)
		throw new Error('A split needs an end and a start not before it');
	if (TIME.test(trip.start ?? '') && end <= trip.start)
		throw new Error('The first trip would end before it starts');
	if (TIME.test(trip.end ?? '') && start >= trip.end)
		throw new Error('The second trip would start after it ends');
	const day = start.slice(0, 10);
	/** @param {Record<string, any>} o @param {boolean} second */
	const byDay = (o, second) =>
		Object.fromEntries(Object.entries(o ?? {}).filter(([d]) => d >= day === second));
	const stops = trip.stops ?? [];
	const mileage = trip.mileage ?? [];
	const nights = trip.nights ?? [];
	const first = {
		...trip,
		end,
		stops: stops.filter((/** @type {any} */ s) => s.at < start),
		meals: byDay(trip.meals, false),
		nights: nights.filter((/** @type {string} */ d) => d < day),
		mileage: mileage.filter((/** @type {any} */ l) => !l.date || l.date < day)
	};
	// A new record: none of the first one's id or stamps.
	const rest = { ...trip };
	for (const key of ['id', 'created', 'updated', 'createdAt', 'updatedAt']) delete rest[key];
	const second = {
		...rest,
		kind: 'trip',
		start,
		end: trip.end ?? '',
		country: countryAt(trip, start),
		stops: stops.filter((/** @type {any} */ s) => s.at >= start),
		meals: byDay(trip.meals, true),
		nights: nights.filter((/** @type {string} */ d) => d >= day),
		mileage: mileage.filter((/** @type {any} */ l) => l.date && l.date >= day)
	};
	const toSecond = receipts
		.filter((r) => {
			const m = momentOf(r);
			return m !== null && m >= start;
		})
		.map((r) => String(r.id));
	return { first, second, toSecond };
}

/**
 * The trips that could be joined with one: the same traveller's, at most
 * JOIN_DAYS apart, neither on a closed statement; nearest first.
 *
 * @param {Rec[]} travel
 * @param {Rec} trip
 */
export function joinCandidates(travel, trip) {
	if (!TIME.test(trip?.start ?? '') || lockedBy(travel, String(trip.id))) return [];
	const end = TIME.test(trip.end ?? '') ? trip.end : trip.start;
	/** @param {Rec} o */
	const apart = (o) => {
		const oEnd = TIME.test(o.end ?? '') ? o.end : o.start;
		if (o.start >= end) return minutes(end, o.start);
		if (oEnd <= trip.start) return minutes(oEnd, trip.start);
		return 0;
	};
	return travel
		.filter(
			(o) =>
				o.kind === 'trip' &&
				!o.deleted &&
				o.id !== trip.id &&
				(o.travellerId ?? '') === (trip.travellerId ?? '') &&
				TIME.test(o.start ?? '') &&
				apart(o) <= JOIN_DAYS * 24 * 60 &&
				!lockedBy(travel, String(o.id))
		)
		.sort((a, b) => apart(a) - apart(b));
}

/**
 * Two trips as one: kept under `trip`'s id, from the earlier start to the
 * later end, with the crossings, meals, nights and mileage of both. Text
 * fields keep `trip`'s, else the other's.
 *
 * @param {Rec} trip
 * @param {Rec} other
 */
export function joinTrips(trip, other) {
	const early = String(other.start) < String(trip.start) ? other : trip;
	const ends = [trip.end, other.end].filter((x) => TIME.test(x ?? '')).sort();
	/** @param {string} key */
	const textOf = (key) => String(trip[key] ?? '').trim() || String(other[key] ?? '').trim();
	const stops = [...(trip.stops ?? []), ...(other.stops ?? [])]
		.filter((s, i, all) => all.findIndex((x) => x.at === s.at && x.country === s.country) === i)
		.sort((a, b) => String(a.at).localeCompare(b.at));
	/** @type {Record<string, any>} */
	const meals = { ...(other.meals ?? {}) };
	for (const [d, m] of Object.entries(trip.meals ?? {})) {
		const o = meals[d] ?? {};
		meals[d] = {
			breakfast: m.breakfast === true || o.breakfast === true,
			lunch: m.lunch === true || o.lunch === true,
			dinner: m.dinner === true || o.dinner === true
		};
	}
	const notes = [trip.note, other.note].map((n) => String(n ?? '').trim()).filter(Boolean);
	return {
		...trip,
		destination: textOf('destination'),
		reason: textOf('reason'),
		place: textOf('place'),
		note: [...new Set(notes)].join('\n'),
		start: early.start,
		end: ends.at(-1) ?? '',
		country: early.country ?? 'DE',
		stops,
		overnight:
			trip.overnight === true || other.overnight === true ? true : (trip.overnight ?? null),
		meals,
		nights: [...new Set([...(trip.nights ?? []), ...(other.nights ?? [])])].sort(),
		mileage: [...(trip.mileage ?? []), ...(other.mileage ?? [])],
		...(trip.checked || other.checked
			? { checked: [...new Set([...(trip.checked ?? []), ...(other.checked ?? [])])] }
			: {})
	};
}

/** @typedef {import('../store/repository.js').Collection} Collection */

/**
 * Split a stored trip on the books: the first keeps its id, the second is
 * new, the receipts from `start` on move to it. Refused for a trip on a
 * closed statement.
 *
 * @param {{ travel: Collection, receipts: Collection }} store
 * @param {string} tripId
 * @param {{ end: string, start: string }} at
 * @returns {Promise<{ first: Rec, second: Rec }>}
 */
export async function splitStoredTrip(store, tripId, at) {
	const trip = await store.travel.get(tripId);
	if (!trip || trip.deleted || trip.kind !== 'trip') throw new Error(`No trip with id ${tripId}`);
	const locked = lockedBy(await store.travel.list(), tripId);
	if (locked) throw new Error(`On the closed statement ${locked}`);
	const receipts = await store.receipts.list({
		where: (r) => !r.deleted && r.travel?.tripId === tripId
	});
	const { first, second, toSecond } = splitTrip(trip, receipts, at);
	const { trip: kept } = await saveTrip(store, first);
	const { trip: made } = await saveTrip(store, second);
	const moving = new Set(toSecond);
	for (const r of receipts)
		if (moving.has(String(r.id)))
			await store.receipts.put({ ...r, travel: { ...r.travel, tripId: made.id } });
	return { first: kept, second: made };
}

/**
 * Join two stored trips on the books: `tripId` keeps all, its receipts and
 * the other's; the other is deleted. Refused for a trip on a closed statement
 * or two travellers' trips.
 *
 * @param {{ travel: Collection, receipts: Collection }} store
 * @param {string} tripId
 * @param {string} otherId
 */
export async function joinStoredTrips(store, tripId, otherId) {
	const trip = await store.travel.get(tripId);
	const other = await store.travel.get(otherId);
	for (const t of [trip, other])
		if (!t || t.deleted || t.kind !== 'trip') throw new Error('No such trip');
	if (tripId === otherId) throw new Error('A trip is joined with another');
	if ((trip?.travellerId ?? '') !== (other?.travellerId ?? ''))
		throw new Error('Trips of two travellers are not joined');
	const travel = await store.travel.list();
	const locked = lockedBy(travel, tripId) ?? lockedBy(travel, otherId);
	if (locked) throw new Error(`On the closed statement ${locked}`);
	const { trip: joined } = await saveTrip(
		store,
		joinTrips(/** @type {Rec} */ (trip), /** @type {Rec} */ (other))
	);
	const moving = await store.receipts.list({
		where: (r) => !r.deleted && r.travel?.tripId === otherId
	});
	for (const r of moving) await store.receipts.put({ ...r, travel: { ...r.travel, tripId } });
	await store.travel.softDelete(otherId);
	return joined;
}

// A trip's countries from its receipts (#693), by rule, not by AI: the
// reading names the country of each station, airport and town
// (extraction.travel *_country); here the legs become border crossings
// (`stops`, as allowance.js counts them), and receipts that put the traveller
// in a country no leg leads to become hints. Pure.
//
// Legs: a ticket for a train, bus, flight, local transport or taxi with its
// arrival time. Arriving in another country than the one the traveller is
// in is a crossing at that time: a flight's landing (the BMF counts a country
// as reached on landing); for a train or bus the crossing lies before the
// arrival, so the arrival is the latest it can be, and the person can move it.
// A return ticket's way back is a leg too.
//
// Hints: a border crossed by car, on foot or with a ticket that was not read
// leaves no leg. A receipt from another country on a day the trip was not
// there (fuel, parking, a hotel's nights, a restaurant, a rental car, a taxi
// without times) says the traveller was there, not when they crossed: a hint
// with a question, never a crossing with a time made up.

import { receiptDate } from '../receipts/view.js';
import { abroadCities } from './rates-abroad.js';

/** @typedef {Record<string, any>} Rec */

/** The kinds that carry the traveller from one place to another. */
export const LEG_KINDS = new Set(['train', 'bus', 'flight', 'public_transport', 'taxi']);

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** @param {unknown} v */
const countryOf = (v) => (typeof v === 'string' && COUNTRY.test(v) ? v : null);

/** A place to compare: no case, no accents, no "Hbf". @param {unknown} s */
export const placeKey = (s) =>
	String(s ?? '')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\b(hbf|hauptbahnhof|central|centrale|station|airport|flughafen)\b/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/**
 * @typedef {object} Leg
 * @property {string} receiptId
 * @property {string} at arrival, local time `YYYY-MM-DDTHH:MM`
 * @property {string} country where it arrives
 * @property {string} place the station, airport or town, as printed
 */

/**
 * The legs of some receipts with an arrival and its country, earliest first.
 *
 * @param {Rec[]} receipts
 * @returns {Leg[]}
 */
export function legsOf(receipts) {
	/** @type {Leg[]} */
	const out = [];
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (!t || !LEG_KINDS.has(t.kind)) continue;
		const there = countryOf(t.to_country);
		const back = countryOf(t.from_country);
		if (there && TIME.test(t.arrival ?? ''))
			out.push({ receiptId: String(r.id), at: t.arrival, country: there, place: t.to ?? '' });
		if (back && TIME.test(t.return_arrival ?? ''))
			out.push({
				receiptId: String(r.id),
				at: t.return_arrival,
				country: back,
				place: t.from ?? ''
			});
	}
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The city with rates of its own a place is, as the BMF letter names it
 * (rates-abroad.js); null for any other place.
 *
 * @param {string} country
 * @param {string} place
 * @param {string} day
 */
function cityOf(country, place, day) {
	if (country === 'DE' || !place) return null;
	const key = placeKey(place);
	return abroadCities(country, day).find((c) => placeKey(c) === key) ?? null;
}

/**
 * @typedef {object} Stop
 * @property {string} at
 * @property {string} country
 * @property {string} [city]
 * @property {string} receiptId the ticket it comes from
 */

/**
 * The border crossings the legs make, from a start country.
 *
 * @param {Leg[]} legs earliest first
 * @param {string} home where the trip starts
 * @returns {Stop[]}
 */
export function stopsOf(legs, home) {
	/** @type {Stop[]} */
	const out = [];
	let here = home;
	for (const leg of legs) {
		if (leg.country === here) continue;
		const city = cityOf(leg.country, leg.place, leg.at.slice(0, 10));
		out.push({
			at: leg.at,
			country: leg.country,
			...(city ? { city } : {}),
			receiptId: leg.receiptId
		});
		here = leg.country;
	}
	return out;
}

/**
 * Where a trip starts: the country the first leg leaves from, else Germany.
 *
 * @param {Rec[]} receipts
 */
export function homeOf(receipts) {
	const first = receipts
		.map((r) => r.extraction?.travel)
		.filter((t) => t && LEG_KINDS.has(t.kind) && countryOf(t.from_country))
		.map((t) => ({
			at: TIME.test(t.departure ?? '') ? t.departure : '9999',
			country: t.from_country
		}))
		.sort((a, b) => a.at.localeCompare(b.at))[0];
	return first?.country ?? 'DE';
}

/** The country at a moment: the last crossing at or before it. @param {string} home @param {{ at: string, country: string }[]} stops @param {string} at */
const countryAt = (home, stops, at) => {
	let c = home;
	for (const s of stops) if (s.at <= at) c = s.country;
	return c;
};

/** The countries of a day: the one at its start, and each crossed into on it. @param {string} home @param {{ at: string, country: string }[]} stops @param {string} day */
const countriesOn = (home, stops, day) =>
	new Set([
		countryAt(home, stops, `${day}T00:00`),
		...stops.filter((s) => s.at.slice(0, 10) === day).map((s) => s.country)
	]);

/** The dates of a hotel's nights: check-in up to the day before check-out. @param {string} from @param {string} to */
function nightsBetween(from, to) {
	const out = [];
	for (let d = new Date(`${from}T00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
		const day = d.toISOString().slice(0, 10);
		if (day >= to || out.length > 366) break;
		out.push(day);
	}
	return out;
}

/**
 * @typedef {object} CountryHint
 * @property {string} receiptId
 * @property {string} country where the receipt was issued
 * @property {string} date the day (a hotel: the first night) the trip was elsewhere
 */

/**
 * The receipts that put the traveller in a country the crossings do not lead
 * to on their day: a crossing without a ticket (by car, on foot), or one whose
 * ticket was not read.
 *
 * @param {Rec[]} receipts
 * @param {string} home
 * @param {{ at: string, country: string }[]} stops earliest first
 * @returns {CountryHint[]}
 */
export function countryHints(receipts, home, stops) {
	const sorted = [...stops].sort((a, b) => a.at.localeCompare(b.at));
	/** @type {CountryHint[]} */
	const out = [];
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (!t?.kind) continue;
		const receiptId = String(r.id);
		if (t.kind === 'hotel') {
			const country = countryOf(t.place_country);
			if (!country || !DAY.test(t.check_in ?? '') || !DAY.test(t.check_out ?? '')) continue;
			// A night counts where the traveller is at its midnight.
			const off = nightsBetween(t.check_in, t.check_out).find(
				(day) => countryAt(home, sorted, `${day}T23:59`) !== country
			);
			if (off) out.push({ receiptId, country, date: off });
			continue;
		}
		// A leg with its arrival is a crossing already; one without is evidence.
		if (LEG_KINDS.has(t.kind) && countryOf(t.to_country) && TIME.test(t.arrival ?? '')) continue;
		const country = countryOf(t.place_country) ?? countryOf(t.to_country);
		const day = TIME.test(t.departure ?? '')
			? t.departure.slice(0, 10)
			: receiptDate(/** @type {any} */ (r));
		if (!country || !day || !DAY.test(day)) continue;
		if (!countriesOn(home, sorted, day).has(country)) out.push({ receiptId, country, date: day });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A trip's route from its receipts: where it starts, its crossings, and the
 * hints the crossings leave open.
 *
 * @param {Rec[]} receipts
 * @param {string} [home] where it starts; by default from the first leg
 */
export function routeOf(receipts, home = homeOf(receipts)) {
	const stops = stopsOf(legsOf(receipts), home);
	return { country: home, stops, hints: countryHints(receipts, home, stops) };
}

/**
 * The crossings the receipts give that a trip does not have yet: the same
 * country within an hour counts as the same crossing.
 *
 * @param {Stop[]} suggested
 * @param {{ at: string, country: string }[]} kept
 */
export function newStops(suggested, kept) {
	const minutes = (/** @type {string} */ t) => Date.parse(`${t}:00Z`) / 60000;
	return suggested.filter(
		(s) =>
			!kept.some(
				(k) =>
					String(k.country).toUpperCase() === s.country &&
					TIME.test(k.at ?? '') &&
					Math.abs(minutes(k.at) - minutes(s.at)) <= 60
			)
	);
}

/**
 * A route as a line: `DE → CZ 05.11. 14:10 → KZ 06.11. 07:05`.
 *
 * @param {string} home
 * @param {{ at: string, country: string, city?: string }[]} stops
 * @param {(at: string) => string} when how a time is written
 */
export const routeLine = (home, stops, when) =>
	[home, ...stops.map((s) => `${s.country}${s.city ? ` ${s.city}` : ''} ${when(s.at)}`)].join(
		' → '
	);

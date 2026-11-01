// The meal allowance of a trip (Verpflegungsmehraufwand, issue #213, step 1),
// from its times, the countries it reached and the meals provided. Pure; all
// amounts in cents. Times are local wall-clock times, `YYYY-MM-DDTHH:MM`.
//
// Per calendar day:
//   one day, no night away     more than 8 hours: the partial rate
//   across midnight, no night  the hours of both days add up; more than 8
//                              count for the day with the most of them
//   with a night away          the days of departure and arrival the partial
//                              rate, each day between the full one
// The country of a day is the one reached last before midnight; if that is
// Germany, the last one abroad reached that day (the day home). A border
// crossing may name a city with rates of its own (rates-abroad.js): the day
// then takes the city's. A day before the first letter in the table has no
// rate abroad, and is left without an amount, named.
//
// A meal provided cuts the day by a share of the country's full-day rate,
// down to nothing at most. The three-month rule cuts a day to nothing: which
// days, `threeMonthCuts` says from the days at each place.

import { MEAL_CUTS, THREE_MONTH_RULE, mealRate, rateOn } from './rates.js';

/**
 * @typedef {{ breakfast?: boolean, lunch?: boolean, dinner?: boolean }} Meals
 * @typedef {object} AllowanceDay
 * @property {string} date YYYY-MM-DD
 * @property {'full' | 'partial' | 'none'} kind
 * @property {number} minutes away on that day (for a trip across midnight without a night: both days')
 * @property {string} country
 * @property {string | null} [city] the city of the day's place, where the crossing names one
 * @property {number | null} cents null: no rate for the country
 * @property {number} cutCents what the meals provided took off
 * @property {'under8h' | 'countedOnOtherDay' | 'noRate' | 'threeMonthRule' | null} reason
 * @property {{ from: string, full: number, partial: number, source: string, country?: string, city?: string | null, via?: string | null } | null} rate
 *   the rate used; abroad, whose row it is (rates-abroad.js `abroadRate`)
 */

/** Minutes since 1970 of a wall-clock time, as if it were UTC. @param {string} t */
const minutesOf = (t) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(t);
	if (!m) throw new Error(`not a time: ${t}`);
	return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
};
/** @param {number} minutes */
const dateOf = (minutes) => new Date(minutes * 60000).toISOString().slice(0, 10);
/** @param {string} date */
const midnightOf = (date) => minutesOf(`${date}T00:00`);

/** The dates from one to another, both included. @param {string} from @param {string} to */
function datesBetween(from, to) {
	const out = [];
	for (let m = midnightOf(from); m <= midnightOf(to); m += 24 * 60) out.push(dateOf(m));
	return out;
}

/**
 * @param {object} trip
 * @param {string} trip.start leaving home or the office
 * @param {string} trip.end back
 * @param {string} [trip.country] where it starts, Germany by default
 * @param {{ at: string, country: string, city?: string | null }[]} [trip.stops] each time a border is crossed: from then on, that country (and city)
 * @param {boolean} [trip.overnight] whether there was a night away; by default when it spans dates
 * @param {Record<string, Meals>} [trip.meals] meals provided, by date
 * @param {Iterable<string>} [trip.cut] dates cut by the three-month rule
 * @returns {{ days: AllowanceDay[], cents: number, missing: string[] }}
 *   missing: the dates without a rate
 */
export function mealAllowance({
	start,
	end,
	country = 'DE',
	stops = [],
	overnight,
	meals = {},
	cut = []
}) {
	const from = minutesOf(start);
	const to = minutesOf(end);
	if (to <= from) throw new Error('a trip ends after it starts');
	const borders = stops
		.map((s) => ({ at: minutesOf(s.at), country: s.country, city: s.city ?? null }))
		.sort((a, b) => a.at - b.at);
	const dates = datesBetween(dateOf(from), dateOf(to));
	const night = overnight ?? dates.length > 1;
	if (!night && dates.length > 2) throw new Error('more than one midnight needs a night away');
	const cutDates = new Set(cut);

	/** The country, and city, at a moment. @param {number} at */
	const placeAt = (at) => {
		/** @type {{ country: string, city: string | null }} */
		let c = { country, city: null };
		for (const b of borders) if (b.at <= at) c = b;
		return c;
	};

	const spans = dates.map((date) => {
		const dayStart = Math.max(from, midnightOf(date));
		const dayEnd = Math.min(to, midnightOf(date) + 24 * 60);
		let last = placeAt(dayEnd - 1 / 60);
		if (last.country === 'DE') {
			// Back home that day: the rate of the last country abroad reached on it.
			const abroad = [
				placeAt(dayStart),
				...borders.filter((b) => b.at > dayStart && b.at < dayEnd)
			].filter((c) => c.country !== 'DE');
			if (abroad.length) last = abroad[abroad.length - 1];
		}
		return { date, minutes: dayEnd - dayStart, country: last.country, city: last.city ?? null };
	});

	/** @type {{ date: string, minutes: number, country: string, city: string | null, kind: 'full' | 'partial' | 'none', reason: AllowanceDay['reason'] }[]} */
	let kinds;
	if (!night) {
		const total = spans.reduce((s, d) => s + d.minutes, 0);
		// Across midnight the day with most of the hours takes them all; on a tie, the first.
		const main = spans.reduce((a, b) => (b.minutes > a.minutes ? b : a));
		kinds = spans.map((d) => ({
			...d,
			minutes: d === main ? total : d.minutes,
			kind: d === main && total > 8 * 60 ? 'partial' : 'none',
			reason: d !== main ? 'countedOnOtherDay' : total > 8 * 60 ? null : 'under8h'
		}));
	} else {
		kinds = spans.map((d, i) => ({
			...d,
			kind: i === 0 || i === spans.length - 1 ? 'partial' : 'full',
			reason: null
		}));
	}

	/** @type {AllowanceDay[]} */
	const days = kinds.map((d) => {
		const base = {
			date: d.date,
			kind: d.kind,
			minutes: d.minutes,
			country: d.country,
			...(d.city ? { city: d.city } : {}),
			cutCents: 0
		};
		if (d.kind === 'none') return { ...base, cents: 0, reason: d.reason, rate: null };
		const rate = mealRate(d.country, d.date, d.city);
		if (!rate) return { ...base, cents: null, reason: 'noRate', rate: null };
		const used = {
			from: rate.from,
			full: rate.full,
			partial: rate.partial,
			source: rate.source,
			...('via' in rate ? { country: rate.country, city: rate.city, via: rate.via } : {})
		};
		if (cutDates.has(d.date)) return { ...base, cents: 0, reason: 'threeMonthRule', rate: used };
		const amount = d.kind === 'full' ? rate.full : rate.partial;
		const shares = rateOn(MEAL_CUTS, d.date);
		const m = meals[d.date] ?? {};
		const off = shares
			? Math.round(
					rate.full *
						((m.breakfast ? shares.breakfast : 0) +
							(m.lunch ? shares.lunch : 0) +
							(m.dinner ? shares.dinner : 0))
				)
			: 0;
		const cutCents = Math.min(off, amount);
		return { ...base, cents: amount - cutCents, cutCents, reason: null, rate: used };
	});
	return {
		days,
		cents: days.reduce((s, d) => s + (d.cents ?? 0), 0),
		missing: days.filter((d) => d.cents === null).map((d) => d.date)
	};
}

/**
 * The dates the three-month rule cuts: at the same place of activity, the
 * days from three months after the first one on, until an interruption of
 * four weeks starts the count again.
 *
 * Whether the place is a longer-term one at all (by the tax office's reading:
 * activity there on three days a week or more) is not checked here: the cut
 * days are named with their reason, for the adviser to confirm.
 *
 * @param {{ place: string, date: string }[]} visits the days at a place of activity
 * @returns {Map<string, Set<string>>} place → dates cut
 */
export function threeMonthCuts(visits) {
	/** @type {Map<string, string[]>} */
	const byPlace = new Map();
	for (const v of visits) {
		const list = byPlace.get(v.place) ?? [];
		list.push(v.date);
		byPlace.set(v.place, list);
	}
	/** @type {Map<string, Set<string>>} */
	const out = new Map();
	for (const [place, list] of byPlace) {
		const dates = [...new Set(list)].sort();
		const cutDates = new Set();
		/** @type {string | null} */
		let first = null;
		/** @type {string | null} */
		let previous = null;
		for (const date of dates) {
			const rule = rateOn(THREE_MONTH_RULE, date);
			if (!rule) continue;
			const away = previous ? (midnightOf(date) - midnightOf(previous)) / (24 * 60) - 1 : 0;
			if (!first || away >= rule.restartAfterDays) first = date;
			if (date >= addMonths(first, rule.months)) cutDates.add(date);
			previous = date;
		}
		if (cutDates.size) out.set(place, cutDates);
	}
	return out;
}

/** The same day some months later; past a month's end, its last day. @param {string} date @param {number} months */
function addMonths(date, months) {
	const [y, m, d] = date.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const last = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(d, last));
	return target.toISOString().slice(0, 10);
}

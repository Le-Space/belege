// Overnight flat rates without a hotel invoice (issue #380, step 2): an
// employer may pay an employee a flat rate for a night instead of the hotel
// bill – 20 € in Germany (R 9.7 Abs. 3 LStR), abroad the BMF letter's rate
// (rates-abroad.js). For employees only: the owner's nights count with their
// invoice, never a flat rate (decided 14.10.). Nothing is ticked by itself:
// each night without an invoice is ticked on the trip.
//
// A night belongs to the date it starts on, and counts where the traveller
// is at midnight: the place reached last before it (a crossing may name a
// city with its own rates). Pure; amounts in cents.

import { lodgingRate } from './rates.js';

/**
 * @typedef {object} LodgingNight
 * @property {string} date YYYY-MM-DD, the evening the night starts
 * @property {string} country
 * @property {string | null} city
 * @property {number | null} cents null: no rate for that night
 * @property {{ from: string, cents: number, source: string, country?: string, city?: string | null, via?: string | null } | null} rate
 */

/** The dates a trip has nights after: from its first day to the day before its last. @param {string} start @param {string} end */
export function nightsOf(start, end) {
	const out = [];
	const last = end.slice(0, 10);
	for (let d = new Date(`${start.slice(0, 10)}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
		const date = d.toISOString().slice(0, 10);
		if (date >= last) break;
		out.push(date);
	}
	return out;
}

/**
 * @param {object} trip
 * @param {string} trip.start
 * @param {string} trip.end
 * @param {string} [trip.country] where it starts, Germany by default
 * @param {{ at: string, country: string, city?: string | null }[]} [trip.stops]
 * @param {Iterable<string>} [trip.nights] the dates whose night had no invoice
 * @returns {{ nights: LodgingNight[], cents: number, missing: string[] }}
 */
export function lodgingFlat({ start, end, country = 'DE', stops = [], nights = [] }) {
	const ticked = new Set(nights);
	const sorted = [...stops].sort((a, b) => a.at.localeCompare(b.at));
	/** The place at the end of a date. @param {string} date */
	const placeAt = (date) => {
		/** @type {{ country: string, city?: string | null }} */
		let p = { country, city: null };
		for (const s of sorted) if (s.at <= `${date}T23:59`) p = s;
		return { country: p.country, city: p.city ?? null };
	};
	/** @type {LodgingNight[]} */
	const out = nightsOf(start, end)
		.filter((date) => ticked.has(date))
		.map((date) => {
			const place = placeAt(date);
			const rate = lodgingRate(place.country, date, place.city);
			return { date, ...place, cents: rate ? rate.cents : null, rate };
		});
	return {
		nights: out,
		cents: out.reduce((s, n) => s + (n.cents ?? 0), 0),
		missing: out.filter((n) => n.cents === null).map((n) => n.date)
	};
}

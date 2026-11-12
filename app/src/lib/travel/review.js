// "✦ Reise prüfen" (#693 d): what goes to the model about one trip, and its
// notes back. Pure.
//
// The trip's head (times, destination, home country, crossings, the nights
// ticked as a flat rate), its legs (checks.js segmentsOf), its receipts as read
// fields – kind, vendor, day, place, check-in and -out, from and to; no
// amounts, numbers, addresses or texts – and the questions checks.js already
// asks, as plain lines. Receipts are named R1 …, legs L1 …; a note's names
// lead back to the receipts. Unredacted, so only offered with a model on the
// bridge's computer or in the attested enclave (`app.llmRedaction`).

import { segmentsOf } from './checks.js';

export const MAX_LEGS = 60;
export const MAX_RECEIPTS = 60;
export const MAX_QUESTIONS = 20;

/** @typedef {Record<string, any>} Rec */
/**
 * @typedef {{ lang: 'de' | 'en', trip: Rec, legs: Rec[], receipts: Rec[], questions: string[] }} TripReview
 * @typedef {{ text: string, refs: string[] }} ReviewNote
 */

/** A string of at most `max` characters, or null. @param {unknown} v @param {number} [max] */
const s = (v, max = 200) => {
	const x = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
	return x ? x.slice(0, max) : null;
};

/** Whether the model may be asked: on the bridge's computer or in the enclave, unredacted. @param {unknown} redaction app.llmRedaction */
export const reviewOffered = (redaction) => redaction === false || redaction === 'enclave';

/** @param {{ name: string, country: string | null, iata: string | null }} p */
const placeLine = (p) =>
	[p.name, p.iata ? `(${p.iata})` : '', p.country ? p.country : ''].filter(Boolean).join(' ') ||
	null;

/**
 * The request for one trip, and which receipt each name stands for.
 *
 * @param {Rec} trip
 * @param {Rec[]} receipts the trip's
 * @param {import('./checks.js').TripCheck[]} checks the open questions
 * @param {'de' | 'en'} lang
 * @returns {{ body: TripReview, receiptOf: Map<string, string> }}
 */
export function reviewRequest(trip, receipts, checks, lang) {
	const day = (/** @type {Rec} */ r) => {
		const d =
			r.documentDate ??
			r.extraction?.travel?.departure ??
			r.extraction?.travel?.check_in ??
			r.receivedAt;
		return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
	};
	const sorted = [...receipts]
		.filter((r) => !r.deleted)
		.sort((a, b) => String(day(a) ?? '').localeCompare(String(day(b) ?? '')))
		.slice(0, MAX_RECEIPTS);
	/** @type {Map<string, string>} receipt id → R… */
	const refOf = new Map(sorted.map((r, i) => [String(r.id), `R${i + 1}`]));
	/** @type {Map<string, string>} R… or L… → receipt id */
	const receiptOf = new Map(sorted.map((r, i) => [`R${i + 1}`, String(r.id)]));

	const out = sorted.map((r) => {
		const t = r.extraction?.travel ?? {};
		/** @type {Rec} */
		const o = {
			ref: refOf.get(String(r.id)),
			kind: s(t.kind ?? r.extraction?.document_type, 60),
			vendor: s(r.vendor ?? r.extraction?.vendor),
			date: day(r),
			place: s(t.place),
			country: s(t.place_country, 2),
			checkIn: s(t.check_in, 10),
			checkOut: s(t.check_out, 10),
			from: s(t.from),
			to: s(t.to)
		};
		for (const k of Object.keys(o)) if (o[k] === null) delete o[k];
		return o;
	});

	const segments = segmentsOf(sorted).slice(0, MAX_LEGS);
	/** @type {Map<string, string>} a leg's receipt and departure → L… */
	const legOf = new Map();
	const legs = segments.map((g, i) => {
		const ref = `L${i + 1}`;
		legOf.set(`${g.receiptId}@${g.dep}`, ref);
		receiptOf.set(ref, g.receiptId);
		const kind = sorted.find((r) => String(r.id) === g.receiptId)?.extraction?.travel?.kind;
		return {
			ref,
			receipt: /** @type {string} */ (refOf.get(g.receiptId)),
			kind: s(kind, 60) ?? 'ride',
			from: s(placeLine(g.from)),
			to: s(placeLine(g.to)),
			dep: g.dep,
			arr: g.arr
		};
	});
	/** @param {import('./checks.js').Segment} g */
	const legName = (g) => legOf.get(`${g.receiptId}@${g.dep}`) ?? '?';

	const questions = checks.slice(0, MAX_QUESTIONS).map((c) => {
		switch (c.kind) {
			case 'night':
				return `night ${c.date}: no accommodation receipt, no flat rate, no leg overnight`;
			case 'gap':
				return `gap: ${legName(c.after)} arrives in ${placeLine(c.after.to) ?? '?'}, ${legName(c.before)} leaves from ${placeLine(c.before.from) ?? '?'}`;
			case 'endsAbroad':
				return `ends abroad: the last leg arrives in ${c.place || '?'} (${c.country}) at ${c.at}, no way back`;
			case 'outside':
				return `outside: a leg of ${refOf.get(c.receiptId) ?? '?'} at ${c.at} is ${c.side} the trip`;
		}
		return '';
	});

	const stops = (Array.isArray(trip.stops) ? trip.stops : [])
		.slice(0, 40)
		.map((/** @type {Rec} */ x) => ({
			at: s(x.at, 20),
			country: s(x.country, 2),
			city: s(x.city)
		}));
	return {
		body: {
			lang,
			trip: {
				start: s(trip.start, 20),
				end: s(trip.end, 20),
				destination: s(trip.destination),
				country: s(trip.country, 2),
				overnight: typeof trip.overnight === 'boolean' ? trip.overnight : null,
				stops,
				flatNights: (Array.isArray(trip.nights) ? trip.nights : [])
					.filter(
						(/** @type {unknown} */ d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
					)
					.slice(0, 92)
			},
			legs,
			receipts: out,
			questions: questions.filter(Boolean).map((q) => q.slice(0, 300))
		},
		receiptOf
	};
}

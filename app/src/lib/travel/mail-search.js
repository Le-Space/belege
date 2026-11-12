// "Im Postfach suchen" on a gap of a trip (#693, part c): a night without
// lodging or a ride missing between two legs becomes one search in the
// mailbox through the bridge (`/mail/search`, as "Beleg finden" does for a
// payment), and its hits are ranked here. Pure: what is searched is built
// and named before the click; only the hits are read, and nothing is taken
// over or assigned without a second click.
//
// A booking comes weeks before the night and the invoice after it, so the
// search runs ± 30 days around the gap. The place's name and the words of
// the kind (words.js MAIL_WORDS) are each a criterion of their own – the
// bridge finds a mail that has any of them – and the ranking puts first what
// has the place and a word, an attachment, and is no newsletter.

import { MAIL_WORDS } from './words.js';

/** The days around a gap the mailbox is searched: a booking comes weeks before. */
export const SEARCH_DAYS = 30;

/** The bridge's term: 3–100 of letters, digits and .,:_- (bridge/src/commands.js). */
const TERM = /^[\w.,:-]{3,100}$/;
/** The bridge's text: 3–100 plain characters. */
const TEXT = /^[^"\\\r\n]{3,100}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A place's name as the bridge takes it as text, or null. @param {unknown} name */
const placeText = (name) => {
	const s = String(name ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return TEXT.test(s) ? s : null;
};

/**
 * @typedef {object} GapQuery
 * @property {'lodging' | 'ride'} looking what is missing
 * @property {string | null} text the place, as the bridge's search text
 * @property {string[]} terms the kind's words (and a second place, where it is one plain word)
 * @property {string} around YYYY-MM-DD
 * @property {number} days ± around
 */

/**
 * The search for one question of checks.js, or null for a question that no
 * mail answers (the end abroad, a leg outside the trip).
 *
 * A night: the place the last leg before its evening arrived at, else the
 * trip's destination; a booking or an invoice of a lodging. A ride missing:
 * the place where it went missing, the place the next leg left from, and the
 * words of a ticket.
 *
 * @param {import('./checks.js').TripCheck} check
 * @param {{ destination?: string }} trip
 * @param {Record<string, any>[]} receipts the trip's
 * @returns {GapQuery | null}
 */
export function gapQuery(check, trip, receipts) {
	if (check.kind === 'night') {
		if (!DAY.test(check.date)) return null;
		const before = arrivals(receipts)
			.filter((a) => a.at.slice(0, 10) <= check.date)
			.at(-1);
		return {
			looking: 'lodging',
			text: placeText(before?.name) ?? placeText(trip.destination),
			terms: [...MAIL_WORDS.lodging],
			around: check.date,
			days: SEARCH_DAYS
		};
	}
	if (check.kind === 'gap') {
		if (!TIME.test(check.after.arr)) return null;
		const here = placeText(check.after.to.name);
		const there = placeText(check.before.from.name);
		const second = there && there !== here && TERM.test(there) ? [there] : [];
		return {
			looking: 'ride',
			text: here ?? there,
			terms: [...second, ...MAIL_WORDS.ride].slice(0, 6),
			around: check.after.arr.slice(0, 10),
			days: SEARCH_DAYS
		};
	}
	return null;
}

/** Where the trip's legs arrived, earliest first. @param {Record<string, any>[]} receipts */
function arrivals(receipts) {
	/** @type {{ at: string, name: string }[]} */
	const out = [];
	for (const r of receipts) {
		const t = r.extraction?.travel;
		if (!t) continue;
		if (TIME.test(t.arrival ?? '') && t.to) out.push({ at: t.arrival, name: String(t.to) });
		if (TIME.test(t.return_arrival ?? '') && t.from)
			out.push({ at: t.return_arrival, name: String(t.from) });
	}
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

const RECEIPT_WORDS =
	/rechnung|invoice|receipt|quittung|beleg|booking|buchung|reservation|reservierung|confirmation|bestätigung|ticket|boarding|itinerary/i;

/**
 * What a hit has of the search: the place, and which of the kind's words.
 * The bridge names each criterion that found a mail, quoted (`"hotel"`).
 *
 * @param {{ matched?: string[] }} hit
 * @param {GapQuery} query
 */
export function hitFound(hit, query) {
	const m = new Set((hit.matched ?? []).map((x) => x.replace(/^"|"$/g, '').toLowerCase()));
	const places = [query.text, ...query.terms.filter((t) => !wordsOf(query).includes(t))]
		.filter((x) => x !== null)
		.map(String);
	return {
		place: places.some((p) => m.has(p.toLowerCase())),
		words: wordsOf(query).filter((w) => m.has(w.toLowerCase()))
	};
}

/** @param {GapQuery} query */
const wordsOf = (query) => /** @type {string[]} */ ([...MAIL_WORDS[query.looking]]);

/**
 * How much a hit looks like the missing receipt: the place and a word of the
 * kind together, an attachment, a subject that names a booking or a ticket;
 * a newsletter less. No model: the mail's own fields.
 *
 * @param {Record<string, any>} hit
 * @param {GapQuery} query
 */
export function gapHitScore(hit, query) {
	const found = hitFound(hit, query);
	let score = 0;
	if (found.place) score += 4;
	score += Math.min(found.words.length, 3);
	if (found.place && found.words.length) score += 3;
	const files = (hit.attachments ?? []).filter(
		(/** @type {any} */ a) => a.kind === 'pdf' || a.kind === 'image'
	);
	if (files.length) score += 3;
	if (RECEIPT_WORDS.test(String(hit.subject ?? ''))) score += 2;
	if (hit.bulk) score -= 4;
	if (hit.auth?.verdict === 'pass') score += 1;
	return score;
}

/**
 * The hits, most likely first, then the one nearest to the gap.
 *
 * @template {Record<string, any>} H
 * @param {H[]} hits
 * @param {GapQuery} query
 * @returns {H[]}
 */
export function rankGapHits(hits, query) {
	const center = Date.parse(`${query.around}T12:00:00Z`);
	const away = (/** @type {H} */ h) => {
		const t = Date.parse(String(h.receivedAt ?? ''));
		return Number.isFinite(t) ? Math.abs(t - center) : Infinity;
	};
	return hits
		.map((h) => ({ h, s: gapHitScore(h, query), d: away(h) }))
		.sort((a, b) => b.s - a.s || a.d - b.d)
		.map((x) => x.h);
}

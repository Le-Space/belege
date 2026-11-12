// "✦ Reise prüfen" on a trip (#693 d): the model reads one trip – its times,
// border crossings and ticked nights, its legs, its receipts as read fields
// and the questions the rules already ask – and names at most six things
// that do not fit or seem missing, each with the legs (L1 …) or receipts
// (R1 …) it is about. Notes only: nothing is changed, assigned or booked.
//
// A whole trip is a movement profile, and blacking out names would not hide
// it. So this goes only to a model on this machine or in an attested enclave
// with redaction off (config.js redactionOff); the route refuses otherwise,
// and so does the assist itself.

export const MAX_LEGS = 60;
export const MAX_RECEIPTS = 60;
export const MAX_QUESTIONS = 20;
export const MAX_NOTES = 6;

const LANGUAGE = { de: 'German', en: 'English' };

/** The instructions, in the language the notes are to be in. @param {'de' | 'en'} lang */
export const travelSystem = (
	lang
) => `You help check one business trip for a company's travel expenses.
You get the trip (its times, destination, home country, border crossings and the nights ticked as a flat rate), its legs by train, bus or plane, its receipts as read fields, and the questions fixed rules already ask about it.
Answer with one JSON object and nothing else:
{
  "notes": [ { "text": string, "refs": [string] } ]   // at most ${MAX_NOTES}
}
Each note is one or two short ${LANGUAGE[lang]} sentences on what does not fit or seems missing: a night without accommodation, a ride missing between two places, times or places that contradict each other, a receipt that does not seem to belong to this trip. "refs" names the legs (L1 …) and receipts (R1 …) the note is about.
Do not repeat the rules' questions word for word; add what they miss, or say what is behind one. Do not invent receipts or rides, do not compute allowances, do not judge what is private or where the business trip ends. When everything fits, say so in one note with no refs.`;

/** @param {any} data */
export function checkTravelNotes(data) {
	if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) return ['notes missing'];
	for (const n of data.notes) {
		if (!n || typeof n !== 'object' || typeof n.text !== 'string') return ['a note is not text'];
		if (n.refs !== undefined && !Array.isArray(n.refs)) return ['refs is not a list'];
	}
	return [];
}

/**
 * @typedef {{ start: string | null, end: string | null, destination?: string | null, country?: string | null, overnight?: boolean | null, stops?: { at: string, country: string, city?: string | null }[], flatNights?: string[] }} TripHead
 * @typedef {{ ref: string, receipt: string, kind: string, from?: string | null, to?: string | null, dep: string, arr: string }} Leg
 * @typedef {{ ref: string, kind?: string | null, vendor?: string | null, date?: string | null, place?: string | null, country?: string | null, checkIn?: string | null, checkOut?: string | null, from?: string | null, to?: string | null }} ReceiptFields
 * @typedef {{ lang: 'de' | 'en', trip: TripHead, legs: Leg[], receipts: ReceiptFields[], questions: string[] }} TripReview
 */

/** `a: b` for each field that has a value. @param {Record<string, any>} o @param {string[]} keys */
const fields = (o, keys) =>
	keys
		.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
		.map((k) => `${k}: ${o[k]}`)
		.join(' | ');

/**
 * What the model sees: the trip as lines, unredacted (see the head).
 *
 * @param {TripReview} r
 */
export function travelMessage(r) {
	const t = r.trip;
	const lines = [
		`Reise: ${fields(t, ['destination', 'start', 'end', 'country'])}${t.overnight === false ? ' | ohne Übernachtung' : ''}`,
		`Grenzübertritte: ${
			(t.stops ?? []).map((s) => `${s.at} ${s.country}${s.city ? ` ${s.city}` : ''}`).join('; ') ||
			'keine'
		}`,
		`Nächte als Pauschale angehakt: ${(t.flatNights ?? []).join(', ') || 'keine'}`,
		'Fahrten:'
	];
	for (const l of r.legs.slice(0, MAX_LEGS))
		lines.push(
			`${l.ref} (${l.receipt}) ${l.kind} ${l.from ?? '?'} → ${l.to ?? '?'} | ab ${l.dep} | an ${l.arr}`
		);
	if (!r.legs.length) lines.push('keine');
	lines.push('Belege:');
	for (const b of r.receipts.slice(0, MAX_RECEIPTS))
		lines.push(
			`${b.ref} ${fields(b, ['kind', 'vendor', 'date', 'place', 'country', 'checkIn', 'checkOut', 'from', 'to'])}`
		);
	if (!r.receipts.length) lines.push('keine');
	lines.push(
		`Fragen der Regeln: ${r.questions.length ? r.questions.slice(0, MAX_QUESTIONS).join('; ') : 'keine'}`
	);
	return lines.join('\n');
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {() => boolean} deps.unredacted whether the model is on this machine or in the enclave, redaction off
 */
export function createTravelAssist({ llm, unredacted }) {
	return {
		/** @param {TripReview} review */
		async review(review) {
			if (!unredacted())
				throw Object.assign(
					new Error('Reise prüfen needs a model on this machine or in the enclave'),
					{
						status: 403,
						code: 'REDACTION_ON'
					}
				);
			const content = travelMessage(review);
			const answer = await llm.json({
				system: travelSystem(review.lang),
				content,
				check: checkTravelNotes
			});
			const known = new Set([...review.legs, ...review.receipts].map((x) => x.ref));
			const notes = answer.data.notes
				.slice(0, MAX_NOTES)
				.map((/** @type {any} */ n) => ({
					text: String(n.text).trim().slice(0, 400),
					// A name the trip did not send is dropped.
					refs: [
						...new Set(
							(Array.isArray(n.refs) ? n.refs : []).filter(
								(/** @type {unknown} */ x) => typeof x === 'string' && known.has(x)
							)
						)
					]
				}))
				.filter((/** @type {{ text: string }} */ n) => n.text);
			return {
				notes,
				llm: {
					calls: [{ model: answer.model, ms: answer.ms, usage: answer.usage }],
					sent: [content]
				}
			};
		}
	};
}

// "Verlauf": what the app did and what a person decided, one sealed record
// per event in the `events` collection. Written by the actions themselves
// (bank sync, mail fetch, extraction, matching run, decisions), so a caller
// cannot forget it.
//
// A record holds
//   kind      bank-sync | mail-fetch | file-import | sender-verdict | extract | mail-assist | matching | decision | export
//   at        ISO 8601
//   ids       receiptId, transactionId, matchId, questionId, where there is one
//   summary   counts and small facts (model, tokens, redactions by kind, …)
// and never a token, a key, a password or a receipt's text. The collection is
// sealed like every other; the page looks names up by id when it shows them.

/** @typedef {import('../store/repository.js').Collection} Collection */
/** @typedef {import('../store/repository.js').StoredRecord} StoredRecord */

/** @typedef {'bank-sync' | 'mail-fetch' | 'file-import' | 'sender-verdict' | 'extract' | 'mail-assist' | 'match-assist' | 'matching' | 'decision' | 'export'} EventKind */
/** @typedef {'auslesen' | 'abgleich' | 'abruf' | 'entscheidungen'} EventGroup */

/** @type {Record<EventKind, EventGroup>} */
export const GROUP_OF = {
	'bank-sync': 'abruf',
	'mail-fetch': 'abruf',
	'file-import': 'abruf',
	'sender-verdict': 'abruf',
	extract: 'auslesen',
	'mail-assist': 'abruf',
	'match-assist': 'abgleich',
	matching: 'abgleich',
	decision: 'entscheidungen',
	// The DATEV export is the person's act too.
	export: 'entscheidungen'
};

/** The filters on the Verlauf page, in this order. */
export const GROUPS = /** @type {const} */ (['auslesen', 'abgleich', 'abruf', 'entscheidungen']);

/** Fields a secret or a receipt's text would sit in; an event never carries them. */
const FORBIDDEN =
	/^(token|bearer|password|secret|apikey|api_key|key|authorization|text|senttext|excerpt|purpose)$/i;

/**
 * `undefined` dropped (dag-cbor has none), nested objects too; forbidden field
 * names refused, so a careless caller fails in the tests, not in the log.
 *
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
function clean(fields) {
	/** @type {Record<string, any>} */
	const out = {};
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined) continue;
		if (FORBIDDEN.test(k)) throw new Error(`An event does not carry "${k}".`);
		out[k] = v && typeof v === 'object' && !Array.isArray(v) ? clean(v) : v;
	}
	return out;
}

/**
 * Write one event. Without an `events` collection (a test store, an older
 * caller) it does nothing; a failure to write is logged, never thrown: the
 * action itself has happened.
 *
 * @param {Collection | null | undefined} events
 * @param {EventKind} kind
 * @param {Record<string, any>} [fields]
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<StoredRecord | null>}
 */
export async function recordEvent(events, kind, fields = {}, { now = () => new Date() } = {}) {
	if (!events) return null;
	if (!(kind in GROUP_OF)) throw new Error(`Unknown event kind ${kind}`);
	const record = clean({ ...fields, kind, at: now().toISOString() });
	try {
		return await events.put(record);
	} catch (error) {
		console.error('could not write an event:', error);
		return null;
	}
}

/** @param {Record<string, any>} e @returns {EventGroup | null} */
export function eventGroup(e) {
	return /** @type {Record<string, EventGroup>} */ (GROUP_OF)[String(e.kind)] ?? null;
}

/**
 * Newest first (ids are ULIDs), optionally one group only.
 *
 * @template {{ id: string, kind?: string, deleted?: boolean }} E
 * @param {E[]} events
 * @param {EventGroup | 'all'} [group]
 * @returns {E[]}
 */
export function filterEvents(events, group = 'all') {
	return events
		.filter((e) => !e.deleted && (group === 'all' || eventGroup(e) === group))
		.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * The totals the KI card shows: calls, tokens, the last extraction.
 *
 * @param {Record<string, any>[]} events
 * @returns {{ calls: number, failed: number, fallbacks: number, tokens: number, lastAt: string | null, lastModel: string | null }}
 */
export function extractionTotals(events) {
	let calls = 0;
	let failed = 0;
	let fallbacks = 0;
	let tokens = 0;
	/** @type {Record<string, any> | null} */
	let last = null;
	for (const e of events) {
		if (e.deleted || e.kind !== 'extract') continue;
		calls++;
		if (e.ok === false) failed++;
		if (e.fallback) fallbacks++;
		tokens += typeof e.tokensTotal === 'number' ? e.tokensTotal : tokenCount(e.tokens);
		if (!last || String(e.at) > String(last.at)) last = e;
	}
	return {
		calls,
		failed,
		fallbacks,
		tokens,
		lastAt: last?.at ?? null,
		lastModel: last?.model ?? null
	};
}

/**
 * Prompt + completion (reasoning is part of the completion, as the provider
 * counts it).
 *
 * @param {{ prompt?: number, completion?: number } | null | undefined} usage
 */
export function tokenCount(usage) {
	return (Number(usage?.prompt) || 0) + (Number(usage?.completion) || 0);
}

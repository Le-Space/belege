// "✦ KI-Vorschläge für alle offenen Rückfragen": the per-payment KI-Vorschlag
// (bridge POST /match/assist) for every open question about a missing
// receipt, a few at a time, app-wide on the same queue as the extraction
// (jobs/queue.js): progress, "Abbrechen", one run at a time, slows down on
// a rate limit, stops when the books are locked and keeps what is left.
//
// The model picks among the same receipts as the single suggestion (the 25
// nearest by amount and date, view.js assistCandidates). Its answer is kept on
// the question (`aiSuggestion`) and is only a suggestion: nothing is linked
// until a person takes it. Questions about a receipt with several candidate
// bookings ("unsure-match") are left out: the points already name them, and
// the bridge asks for the receipt of a booking, not the other way round.

import { recordEvent } from '../activity/events.js';
import { formatMoney } from '../bank/format.js';
import { cleanMatchingSettings } from './classify.js';
import { learnedVendors } from './partners.js';
import { assistCandidates, receiptChoices } from './view.js';
import { eventCalls } from '../stats/usage.js';
import { runQueue } from '../jobs/queue.js';
import { savePending } from '../jobs/pending.js';
import { loadWorkers } from '../jobs/workers.js';

export const aiRun = $state({
	/** @type {{ done: number, count: number } | null} */
	progress: null,
	cancelling: false,
	/** questions the model could not be asked about (an error) in the last run */
	failed: 0
});

/**
 * The open questions a run asks about: a booking without a receipt that has
 * no suggestion yet.
 *
 * @param {Record<string, any>[]} questions
 * @returns {Record<string, any>[]}
 */
export function aiEligible(questions) {
	return questions.filter(
		(q) => q.state === 'open' && q.kind === 'missing-receipt' && q.transactionId && !q.aiSuggestion
	);
}

/**
 * What a run will cost, from the last single suggestions: tokens per request.
 *
 * @param {Record<string, any>[]} events
 * @param {number} count requests the run makes
 * @returns {{ requests: number, tokens: number | null }}
 */
export function aiEstimate(events, count) {
	const seen = events
		.filter((e) => e.kind === 'match-assist' && Number(e.tokensTotal) > 0)
		.slice(0, 20)
		.map((e) => Number(e.tokensTotal));
	if (!seen.length) return { requests: count, tokens: null };
	const avg = seen.reduce((a, b) => a + b, 0) / seen.length;
	return { requests: count, tokens: Math.round((avg * count) / 100) * 100 };
}

/**
 * @typedef {object} Context
 * @property {{ matchAssist: (body: any) => Promise<any> }} client the bridge
 * @property {() => ({ questions: any, transactions: any, receipts: any, matches: any, settings: any, partners?: any, events?: any } | null)} store the open books, or null once locked
 * @property {() => Promise<unknown>} [refresh] after each question
 * @property {number} [workers] requests at once; else the setting (jobs/workers.js)
 */

/** The time a suggestion is stored with: a timestamp, not reactive state. */
const clock = () => new Date();

/**
 * Ask the model about each question in turn. Refused (false) while a run goes.
 *
 * @param {Context} ctx
 * @param {string[]} ids question ids
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<boolean>}
 */
export async function suggestAll(ctx, ids, { now = clock } = {}) {
	if (aiRun.progress) return false;
	const books = ctx.store();
	if (!books) return false;
	const [receipts, matches, partners, settingsList] = await Promise.all([
		books.receipts.list(),
		books.matches.list(),
		books.partners ? books.partners.list() : [],
		books.settings.list()
	]);
	const matching = settingsList.find((/** @type {any} */ s) => s.key === 'matching')?.value;
	const opts = {
		companyNames: cleanMatchingSettings(matching).companyNames,
		learnedVendors: learnedVendors(partners)
	};
	const settings = books.settings;
	return runQueue({
		ids,
		state: aiRun,
		workers: ctx.workers ?? (await loadWorkers(settings)),
		isOpen: () => ctx.store()?.questions === books.questions,
		handle: async (id) => {
			const store = ctx.store();
			if (!store) return;
			const q = await store.questions.get(id);
			const tx = q?.transactionId ? await store.transactions.get(q.transactionId) : null;
			if (!q || !tx || q.state !== 'open' || q.aiSuggestion) return;
			const candidates = assistCandidates(tx, receiptChoices(tx, receipts, matches, opts));
			/** @type {Record<string, any>} */
			let suggestion = { receiptId: null, confidence: null, reason: '', at: now().toISOString() };
			if (candidates.length) {
				// A rate limit (429) is thrown on: the queue tries this question again later.
				const r = await ctx.client.matchAssist({
					booking: {
						counterparty: String(tx.counterparty ?? '').slice(0, 200),
						purpose: String(tx.purpose ?? '').slice(0, 1000),
						amount: formatMoney(tx.amountCents ?? 0, tx.currency).replace(/\s*EUR$/, ''),
						day: String(tx.bookedOn ?? '')
					},
					candidates
				});
				suggestion = {
					receiptId: r.pick?.id ?? null,
					confidence: r.pick?.confidence ?? null,
					reason: String(r.pick?.reason ?? '').slice(0, 300),
					model: r.llm?.calls?.at(-1)?.model ?? null,
					at: now().toISOString()
				};
				await recordEvent(store.events, 'match-assist', {
					transactionId: tx.id,
					questionId: id,
					batch: true,
					candidates: candidates.length,
					pick: suggestion.confidence,
					model: suggestion.model,
					calls: eventCalls(r.llm?.calls),
					ms: (r.llm?.calls ?? []).reduce(
						(/** @type {number} */ n, /** @type {any} */ c) => n + (c.ms ?? 0),
						0
					),
					tokensTotal: (r.llm?.calls ?? []).reduce(
						(/** @type {number} */ n, /** @type {any} */ c) =>
							n + (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0),
						0
					)
				});
			}
			// Written onto the question as it is now (the matching may have touched it).
			const latest = await store.questions.get(id);
			if (latest && latest.state === 'open') {
				await store.questions.put({ ...latest, aiSuggestion: suggestion });
			}
			await ctx.refresh?.();
		},
		onProgress: (left) => savePending(settings, 'suggest', left),
		onEnd: (left, how) => savePending(settings, 'suggest', how === 'closed' ? left : [])
	});
}

/** "Abbrechen": the question being asked about is finished, no further one is sent. */
export function cancelSuggestAll() {
	if (aiRun.progress) aiRun.cancelling = true;
}

/**
 * "Verwerfen": the suggestion is set aside; the question stays open, and a run does not
 * ask about it again.
 *
 * @param {{ questions: any }} store
 * @param {string} id
 */
export async function dismissSuggestion(store, id) {
	const q = await store.questions.get(id);
	if (!q?.aiSuggestion) return;
	await store.questions.put({ ...q, aiSuggestion: { ...q.aiSuggestion, dismissed: true } });
}

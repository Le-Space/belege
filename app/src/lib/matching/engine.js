// "Abgleich": receipts against transactions, into the sealed `matches` and
// `questions` collections. Runs after a sync, after a receipt was read, and
// on demand.
//
// Idempotent: a second run over the same records writes nothing. It never
// overrides a person: a confirmed match stays, a rejected pair is never
// proposed again, an answered question stays answered (unless it was
// answered "none of these" and a new candidate turned up). An automatic
// match stays as it is, too; only "Zuordnung lösen" ends it.
//
// Records:
//   matches    transactionId, receiptId, score, reasons, state 'auto' |
//              'confirmed' | 'rejected'
//   questions  kind 'unsure-match' | 'missing-receipt' | 'unknown-sender',
//              receiptId?, transactionId?, candidates, state 'open' |
//              'answered', answer
// and it keeps `transactions.receiptId` and `receipts.status` in step with
// the active matches.

import { recordEvent } from '../activity/events.js';
import { needsConfirmation } from '../receipts/import.js';
import { getSetting } from '../store/settings.js';
import { classifyTransaction, DEFAULT_GRACE_DAYS } from './classify.js';
import { buildMatchingContext } from './context.js';
import { graceWait, localDay } from './grace.js';
import { assign, receiptFacts, txFacts } from './score.js';

/** @typedef {import('../store/repository.js').Collection} Collection */
/** @typedef {import('../store/repository.js').StoredRecord} StoredRecord */
/**
 * @typedef {{ transactions: Collection, receipts: Collection, matches: Collection, questions: Collection, settings: Collection, accounts: Collection, events?: Collection }} MatchingStore
 */

/**
 * @typedef {object} MatchingResult
 * @property {number} sure pairs matched automatically in this run
 * @property {number} open questions open after the run
 * @property {number} created questions this run asked (new or asked again)
 * @property {number} resolved questions that settled themselves
 * @property {number} classified bookings that need no receipt (a rule, a fee, an own transfer, a loan, a person's "Kein Beleg nötig")
 * @property {number} waiting bookings without a receipt still inside the grace period
 * @property {number} writes records written
 */

/**
 * @typedef {'read' | 'score' | 'write' | 'done'} MatchingStep
 * @typedef {{ step: MatchingStep, receipts?: number, transactions?: number }} MatchingProgress
 */

export const ACTIVE = new Set(['auto', 'confirmed']);

/** @param {{ state?: string, deleted?: boolean }} m */
export const isActive = (m) => !m.deleted && ACTIVE.has(String(m.state));

/** @param {string} receiptId @param {string} transactionId */
export const pairKey = (receiptId, transactionId) => `${receiptId}|${transactionId}`;

/** @param {Record<string, any>} q kind, receiptId, transactionId */
export const questionKey = (q) => `${q.kind}:${q.receiptId ?? ''}:${q.transactionId ?? ''}`;

/**
 * Whether a receipt takes part in matching: read, not waiting for a yes, not
 * ignored, with an amount.
 *
 * @param {Record<string, any>} r
 */
export function matchable(r) {
	return (
		!r.deleted &&
		Boolean(r.extraction) &&
		!needsConfirmation(r) &&
		r.status !== 'ignoriert' &&
		r.status !== 'rückfrage'
	);
}

/**
 * Whether a transaction is covered: a receipt, or no receipt needed.
 *
 * @param {Record<string, any>} tx
 * @param {import('./classify.js').Classification | null | undefined} classification
 */
export function isCovered(tx, classification) {
	return Boolean(tx.receiptId) || Boolean(tx.noReceipt) || Boolean(classification);
}

/** Same JSON, same value (for "did anything change"). */
const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Bring `transactions.receiptId` and `receipts.status` in step with the
 * active matches. Writes only what differs.
 *
 * @param {MatchingStore} store
 * @returns {Promise<number>} records written
 */
export async function syncLinks(store) {
	const [txs, receipts, matches] = await Promise.all([
		store.transactions.list(),
		store.receipts.list(),
		store.matches.list()
	]);
	const active = matches.filter(isActive).sort((a, b) => (a.id < b.id ? -1 : 1));
	/** @type {Map<string, string>} */
	const receiptOf = new Map();
	const matchedReceipts = new Set();
	for (const m of active) {
		if (!receiptOf.has(m.transactionId)) receiptOf.set(m.transactionId, m.receiptId);
		matchedReceipts.add(m.receiptId);
	}
	let writes = 0;
	for (const tx of txs) {
		const want = receiptOf.get(tx.id) ?? null;
		if ((tx.receiptId ?? null) !== want) {
			await store.transactions.put({ ...tx, receiptId: want });
			writes++;
		}
	}
	for (const r of receipts) {
		const want = matchedReceipts.has(r.id)
			? 'zugeordnet'
			: r.status === 'zugeordnet'
				? r.extraction
					? 'ausgelesen'
					: 'neu'
				: r.status;
		if (r.status !== want) {
			await store.receipts.put({ ...r, status: want });
			writes++;
		}
	}
	return writes;
}

/**
 * @param {object} params
 * @param {MatchingStore} params.store
 * @param {Date} [params.now] "today", for the grace period
 * @param {'manual' | 'auto'} [params.trigger] a manual run is always logged; an automatic one only when it changed something
 * @param {(p: MatchingProgress) => void} [params.onProgress]
 * @returns {Promise<MatchingResult>}
 */
export async function runMatching({
	store,
	now = new Date(),
	trigger = 'auto',
	onProgress = () => {}
}) {
	onProgress({ step: 'read' });
	const [txs, receipts, matches, questions, accounts, settings] = await Promise.all([
		store.transactions.list(),
		store.receipts.list(),
		store.matches.list(),
		store.questions.list(),
		store.accounts.list(),
		getSetting(store.settings, 'matching')
	]);
	const ctx = await buildMatchingContext({ accounts, transactions: txs, settings });
	const today = localDay(now);
	const graceDays = ctx.graceDays ?? DEFAULT_GRACE_DAYS;
	let writes = 0;

	const txById = new Map(txs.map((t) => [t.id, t]));
	const receiptById = new Map(receipts.map((r) => [r.id, r]));

	// Matches whose receipt or booking is gone go too.
	const live = [];
	for (const m of matches) {
		if (!txById.has(m.transactionId) || !receiptById.has(m.receiptId)) {
			if (isActive(m)) {
				await store.matches.softDelete(m.id);
				writes++;
			}
			continue;
		}
		live.push(m);
	}
	const active = live.filter(isActive);
	const rejected = new Set(
		live.filter((m) => m.state === 'rejected').map((m) => pairKey(m.receiptId, m.transactionId))
	);
	const matchedTx = new Set(active.map((m) => m.transactionId));
	const matchedReceipt = new Set(active.map((m) => m.receiptId));

	let classified = 0;
	const openTx = txs.filter((t) => {
		if (t.noReceipt || classifyTransaction(t, ctx)) {
			if (!t.receiptId) classified++;
			return false;
		}
		return !matchedTx.has(t.id);
	});
	const openReceipts = receipts.filter((r) => matchable(r) && !matchedReceipt.has(r.id));
	const receiptFactsList = openReceipts.map((r) => receiptFacts(r, ctx)).filter((f) => f !== null);
	onProgress({ step: 'score', receipts: receiptFactsList.length, transactions: openTx.length });

	const result = assign({
		receipts: /** @type {import('./score.js').ReceiptFacts[]} */ (receiptFactsList),
		transactions: openTx.map(txFacts),
		excluded: (r, t) => rejected.has(pairKey(r, t))
	});

	onProgress({ step: 'write' });
	for (const s of result.sure) {
		await store.matches.put({
			transactionId: s.transactionId,
			receiptId: s.receiptId,
			score: s.score,
			reasons: s.reasons,
			state: 'auto'
		});
		writes++;
	}

	// The questions this state of the books asks.
	const reminders = new Set(
		receiptFactsList.filter((f) => f?.reminder).map((f) => /** @type {any} */ (f).id)
	);
	/** @type {Map<string, { kind: string, receiptId: string | null, transactionId: string | null, candidates: any[] }>} */
	const wanted = new Map();
	const offered = new Set();
	for (const u of result.unsure) {
		if (reminders.has(u.receiptId)) continue;
		const q = {
			kind: 'unsure-match',
			receiptId: u.receiptId,
			transactionId: null,
			candidates: u.candidates
		};
		wanted.set(questionKey(q), q);
		for (const c of u.candidates) offered.add(c.transactionId);
	}
	// Bookings still inside the grace period: no question yet, and an open one
	// (asked before the grace was raised) is left as it is.
	const waiting = new Set();
	for (const u of result.unmatched) {
		const t = txById.get(u.transactionId);
		if (t && graceWait(t, graceDays, today) !== null) waiting.add(u.transactionId);
	}
	for (const u of result.unmatched) {
		if (offered.has(u.transactionId) || waiting.has(u.transactionId)) continue;
		const candidates = u.candidates.filter((c) => !reminders.has(c.receiptId));
		const q = {
			kind: 'missing-receipt',
			receiptId: null,
			transactionId: u.transactionId,
			candidates
		};
		wanted.set(questionKey(q), q);
	}
	for (const r of receipts) {
		if (r.status === 'rückfrage' && needsConfirmation(r)) {
			const q = { kind: 'unknown-sender', receiptId: r.id, transactionId: null, candidates: [] };
			wanted.set(questionKey(q), q);
		}
	}

	/** @type {Map<string, StoredRecord>} */
	const existing = new Map();
	for (const q of questions) existing.set(questionKey(q), q);

	let resolved = 0;
	let created = 0;
	for (const [key, q] of wanted) {
		const found = existing.get(key);
		if (!found) {
			await store.questions.put({ ...q, state: 'open', answer: null });
			writes++;
			created++;
		} else if (found.state === 'open') {
			if (!same(found.candidates, q.candidates)) {
				await store.questions.put({ ...found, candidates: q.candidates });
				writes++;
			}
		} else if (found.answer?.choice === 'none' && q.candidates.length > 0) {
			// Rejected candidates are never offered again: these are new ones.
			await store.questions.put({
				...found,
				state: 'open',
				answer: null,
				candidates: q.candidates
			});
			writes++;
			created++;
		}
	}
	for (const [key, found] of existing) {
		const keep =
			found.kind === 'missing-receipt' &&
			found.transactionId &&
			waiting.has(found.transactionId) &&
			!offered.has(found.transactionId);
		if (found.state === 'open' && !wanted.has(key) && !keep) {
			await store.questions.put({
				...found,
				state: 'answered',
				answer: { choice: 'auto', by: 'engine' }
			});
			writes++;
			resolved++;
		}
	}

	writes += await syncLinks(store);
	const open = (await store.questions.list({ where: (q) => q.state === 'open' })).length;
	/** @type {MatchingResult} */
	const summary = {
		sure: result.sure.length,
		open,
		created,
		resolved,
		classified,
		waiting: waiting.size,
		writes
	};
	// Every run is logged when a person started it; the automatic ones (after
	// each sync, fetch and read) only when they changed something.
	if (trigger === 'manual' || writes > 0) {
		await recordEvent(store.events, 'matching', {
			trigger,
			sure: summary.sure,
			open: summary.open,
			created,
			resolved,
			classified,
			waiting: summary.waiting,
			writes,
			// Which pairs were taken, for the links on the Verlauf page.
			pairs: result.sure.slice(0, 50).map((p) => ({
				receiptId: p.receiptId,
				transactionId: p.transactionId,
				score: p.score
			}))
		});
	}
	onProgress({ step: 'done' });
	return summary;
}

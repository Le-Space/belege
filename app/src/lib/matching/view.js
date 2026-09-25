// What the pages show of matching: coverage, badges, candidates for "Beleg
// zuordnen", the query for the private-mailbox search and how its hits rank.
// Pure, so it is tested without a database or a browser.

import { isActive } from './engine.js';
import { receiptFacts, scorePair, txFacts } from './score.js';
import { STOP_WORDS } from './normalize.js';

/** @typedef {import('./classify.js').Classification} Classification */
/** @typedef {{ id: string } & Record<string, any>} Rec */

/**
 * Covered: a linked receipt, "Kein Beleg nötig", or a classification that
 * needs none (own transfer, bank fee, loan, a rule).
 *
 * @param {{ id: string, receiptId?: string | null, noReceipt?: any }} tx
 * @param {Record<string, Classification>} classifications
 */
export function isTxCovered(tx, classifications) {
	return Boolean(tx.receiptId) || Boolean(tx.noReceipt) || Boolean(classifications[tx.id]);
}

/**
 * The badge a booking carries in the list: `receipt`, one of the no-receipt
 * kinds, `no-receipt` (a person's "Kein Beleg nötig"), or null (missing).
 *
 * @param {{ id: string, receiptId?: string | null, noReceipt?: any }} tx
 * @param {Record<string, Classification>} classifications
 * @returns {string | null}
 */
export function coverageBadge(tx, classifications) {
	if (tx.receiptId) return 'receipt';
	if (tx.noReceipt) return 'no-receipt';
	return classifications[tx.id]?.kind ?? null;
}

/**
 * The active matches of a booking, oldest first.
 *
 * @param {string} transactionId
 * @param {Record<string, any>[]} matches
 */
export function matchesOfTx(transactionId, matches) {
	return matches
		.filter((m) => m.transactionId === transactionId && isActive(m))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The active match of a receipt, if any.
 *
 * @param {string} receiptId
 * @param {Record<string, any>[]} matches
 */
export function matchOfReceipt(receiptId, matches) {
	return matches.find((m) => m.receiptId === receiptId && isActive(m)) ?? null;
}

/**
 * Receipts for "Beleg zuordnen": every read receipt not linked elsewhere,
 * best score against this booking first; the ones that fit (≥ 40) are the
 * suggestions.
 *
 * @template {Rec} R
 * @param {Rec} tx
 * @param {R[]} receipts
 * @param {Record<string, any>[]} matches
 * @param {{ companyNames?: string[], learnedVendors?: Map<string, string[]> }} [ctx]
 * @returns {{ receipt: R, score: number, reasons: string[], suggested: boolean }[]}
 */
export function receiptChoices(tx, receipts, matches, ctx = {}) {
	const linkedElsewhere = new Set(
		matches.filter((m) => isActive(m) && m.transactionId !== tx.id).map((m) => m.receiptId)
	);
	const linkedHere = new Set(matchesOfTx(tx.id, matches).map((m) => m.receiptId));
	const t = txFacts(tx, ctx);
	return receipts
		.filter(
			(r) =>
				!r.deleted &&
				!linkedElsewhere.has(r.id) &&
				!linkedHere.has(r.id) &&
				r.status !== 'rückfrage' &&
				r.status !== 'ignoriert'
		)
		.map((r) => {
			const facts = receiptFacts(r, ctx);
			const s = facts ? scorePair(facts, t) : { score: 0, reasons: [] };
			return { receipt: r, ...s, suggested: s.score >= 40 };
		})
		.sort((a, b) => b.score - a.score || (a.receipt.id < b.receipt.id ? 1 : -1));
}

/**
 * Other bookings with the same counterparty, newest first.
 *
 * @template {Rec} T
 * @param {Rec} tx
 * @param {T[]} transactions
 * @param {number} [limit]
 * @returns {T[]}
 */
export function otherPayments(tx, transactions, limit = 6) {
	const name = String(tx.counterparty ?? '')
		.trim()
		.toLowerCase();
	if (!name) return [];
	return transactions
		.filter(
			(o) =>
				o.id !== tx.id &&
				String(o.counterparty ?? '')
					.trim()
					.toLowerCase() === name
		)
		.sort((a, b) =>
			a.bookedOn === b.bookedOn ? (a.id < b.id ? 1 : -1) : a.bookedOn < b.bookedOn ? 1 : -1
		)
		.slice(0, limit);
}

/** The first word of a name that says who it is: no legal form, no filler, three letters or more. */
function searchWord(/** @type {unknown} */ s) {
	for (const word of String(s ?? '').split(/[^\p{L}\p{N}]+/u)) {
		const plain = word.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
		if (word.length >= 3 && !STOP_WORDS.has(plain) && !/^\d+$/.test(word)) return word;
	}
	return null;
}

/** `-5259` → `52,59`; `-119000` → `1190,00` (the bridge tries every spelling). */
export function searchAmount(/** @type {number} */ cents) {
	const abs = Math.abs(Math.trunc(cents));
	return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export const SEARCH_DAYS = 14;

/**
 * What "Im privaten Postfach suchen" asks the bridge: the counterparty's
 * first telling word (the purpose's, when the counterparty has none), the
 * amount, and the booking day ± 14 days.
 *
 * @param {Record<string, any>} tx
 * @returns {{ text: string | null, amount: string, around: string, days: number }}
 */
export function privateSearchQuery(tx) {
	const text = searchWord(tx.counterparty) ?? searchWord(tx.purpose);
	return {
		text: text ? text.slice(0, 100) : null,
		amount: searchAmount(Number(tx.amountCents ?? 0)),
		around: String(tx.bookedOn),
		days: SEARCH_DAYS
	};
}

/**
 * Which criteria a hit matched: `text` (the vendor word), `amount` (any
 * spelling).
 *
 * @param {{ matched?: string[] }} hit
 * @returns {('text' | 'amount')[]}
 */
export function hitCriteria(hit) {
	const m = hit.matched ?? [];
	/** @type {('text' | 'amount')[]} */
	const out = [];
	if (m.some((x) => x.startsWith('"'))) out.push('text');
	if (m.some((x) => !x.startsWith('"'))) out.push('amount');
	return out;
}

const RECEIPT_WORDS =
	/receipt|invoice|rechnung|quittung|beleg|zahlungsbest|payment confirm|bestellbest|order confirm/i;
const SIGN_IN_WORDS =
	/anmeld|sign.?in|log.?in|magic link|sicherer link|secure link|verif|bestätigungscode|security code|passwort|password/i;

/**
 * How much a hit looks like the receipt, and why (docs/phase-0.md: a vendor
 * search also finds newsletters and sign-in mails, an amount search unrelated
 * mails). No LLM: the mail's own fields, deterministic.
 *
 * @param {{ matched?: string[], attachments?: any[], auth?: { verdict?: string }, receivedAt?: string | null, subject?: string, from?: { address?: string, name?: string }, bulk?: boolean }} h
 * @param {{ word?: string | null, around?: string | null }} [context] the search word, the booking day
 * @returns {{ score: number, why: string[] }}
 */
export function hitScore(h, { word = null, around = null } = {}) {
	let score = 0;
	/** @type {string[]} */
	const why = [];
	const add = (/** @type {number} */ n, /** @type {string} */ reason) => {
		score += n;
		why.push(reason);
	};
	const criteria = hitCriteria(h);
	if (criteria.includes('amount')) add(4, 'amount');
	if (criteria.includes('text')) add(1, 'word');
	const w = String(word ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9äöüß]/g, '');
	const address = String(h.from?.address ?? '').toLowerCase();
	const domain = address.split('@')[1] ?? '';
	if (
		w.length >= 3 &&
		(domain.includes(w) ||
			String(h.from?.name ?? '')
				.toLowerCase()
				.includes(w))
	)
		add(4, 'sender');
	const files = (h.attachments ?? []).filter((a) => a.kind === 'pdf' || a.kind === 'image');
	if (files.length) add(3, 'attachment');
	if (files.some((a) => RECEIPT_WORDS.test(String(a.name ?? '')))) add(2, 'attachment-name');
	const subject = String(h.subject ?? '');
	if (RECEIPT_WORDS.test(subject)) add(3, 'subject');
	if (SIGN_IN_WORDS.test(subject)) add(-4, 'sign-in');
	if (h.bulk) add(-3, 'newsletter');
	if (h.auth?.verdict === 'pass') add(1, 'sender-check');
	if (around && h.receivedAt) {
		const days =
			Math.abs(Date.parse(String(h.receivedAt)) - Date.parse(`${around}T12:00:00Z`)) / 864e5;
		if (days <= 3) add(2, 'date');
	}
	return { score, why };
}

/**
 * Hits, most likely receipt first (hitScore), then the newest.
 *
 * @template {Parameters<typeof hitScore>[0]} H
 * @param {H[]} hits
 * @param {Parameters<typeof hitScore>[1]} [context]
 * @returns {H[]}
 */
export function rankHits(hits, context = {}) {
	const scored = hits.map((h) => ({ h, s: hitScore(h, context).score }));
	return scored
		.sort(
			(a, b) =>
				b.s - a.s || String(b.h.receivedAt ?? '').localeCompare(String(a.h.receivedAt ?? ''))
		)
		.map((x) => x.h);
}

/**
 * The one hit that is clearly the receipt: it looks like one (score ≥ 10) and
 * leads the next by 4 or more. Null when it is not that clear.
 *
 * @template {Parameters<typeof hitScore>[0]} H
 * @param {H[]} ranked from rankHits
 * @param {Parameters<typeof hitScore>[1]} [context]
 * @returns {H | null}
 */
export function likelyHit(ranked, context = {}) {
	if (!ranked.length) return null;
	const first = hitScore(ranked[0], context).score;
	const second = ranked[1] ? hitScore(ranked[1], context).score : -Infinity;
	return first >= 10 && first - second >= 4 ? ranked[0] : null;
}

/**
 * Questions for the Home card: how many are open, how many of all were
 * settled.
 *
 * @param {Record<string, any>[]} questions
 */
export function questionProgress(questions) {
	const live = questions.filter((q) => !q.deleted);
	const open = live.filter((q) => q.state === 'open').length;
	return { open, done: live.length - open, total: live.length };
}

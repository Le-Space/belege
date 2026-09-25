// What a person decides: link a receipt, undo a link, "Kein Beleg nötig", and
// the answers to a question. Every decision is a record the engine respects
// (engine.js): a confirmed match is never taken back by it, a rejected pair
// never offered again.

// Each decision is also an event in the Verlauf (activity/events.js); an
// answer to a question is one event, not one per step it takes.

import { recordEvent } from '../activity/events.js';
import { getSetting, setSetting } from '../store/settings.js';
import { cleanMatchingSettings, feeKey } from './classify.js';
import { isActive, syncLinks } from './engine.js';
import { learnFromLink } from './partners.js';

/** @typedef {import('./engine.js').MatchingStore} MatchingStore */
/** @typedef {{ log?: boolean }} ActionOptions `log: false` when a caller logs the decision itself */

/**
 * @param {MatchingStore} store
 * @param {string} action
 * @param {Record<string, any>} fields
 */
const decided = (store, action, fields) =>
	recordEvent(store.events, 'decision', { action, ...fields });

/**
 * Link a receipt to a transaction for good. The receipt's other active match
 * (an automatic one elsewhere) is rejected: one receipt, one booking.
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string, score?: number | null, reasons?: string[] }} pair
 * @param {ActionOptions} [options]
 */
export async function confirmMatch(
	store,
	{ receiptId, transactionId, score = null, reasons },
	{ log = true } = {}
) {
	const matches = await store.matches.list();
	for (const m of matches) {
		if (m.receiptId === receiptId && m.transactionId !== transactionId && isActive(m)) {
			await store.matches.put({ ...m, state: 'rejected' });
		}
	}
	const found = matches.find((m) => m.receiptId === receiptId && m.transactionId === transactionId);
	const record = found
		? await store.matches.put({ ...found, state: 'confirmed' })
		: await store.matches.put({
				transactionId,
				receiptId,
				score,
				reasons: reasons ?? ['manual'],
				state: 'confirmed'
			});
	const tx = await store.transactions.get(transactionId);
	if (tx?.noReceipt) await store.transactions.put({ ...tx, noReceipt: null });
	// A person's link teaches: this counterparty is this vendor (partners.js).
	const receipt = await store.receipts.get(receiptId);
	if (store.partners && receipt && tx) {
		const { companyNames } = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
		await learnFromLink(store.partners, receipt, tx, { companyNames });
	}
	await syncLinks(store);
	if (log) {
		await decided(store, found ? 'confirm' : 'link', {
			receiptId,
			transactionId,
			matchId: record.id,
			score: record.score ?? null
		});
	}
	return record;
}

/**
 * "Zuordnung lösen": the pair is rejected, so no run links it again.
 *
 * @param {MatchingStore} store
 * @param {string} matchId
 */
export async function unlinkMatch(store, matchId) {
	const m = await store.matches.get(matchId);
	if (!m) throw new Error(`No match ${matchId}`);
	await store.matches.put({ ...m, state: 'rejected' });
	await syncLinks(store);
	await decided(store, 'unlink', {
		receiptId: m.receiptId,
		transactionId: m.transactionId,
		matchId
	});
}

/**
 * Reject pairs without confirming anything ("keiner davon").
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string }[]} pairs
 * @param {ActionOptions} [options]
 */
export async function rejectPairs(store, pairs, { log = true } = {}) {
	const matches = await store.matches.list();
	for (const { receiptId, transactionId } of pairs) {
		const found = matches.find(
			(m) => m.receiptId === receiptId && m.transactionId === transactionId
		);
		if (found?.state === 'rejected') continue;
		if (found) await store.matches.put({ ...found, state: 'rejected' });
		else {
			await store.matches.put({
				transactionId,
				receiptId,
				score: null,
				reasons: [],
				state: 'rejected'
			});
		}
	}
	await syncLinks(store);
	if (log && pairs.length) {
		await decided(store, 'reject', {
			receiptId: pairs[0].receiptId,
			transactionId: pairs[0].transactionId,
			pairs: pairs.length
		});
	}
}

/**
 * "Kein Beleg nötig" (with a reason), or back (reason null). Active matches of
 * the booking are undone first.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string | null} reason
 * @param {ActionOptions} [options]
 */
export async function setNoReceipt(store, transactionId, reason, { log = true } = {}) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	if (reason !== null) {
		for (const m of await store.matches.list({ where: (m) => m.transactionId === transactionId })) {
			if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
		}
	}
	await store.transactions.put({
		...tx,
		noReceipt:
			reason === null
				? null
				: { reason: reason.trim() || 'Kein Beleg nötig', at: new Date().toISOString() }
	});
	await syncLinks(store);
	if (log)
		await decided(store, reason === null ? 'needs-receipt' : 'no-receipt', { transactionId });
}

/**
 * "Bankgebühr": this booking is a bank fee, and so is the next one on the same
 * account with the same purpose words (classify.js `feeKey`). A purpose
 * without words to learn from makes it "Kein Beleg nötig: Bankgebühr".
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 */
export async function markBankFee(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	const key = feeKey(tx);
	if (!key) return setNoReceipt(store, transactionId, 'Bankgebühr');
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	await setSetting(store.settings, 'matching', {
		...current,
		feeKeys: [...current.feeKeys, key]
	});
	await syncLinks(store);
	await decided(store, 'bank-fee', { transactionId });
}

/**
 * "Vergessen" for a learned bank fee: its bookings need a receipt again.
 *
 * @param {MatchingStore} store
 * @param {string} key as stored (classify.js `feeKey`)
 */
export async function forgetBankFee(store, key) {
	const current = cleanMatchingSettings(await getSetting(store.settings, 'matching'));
	await setSetting(store.settings, 'matching', {
		...current,
		feeKeys: current.feeKeys.filter((k) => k !== key)
	});
	await decided(store, 'bank-fee-forget', {});
}

/**
 * "Absender geprüft – freigeben": the receipt may be opened and read.
 *
 * @param {MatchingStore} store
 * @param {string} receiptId
 * @param {ActionOptions} [options]
 */
export async function confirmSender(store, receiptId, { log = true } = {}) {
	const r = await store.receipts.get(receiptId);
	if (!r) throw new Error('No receipt to confirm.');
	const record = await store.receipts.put({
		...r,
		confirmedByUser: true,
		status: r.status === 'rückfrage' ? 'neu' : r.status
	});
	if (log) await decided(store, 'confirm-sender', { receiptId });
	return record;
}

/**
 * @typedef {{ choice: 'candidate', receiptId?: string, transactionId?: string }
 *   | { choice: 'none' }
 *   | { choice: 'no-receipt', reason?: string }
 *   | { choice: 'ignore' }
 *   | { choice: 'confirm-sender' }} Answer
 */

/**
 * Answer a question, and do what the answer says.
 *
 * @param {MatchingStore} store
 * @param {string} questionId
 * @param {Answer} answer
 */
export async function answerQuestion(store, questionId, answer) {
	const q = await store.questions.get(questionId);
	if (!q) throw new Error(`No question ${questionId}`);
	const candidates = Array.isArray(q.candidates) ? q.candidates : [];

	if (answer.choice === 'candidate') {
		const receiptId = q.receiptId ?? answer.receiptId;
		const transactionId = q.transactionId ?? answer.transactionId;
		if (!receiptId || !transactionId) throw new Error('A candidate needs a receipt and a booking.');
		const c = candidates.find(
			(/** @type {any} */ c) =>
				(c.receiptId ?? receiptId) === receiptId &&
				(c.transactionId ?? transactionId) === transactionId
		);
		await confirmMatch(
			store,
			{
				receiptId,
				transactionId,
				score: c?.score ?? null,
				reasons: c?.reasons
			},
			{ log: false }
		);
	} else if (answer.choice === 'none') {
		await rejectPairs(
			store,
			candidates.map((/** @type {any} */ c) => ({
				receiptId: q.receiptId ?? c.receiptId,
				transactionId: q.transactionId ?? c.transactionId
			})),
			{ log: false }
		);
	} else if (answer.choice === 'no-receipt') {
		if (!q.transactionId) throw new Error('Only a booking can need no receipt.');
		await setNoReceipt(store, q.transactionId, answer.reason ?? '', { log: false });
	} else if (answer.choice === 'confirm-sender') {
		if (!q.receiptId) throw new Error('No receipt to confirm.');
		await confirmSender(store, q.receiptId, { log: false });
	} else if (answer.choice === 'ignore' && q.kind === 'unknown-sender' && q.receiptId) {
		const r = await store.receipts.get(q.receiptId);
		if (r) await store.receipts.put({ ...r, status: 'ignoriert' });
	}
	// Only what was given: the store encodes with dag-cbor, which has no `undefined`.
	const stored = Object.fromEntries(Object.entries(answer).filter(([, v]) => v !== undefined));
	const record = await store.questions.put({
		...q,
		state: 'answered',
		answer: { ...stored, at: new Date().toISOString() }
	});
	await decided(store, 'answer', {
		questionId,
		questionKind: q.kind,
		choice: answer.choice,
		receiptId: q.receiptId ?? ('receiptId' in answer ? answer.receiptId : undefined) ?? null,
		transactionId:
			q.transactionId ?? ('transactionId' in answer ? answer.transactionId : undefined) ?? null
	});
	return record;
}

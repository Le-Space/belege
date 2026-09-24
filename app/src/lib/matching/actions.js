// What a person decides: link a receipt, undo a link, "Kein Beleg nötig", and
// the answers to a question. Every decision is a record the engine respects
// (engine.js): a confirmed match is never taken back by it, a rejected pair
// never offered again.

import { isActive, syncLinks } from './engine.js';

/** @typedef {import('./engine.js').MatchingStore} MatchingStore */

/**
 * Link a receipt to a transaction for good. The receipt's other active match
 * (an automatic one elsewhere) is rejected: one receipt, one booking.
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string, score?: number | null, reasons?: string[] }} pair
 */
export async function confirmMatch(store, { receiptId, transactionId, score = null, reasons }) {
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
	await syncLinks(store);
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
}

/**
 * Reject pairs without confirming anything ("keiner davon").
 *
 * @param {MatchingStore} store
 * @param {{ receiptId: string, transactionId: string }[]} pairs
 */
export async function rejectPairs(store, pairs) {
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
}

/**
 * "Kein Beleg nötig" (with a reason), or back (reason null). Active matches of
 * the booking are undone first.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string | null} reason
 */
export async function setNoReceipt(store, transactionId, reason) {
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
		await confirmMatch(store, {
			receiptId,
			transactionId,
			score: c?.score ?? null,
			reasons: c?.reasons
		});
	} else if (answer.choice === 'none') {
		await rejectPairs(
			store,
			candidates.map((/** @type {any} */ c) => ({
				receiptId: q.receiptId ?? c.receiptId,
				transactionId: q.transactionId ?? c.transactionId
			}))
		);
	} else if (answer.choice === 'no-receipt') {
		if (!q.transactionId) throw new Error('Only a booking can need no receipt.');
		await setNoReceipt(store, q.transactionId, answer.reason ?? '');
	} else if (answer.choice === 'confirm-sender') {
		const r = q.receiptId ? await store.receipts.get(q.receiptId) : null;
		if (!r) throw new Error('No receipt to confirm.');
		await store.receipts.put({
			...r,
			confirmedByUser: true,
			status: r.status === 'rückfrage' ? 'neu' : r.status
		});
	} else if (answer.choice === 'ignore' && q.kind === 'unknown-sender' && q.receiptId) {
		const r = await store.receipts.get(q.receiptId);
		if (r) await store.receipts.put({ ...r, status: 'ignoriert' });
	}
	return store.questions.put({
		...q,
		state: 'answered',
		answer: { ...answer, at: new Date().toISOString() }
	});
}

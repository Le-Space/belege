// "Privat (Irrläufer)" (issue #172): a private purchase paid from the business
// account by mistake. It is no business expense and needs no business
// receipt; a short note (Aktennotiz) documents the mistake. How it is booked
// depends on the legal form (booking/settings.js `privateAccounts`): a sole
// proprietor withdraws privately (1800); a UG or GmbH paid for its
// shareholder, a claim the shareholder settles by paying it back. Until the
// repayment is linked, the payment is open ("noch nicht ausgeglichen").
//
// Kept on the bookings themselves, which an import leaves alone:
//   the payment:   `privateMistake: { note, at, settledBy: [repayment ids] }`
//   a repayment:   `privateRepaymentOf: [payment ids]`
// One repayment may settle several private payments, and several repayments
// one payment: what counts is the sum over everything linked together.

import { recordEvent } from '../activity/events.js';
import { formatDate, formatMoney } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { isActive, syncLinks } from './engine.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {import('./engine.js').MatchingStore} MatchingStore */

/** @param {unknown} v @returns {string[]} */
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);

export { privateKind } from './private-kind.js';

/**
 * The note a private payment starts with; the person may change it.
 *
 * @param {Rec} tx
 */
export function privateNote(tx) {
	// A note for the books: German, like the Eigenbeleg (i18n DOCUMENT_LOCALE).
	const amount = formatMoney(
		Math.abs(Number(tx.amountCents ?? 0)),
		tx.currency ?? 'EUR',
		DOCUMENT_LOCALE
	);
	const what = [tx.counterparty, tx.purpose].map((s) => String(s ?? '').trim()).filter(Boolean);
	return [
		// eslint-disable-next-line belege/no-german -- a bookkeeping note, German like the Eigenbeleg (#192)
		`Private Zahlung, irrtümlich vom Geschäftskonto bezahlt: ${amount} am ${formatDate(String(tx.bookedOn ?? ''), DOCUMENT_LOCALE)}${what.length ? ` (${what.join(' – ').slice(0, 200)})` : ''}.`,
		// eslint-disable-next-line belege/no-german -- a bookkeeping note, German like the Eigenbeleg (#192)
		'Kein Betriebsausgabenbeleg. Ausgleich durch Rückzahlung vom Privatkonto.'
	].join(' ');
}

/**
 * How far a private payment is settled: the sum of the private payments and
 * repayments linked together with it, and what is still open.
 *
 * @param {Rec} tx a private payment or a repayment
 * @param {Rec[]} transactions
 * @returns {{ openCents: number, paidCents: number, repaidCents: number, repayments: Rec[], payments: Rec[] }}
 */
export function privateSettlement(tx, transactions) {
	const byId = new Map(transactions.filter((t) => !t.deleted).map((t) => [String(t.id), t]));
	/** @type {Set<string>} */
	const seen = new Set();
	const queue = [String(tx.id)];
	while (queue.length) {
		const id = /** @type {string} */ (queue.pop());
		if (seen.has(id)) continue;
		seen.add(id);
		const t = byId.get(id);
		if (!t) continue;
		for (const o of [...ids(t.privateMistake?.settledBy), ...ids(t.privateRepaymentOf)]) {
			if (!seen.has(o)) queue.push(o);
		}
	}
	const group = [...seen].map((id) => byId.get(id)).filter(Boolean);
	const payments = /** @type {Rec[]} */ (group.filter((t) => t?.privateMistake));
	const repayments = /** @type {Rec[]} */ (group.filter((t) => ids(t?.privateRepaymentOf).length));
	const paidCents = payments.reduce((n, t) => n + Math.abs(Number(t.amountCents ?? 0)), 0);
	const repaidCents = repayments.reduce((n, t) => n + Math.abs(Number(t.amountCents ?? 0)), 0);
	return {
		openCents: Math.max(0, paidCents - repaidCents),
		paidCents,
		repaidCents,
		repayments: repayments.filter((r) => ids(r.privateRepaymentOf).length),
		payments
	};
}

/**
 * The private payments still open, newest first, for "Braucht dich".
 *
 * @param {Rec[]} transactions
 * @returns {{ tx: Rec, openCents: number }[]}
 */
export function openPrivatePayments(transactions) {
	/** @type {Set<string>} */
	const counted = new Set();
	/** @type {{ tx: Rec, openCents: number }[]} */
	const open = [];
	const payments = transactions
		.filter((t) => !t.deleted && t.privateMistake)
		.sort((a, b) => (String(a.bookedOn) < String(b.bookedOn) ? 1 : -1));
	for (const tx of payments) {
		if (counted.has(String(tx.id))) continue;
		const s = privateSettlement(tx, transactions);
		for (const p of s.payments) counted.add(String(p.id));
		if (s.openCents > 0) open.push({ tx, openCents: s.openCents });
	}
	return open;
}

/** @param {MatchingStore} store @param {string} action @param {Record<string, any>} fields */
const decided = (store, action, fields) =>
	recordEvent(store.events, 'decision', { action, ...fields });

/**
 * "Privat (Irrläufer)": this one payment is private. Its receipt matches and a
 * "Kein Beleg nötig" go; the note stays with it.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 * @param {string} note
 */
export async function markPrivate(store, transactionId, note) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	for (const m of await store.matches.list({ where: (m) => m.transactionId === transactionId })) {
		if (isActive(m)) await store.matches.put({ ...m, state: 'rejected' });
	}
	await store.transactions.put({
		...tx,
		noReceipt: null,
		privateMistake: {
			note:
				String(note ?? '')
					.trim()
					.slice(0, 2000) || privateNote(tx),
			at: new Date().toISOString(),
			settledBy: ids(tx.privateMistake?.settledBy)
		}
	});
	await syncLinks(store);
	await decided(store, 'private-mark', { transactionId });
}

/**
 * "Doch geschäftlich": a normal booking again; its repayments let go of it.
 *
 * @param {MatchingStore} store
 * @param {string} transactionId
 */
export async function unmarkPrivate(store, transactionId) {
	const tx = await store.transactions.get(transactionId);
	if (!tx) throw new Error(`No transaction ${transactionId}`);
	for (const id of ids(tx.privateMistake?.settledBy)) await dropRepayment(store, id, transactionId);
	await store.transactions.put({ ...tx, privateMistake: null });
	await syncLinks(store);
	await decided(store, 'private-unmark', { transactionId });
}

/**
 * "Rückzahlung verknüpfen": an incoming booking pays a private payment back.
 *
 * @param {MatchingStore} store
 * @param {string} paymentId
 * @param {string} repaymentId
 */
export async function linkRepayment(store, paymentId, repaymentId) {
	if (paymentId === repaymentId) return;
	const payment = await store.transactions.get(paymentId);
	const repayment = await store.transactions.get(repaymentId);
	if (!payment?.privateMistake || !repayment) throw new Error('No private payment or repayment');
	await store.transactions.put({
		...payment,
		privateMistake: {
			...payment.privateMistake,
			settledBy: [...new Set([...ids(payment.privateMistake.settledBy), repaymentId])]
		}
	});
	await store.transactions.put({
		...repayment,
		noReceipt: null,
		privateRepaymentOf: [...new Set([...ids(repayment.privateRepaymentOf), paymentId])]
	});
	await syncLinks(store);
	await decided(store, 'private-repayment-link', {
		transactionId: paymentId,
		counterBookingId: repaymentId
	});
}

/**
 * The repayment no longer settles this payment.
 *
 * @param {MatchingStore} store
 * @param {string} paymentId
 * @param {string} repaymentId
 */
export async function unlinkRepayment(store, paymentId, repaymentId) {
	const payment = await store.transactions.get(paymentId);
	if (payment?.privateMistake) {
		await store.transactions.put({
			...payment,
			privateMistake: {
				...payment.privateMistake,
				settledBy: ids(payment.privateMistake.settledBy).filter((id) => id !== repaymentId)
			}
		});
	}
	await dropRepayment(store, repaymentId, paymentId);
	await syncLinks(store);
	await decided(store, 'private-repayment-unlink', {
		transactionId: paymentId,
		counterBookingId: repaymentId
	});
}

/** @param {MatchingStore} store @param {string} repaymentId @param {string} paymentId */
async function dropRepayment(store, repaymentId, paymentId) {
	const r = await store.transactions.get(repaymentId);
	if (!r) return;
	const left = ids(r.privateRepaymentOf).filter((id) => id !== paymentId);
	await store.transactions.put({ ...r, privateRepaymentOf: left.length ? left : null });
}

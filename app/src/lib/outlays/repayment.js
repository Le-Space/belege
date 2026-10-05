// Paying outlays back (issue #293, step 4): the business transfers money to
// the person who laid it out, and that payout clears outlays – one payout
// several outlays, several payouts one outlay, as an invoice paid in
// instalments (#258) the other way round. What counts is the sum over
// everything linked together; within it, the oldest outlays are cleared first.
//
// Kept on the bookings themselves, which an import leaves alone:
//   an outlay:  `outlay.repaidBy: [payout ids]`
//   a payout:   `outlayRepaymentOf: [outlay ids]`
//
// A payout needs no receipt: the outlays' receipts document it. It is booked
// against the private account of the legal form, by the money's way, as a
// private repayment is (booking/suggest.js, matching/private-kind.js): the
// shareholder clearing account of a UG/GmbH, a withdrawal (1800) for a sole
// proprietor whose outlays were deposits (1890).

import { recordEvent } from '../activity/events.js';
import { isActive, syncLinks } from '../matching/engine.js';
import { privateKind } from '../matching/private-kind.js';
import { isOutlay } from './outlays.js';

/** @typedef {Record<string, any>} Rec */

/** @param {unknown} v @returns {string[]} */
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);

/** What a booking owes or pays, in cents: an outflow counts positive. @param {Rec} t */
const owed = (t) => -Number(t.amountCents ?? 0);

const byDay = (/** @type {Rec} */ a, /** @type {Rec} */ b) =>
	String(a.bookedOn ?? '').localeCompare(String(b.bookedOn ?? '')) ||
	String(a.id).localeCompare(String(b.id));

/**
 * How far the outlays linked together with a booking are paid back.
 *
 * @param {Rec} tx an outlay or a payout
 * @param {Rec[]} transactions
 * @returns {{ owedCents: number, repaidCents: number, openCents: number, outlays: Rec[], payouts: Rec[], openOf: Map<string, number> }}
 *   `openOf`: what is still open of each outlay, the oldest cleared first
 */
export function outlaySettlement(tx, transactions) {
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
		for (const o of [...ids(t.outlay?.repaidBy), ...ids(t.outlayRepaymentOf)]) {
			if (!seen.has(o)) queue.push(o);
		}
	}
	const group = /** @type {Rec[]} */ ([...seen].map((id) => byId.get(id)).filter(Boolean));
	const outlays = group.filter((t) => isOutlay(t) && t.outlay).sort(byDay);
	const payouts = group.filter((t) => ids(t.outlayRepaymentOf).length).sort(byDay);
	const owedCents = outlays.reduce((n, t) => n + owed(t), 0);
	const repaidCents = payouts.reduce((n, t) => n + owed(t), 0);
	/** @type {Map<string, number>} */
	const openOf = new Map();
	let left = repaidCents;
	for (const o of outlays) {
		const take = Math.max(0, Math.min(owed(o), left));
		left -= take;
		openOf.set(String(o.id), owed(o) - take);
	}
	return {
		owedCents,
		repaidCents,
		openCents: Math.max(0, owedCents - repaidCents),
		outlays,
		payouts,
		openOf
	};
}

/**
 * The outlays not paid back yet, oldest first, with what is open of each.
 *
 * @param {Rec[]} transactions
 * @returns {{ tx: Rec, openCents: number }[]}
 */
export function openOutlays(transactions) {
	/** @type {Map<string, number>} */
	const open = new Map();
	const outlays = transactions.filter((t) => !t.deleted && isOutlay(t) && t.outlay).sort(byDay);
	for (const o of outlays) {
		if (open.has(String(o.id))) continue;
		for (const [id, cents] of outlaySettlement(o, transactions).openOf) open.set(id, cents);
	}
	return outlays
		.map((tx) => ({ tx, openCents: open.get(String(tx.id)) ?? 0 }))
		.filter((o) => o.openCents > 0);
}

/**
 * Whether a booking may be a payout of outlays: money out of an account
 * Belege reads, in euros, not yet covered otherwise.
 *
 * @param {Rec} tx
 * @param {Rec[]} matches
 * @param {Rec | null | undefined} classification
 */
export function mayRepayOutlays(tx, matches, classification) {
	return (
		!tx.deleted &&
		!isOutlay(tx) &&
		Number(tx.amountCents ?? 0) < 0 &&
		String(tx.currency ?? 'EUR') === 'EUR' &&
		!tx.noReceipt &&
		!privateKind(tx) &&
		!classification &&
		!matches.some((m) => m.transactionId === tx.id && isActive(m))
	);
}

/**
 * The open outlays a payout most likely clears: the ones whose open amounts
 * add up to it exactly, the oldest preferred; else the oldest until it is
 * used up.
 *
 * @param {number} payoutCents without sign
 * @param {{ tx: Rec, openCents: number }[]} open oldest first
 * @returns {string[]} outlay ids
 */
export function suggestOutlays(payoutCents, open) {
	// Exact sums over the oldest 24 – enough for a trip's receipts.
	const pool = open.slice(0, 24);
	/** @type {Map<number, number[]>} sum → indices, first found = oldest */
	const reach = new Map([[0, []]]);
	for (let i = 0; i < pool.length; i++) {
		for (const [sum, picked] of [...reach]) {
			const next = sum + pool[i].openCents;
			if (next <= payoutCents && !reach.has(next)) reach.set(next, [...picked, i]);
		}
		const hit = reach.get(payoutCents);
		if (hit) return hit.map((j) => String(pool[j].tx.id));
	}
	/** @type {string[]} */
	const picked = [];
	let left = payoutCents;
	for (const o of open) {
		if (left <= 0) break;
		picked.push(String(o.tx.id));
		left -= o.openCents;
	}
	return picked;
}

/** @param {any} store @param {string} action @param {Record<string, any>} fields */
const decided = (store, action, fields) =>
	recordEvent(store.events, 'decision', { action, ...fields });

/**
 * "Erstattet Auslagen": this payout pays these outlays back.
 *
 * @param {any} store transactions, matches, questions, receipts, events
 * @param {string} payoutId
 * @param {string[]} outlayIds
 */
export async function linkOutlayRepayment(store, payoutId, outlayIds) {
	const payout = await store.transactions.get(payoutId);
	if (!payout || isOutlay(payout)) throw new Error('No payout');
	const chosen = [];
	for (const id of outlayIds) {
		const o = await store.transactions.get(id);
		if (!o || o.deleted || !isOutlay(o) || !o.outlay) throw new Error(`No outlay ${id}`);
		chosen.push(o);
	}
	if (!chosen.length) return;
	for (const o of chosen) {
		await store.transactions.put({
			...o,
			outlay: { ...o.outlay, repaidBy: [...new Set([...ids(o.outlay.repaidBy), payoutId])] }
		});
	}
	await store.transactions.put({
		...payout,
		noReceipt: null,
		outlayRepaymentOf: [
			...new Set([...ids(payout.outlayRepaymentOf), ...chosen.map((o) => String(o.id))])
		]
	});
	await syncLinks(store);
	await decided(store, 'outlay-repayment-link', {
		transactionId: payoutId,
		outlayIds: chosen.map((o) => String(o.id))
	});
}

/**
 * The payout no longer pays this outlay back.
 *
 * @param {any} store
 * @param {string} payoutId
 * @param {string} outlayId
 */
export async function unlinkOutlayRepayment(store, payoutId, outlayId) {
	const o = await store.transactions.get(outlayId);
	if (o?.outlay) {
		await store.transactions.put({
			...o,
			outlay: { ...o.outlay, repaidBy: ids(o.outlay.repaidBy).filter((id) => id !== payoutId) }
		});
	}
	const payout = await store.transactions.get(payoutId);
	if (payout) {
		const left = ids(payout.outlayRepaymentOf).filter((id) => id !== outlayId);
		await store.transactions.put({ ...payout, outlayRepaymentOf: left.length ? left : null });
	}
	await syncLinks(store);
	await decided(store, 'outlay-repayment-unlink', { transactionId: payoutId, outlayId });
}

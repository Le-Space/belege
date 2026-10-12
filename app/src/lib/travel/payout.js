// The payout of travel statements (issue #213, step 7): the bank transfer
// to the traveller, linked to the statement's PDF – its receipt – as any
// payment is linked to its receipt. One payout may pay several statements,
// several payouts one statement (in parts), as with outlays (#293) and an
// invoice paid in instalments (#258).
//
// What is paid comes from the links alone: the bank payments (not the
// statement's own bookings, source `travel`) linked to a statement's receipt.
// A correction takes over what was paid on the statement it replaces: a
// chain of statements owes what its newest says. A payout linked to several
// chains pays the oldest first.
//
// Booked against the clearing account the statement was booked on, by the
// money's way (booking/suggest.js): the shareholder clearing account of a
// UG/GmbH, a withdrawal (1800) for a sole proprietor or partner.

import { recordEvent } from '../activity/events.js';
import { confirmMatch } from '../matching/actions.js';
import { isActive, syncLinks } from '../matching/engine.js';
import { isOutlay } from '../outlays/outlays.js';

/** @typedef {Record<string, any>} Rec */

/** A travel statement's PDF, kept as a receipt (statement-actions.js). @param {Rec | null | undefined} r */
export const isStatementReceipt = (r) => r?.selfReceipt?.kind === 'travel-statement';

/**
 * The closed statements as chains: each newest one (not replaced) with the
 * ones it replaces, oldest month first.
 *
 * @param {Rec[]} travel
 * @returns {{ head: Rec, members: Rec[] }[]}
 */
export function statementChains(travel) {
	const closed = travel.filter((r) => r.kind === 'statement' && r.state === 'closed' && !r.deleted);
	const byId = new Map(closed.map((s) => [String(s.id), s]));
	const replaced = new Set(closed.map((s) => String(s.corrects ?? '')).filter(Boolean));
	return closed
		.filter((s) => !replaced.has(String(s.id)))
		.map((head) => {
			const members = [head];
			for (let s = head; s.corrects && byId.has(String(s.corrects)); ) {
				s = /** @type {Rec} */ (byId.get(String(s.corrects)));
				members.push(s);
			}
			return { head, members };
		})
		.sort(
			(a, b) =>
				String(a.head.month).localeCompare(String(b.head.month)) ||
				String(a.head.closedAt).localeCompare(String(b.head.closedAt))
		);
}

/**
 * @typedef {object} Settlement
 * @property {Rec} head the newest statement of the chain
 * @property {number} owedCents what it says is to be paid back
 * @property {number} paidCents what the payouts linked to the chain pay of it
 * @property {number} openCents
 * @property {{ tx: Rec, cents: number }[]} payouts
 */

/**
 * How far each chain of statements is paid out.
 *
 * @param {{ travel: Rec[], matches: Rec[], transactions: Rec[] }} books
 * @returns {Settlement[]} oldest month first
 */
export function statementSettlements({ travel, matches, transactions }) {
	const chains = statementChains(travel);
	/** @type {Map<string, number>} a statement's receipt → its chain */
	const chainOf = new Map();
	chains.forEach((c, i) => {
		for (const s of c.members) if (s.receiptId) chainOf.set(String(s.receiptId), i);
	});
	const txById = new Map(transactions.filter((t) => !t.deleted).map((t) => [String(t.id), t]));
	/** @type {Map<string, Set<number>>} payout → the chains it is linked to */
	const linked = new Map();
	for (const m of matches) {
		if (!isActive(m)) continue;
		const chain = chainOf.get(String(m.receiptId));
		const tx = txById.get(String(m.transactionId));
		if (chain === undefined || !tx || tx.source === 'travel' || Number(tx.amountCents) >= 0)
			continue;
		const set = linked.get(String(tx.id)) ?? new Set();
		set.add(chain);
		linked.set(String(tx.id), set);
	}
	/** @type {Settlement[]} */
	const out = chains.map((c) => ({
		head: c.head,
		owedCents: Number(c.head.toPayBackCents ?? 0),
		paidCents: 0,
		openCents: 0,
		payouts: []
	}));
	// Each payout pays its chains, the oldest first; what is left goes on the newest.
	const payouts = [...linked.entries()]
		.map(([id, set]) => ({
			tx: /** @type {Rec} */ (txById.get(id)),
			chains: [...set].sort((a, b) => a - b)
		}))
		.sort(
			(a, b) =>
				String(a.tx.bookedOn).localeCompare(String(b.tx.bookedOn)) ||
				String(a.tx.id).localeCompare(String(b.tx.id))
		);
	for (const p of payouts) {
		let left = -Number(p.tx.amountCents);
		p.chains.forEach((i, n) => {
			const s = out[i];
			const take =
				n === p.chains.length - 1 ? left : Math.max(0, Math.min(left, s.owedCents - s.paidCents));
			if (take <= 0) return;
			s.paidCents += take;
			s.payouts.push({ tx: p.tx, cents: take });
			left -= take;
		});
	}
	for (const s of out) s.openCents = s.owedCents - s.paidCents;
	return out;
}

/**
 * Whether a booking may be a payout of travel statements: money out of an
 * account Belege reads, in euros, not covered otherwise.
 *
 * @param {Rec} tx
 * @param {Rec[]} matches
 * @param {Rec | null | undefined} classification
 */
export function mayPayOut(tx, matches, classification) {
	return (
		!tx.deleted &&
		!isOutlay(tx) &&
		tx.source !== 'travel' &&
		Number(tx.amountCents ?? 0) < 0 &&
		String(tx.currency ?? 'EUR') === 'EUR' &&
		!tx.noReceipt &&
		!classification &&
		!matches.some((m) => m.transactionId === tx.id && isActive(m))
	);
}

/**
 * The open statements a payout most likely pays: those whose number the
 * purpose names; else those whose open amounts add up to it exactly, the
 * oldest preferred; else the oldest until it is used up.
 *
 * @param {Rec} tx
 * @param {Settlement[]} open oldest first, open > 0
 * @returns {string[]} the heads' ids
 */
export function suggestStatements(tx, open) {
	const text = `${tx.purpose ?? ''} ${tx.counterpartyName ?? tx.counterparty ?? ''}`;
	const named = open.filter((s) => s.head.number && text.includes(String(s.head.number)));
	if (named.length) return named.map((s) => String(s.head.id));
	const cents = Math.abs(Number(tx.amountCents ?? 0));
	const pool = open.slice(0, 24);
	/** @type {Map<number, number[]>} */
	const reach = new Map([[0, []]]);
	for (let i = 0; i < pool.length; i++) {
		for (const [sum, picked] of [...reach]) {
			const next = sum + pool[i].openCents;
			if (next <= cents && !reach.has(next)) reach.set(next, [...picked, i]);
		}
		const hit = reach.get(cents);
		if (hit) return hit.map((j) => String(pool[j].head.id));
	}
	/** @type {string[]} */
	const picked = [];
	let left = cents;
	for (const s of open) {
		if (left <= 0) break;
		picked.push(String(s.head.id));
		left -= s.openCents;
	}
	return picked;
}

/**
 * "Zahlt Reisekosten aus": this payout pays these statements – linked to
 * their receipts, alongside their own bookings.
 *
 * @param {any} store transactions, matches, receipts, travel, questions, events
 * @param {string} payoutId
 * @param {string[]} statementIds the chains' heads
 */
export async function linkPayout(store, payoutId, statementIds) {
	const payout = await store.transactions.get(payoutId);
	if (!payout || payout.deleted || payout.source === 'travel' || Number(payout.amountCents) >= 0)
		throw new Error('No payout');
	/** @type {Rec[]} */
	const chosen = [];
	for (const id of statementIds) {
		const s = await store.travel.get(id);
		if (!s || s.deleted || s.kind !== 'statement' || s.state !== 'closed' || !s.receiptId)
			throw new Error(`No closed statement ${id}`);
		chosen.push(s);
	}
	if (!chosen.length) return;
	if (payout.noReceipt) await store.transactions.put({ ...payout, noReceipt: null });
	for (const s of chosen) {
		await confirmMatch(store, {
			receiptId: String(s.receiptId),
			transactionId: payoutId,
			reasons: ['manual', 'travel-payout'],
			// The statement's receipt carries its own bookings, and maybe other payouts.
			alongside: true
		});
	}
	await syncLinks(store);
	await recordEvent(store.events, 'decision', {
		action: 'travel-payout-link',
		transactionId: payoutId,
		numbers: chosen.map((s) => String(s.number))
	});
}

/**
 * The payout no longer pays this statement's chain.
 *
 * @param {any} store
 * @param {string} payoutId
 * @param {Rec[]} members the chain's statements
 */
export async function unlinkPayout(store, payoutId, members) {
	const receipts = new Set(members.map((s) => String(s.receiptId)));
	for (const m of await store.matches.list()) {
		if (m.transactionId === payoutId && receipts.has(String(m.receiptId)) && isActive(m))
			await store.matches.put({ ...m, state: 'rejected' });
	}
	await syncLinks(store);
	await recordEvent(store.events, 'decision', {
		action: 'travel-payout-unlink',
		transactionId: payoutId
	});
}

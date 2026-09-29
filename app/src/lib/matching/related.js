// Bookings that belong together, so a person can go from one to the other:
// the two sides of an own transfer (on two bank accounts, an exchange and a
// wallet, two wallets on a chain), the two legs of a trade, and a fee and the
// booking it was charged on. Pure; one index over all bookings, so the list
// can mark every row without searching the books once per row.
//
// Found by
//   - the classification: an own transfer's counter-booking (classify.js,
//     by counter-booking, reference or hash, or over a bridge), and a
//     charge's refund (refunds.js);
//   - a shared reference (context.js txRefsOf): the exchange's refid shared
//     by a trade's legs and their fees, a transaction hash shared by a wallet
//     booking and its fee, and by an exchange deposit or withdrawal
//     (`chainTxRef`) and the wallet on the other side.

import { txRefsOf } from './context.js';

/** A wallet's transaction hash is long hex; an exchange's refid is short and mixed. */
const HASH = /^(0x)?[0-9a-f]{40,}$/i;

/**
 * @typedef {'transfer' | 'trade' | 'migration' | 'fee' | 'fee-of' | 'refund'} RelationKind
 *   `fee`: the other booking is this one's fee; `fee-of`: this one is the other's fee
 * @typedef {'counter-booking' | 'reference' | 'own-address' | 'bridge' | 'cross-chain' | 'manual' | 'hash' | 'refid'} RelationVia
 * @typedef {{ kind: RelationKind, via: RelationVia, other: Record<string, any> }} Relation
 */

/**
 * @param {Record<string, any>[]} transactions
 * @param {Record<string, { kind: string, via?: string, counterBookingId?: string }>} [classifications] by booking id
 * @returns {Map<string, Relation[]>} booking id → what belongs with it, each other booking once
 */
export function relatedIndex(transactions, classifications = {}) {
	const live = transactions.filter((t) => !t.deleted);
	const byId = new Map(live.map((t) => [String(t.id), t]));
	/** @type {Map<string, Record<string, any>[]>} */
	const byRef = new Map();
	for (const t of live) {
		for (const ref of txRefsOf(t)) byRef.set(ref, [...(byRef.get(ref) ?? []), t]);
	}

	/** @type {Map<string, Relation[]>} */
	const index = new Map();
	/** @param {Record<string, any>} a @param {Relation} rel */
	const add = (a, rel) => {
		const list = index.get(String(a.id)) ?? [];
		if (list.some((r) => r.other.id === rel.other.id)) return;
		list.push(rel);
		index.set(String(a.id), list);
	};
	/** @param {RelationKind} kind */
	const mirror = (kind) => (kind === 'fee' ? 'fee-of' : kind === 'fee-of' ? 'fee' : kind);

	for (const t of live) {
		const c = classifications[String(t.id)];
		const other = c?.counterBookingId ? byId.get(String(c.counterBookingId)) : undefined;
		if (other && other.id !== t.id) {
			// "By reference" that is a shared transaction hash says so.
			const shared = txRefsOf(t).find((r) => txRefsOf(other).includes(r));
			const via = /** @type {RelationVia} */ (
				c?.via === 'reference'
					? shared && HASH.test(shared)
						? 'hash'
						: 'reference'
					: c?.via === 'own-address' ||
						  c?.via === 'bridge' ||
						  c?.via === 'cross-chain' ||
						  c?.via === 'manual'
						? c.via
						: 'counter-booking'
			);
			// A charge and its refund (refunds.js) are no transfer; nor is a swap across chains (#170).
			const kind =
				c?.kind === 'refund'
					? 'refund'
					: c?.kind === 'crypto-swap'
						? 'trade'
						: c?.kind === 'token-migration'
							? 'migration'
							: 'transfer';
			add(t, { kind, via, other });
			add(other, { kind, via, other: t });
		}

		for (const ref of txRefsOf(t)) {
			for (const o of byRef.get(ref) ?? []) {
				if (o.id === t.id) continue;
				/** @type {RelationKind | null} */
				let kind = null;
				// A fee belongs to a booking of its own source: a wallet's gas to the wallet's
				// booking, not to the exchange deposit that shares the on-chain hash.
				const sameSource = o.source === t.source;
				if (t.movement === 'fee' && o.movement !== 'fee') kind = sameSource ? 'fee-of' : null;
				else if (o.movement === 'fee' && t.movement !== 'fee') kind = sameSource ? 'fee' : null;
				else if (o.accountId !== t.accountId) {
					const opposite =
						Math.sign(Number(o.amountCents ?? 0)) === -Math.sign(Number(t.amountCents ?? 0));
					if (t.movement === 'trade' && o.movement === 'trade' && opposite) kind = 'trade';
					else if (opposite && t.movement !== 'trade' && o.movement !== 'trade') kind = 'transfer';
				}
				if (!kind) continue;
				const via = /** @type {RelationVia} */ (HASH.test(ref) ? 'hash' : 'refid');
				add(t, { kind, via, other: o });
				add(o, { kind: mirror(kind), via, other: t });
			}
		}
	}
	return index;
}

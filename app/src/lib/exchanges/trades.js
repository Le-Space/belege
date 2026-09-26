// The other side of an exchange trade: the two legs of one trade are two
// bookings on two accounts that share the exchange's reference (`txRef`,
// kraken-sync.js). Pure; the list and the detail say on each leg what it
// was traded for.

import { formatMoney } from '../bank/format.js';
import { quantityText } from '../assets/valuation.js';

/**
 * Each trade leg's other leg, by booking id: same source and reference,
 * another account, the other direction. A leg with none, or more than one,
 * gets none.
 *
 * @param {Record<string, any>[]} transactions
 * @returns {Map<string, Record<string, any>>}
 */
export function tradeSides(transactions) {
	/** @type {Map<string, Record<string, any>[]>} */
	const byRef = new Map();
	for (const tx of transactions) {
		if (tx.deleted || tx.movement !== 'trade' || !tx.txRef) continue;
		const key = `${tx.source}|${tx.txRef}`;
		byRef.set(key, [...(byRef.get(key) ?? []), tx]);
	}
	/** @type {Map<string, Record<string, any>>} */
	const sides = new Map();
	for (const legs of byRef.values()) {
		for (const tx of legs) {
			const others = legs.filter(
				(o) =>
					o.id !== tx.id &&
					o.accountId !== tx.accountId &&
					Math.sign(Number(o.amountCents)) !== Math.sign(Number(tx.amountCents))
			);
			if (others.length === 1) sides.set(String(tx.id), others[0]);
		}
	}
	return sides;
}

/**
 * What the other leg is, without a sign: `128 USDC`, or `110,40 EUR` for euros.
 *
 * @param {Record<string, any>} other
 */
export function tradeSideWhat(other) {
	const q = quantityText(other);
	if (q) return q.replace(/^[-−]\s*/, '');
	return formatMoney(Math.abs(Number(other.amountCents ?? 0)), other.currency ?? 'EUR');
}

/**
 * `→` when this leg gave something away (it went into the other), `←` when
 * it came in (out of the other).
 *
 * @param {Record<string, any>} tx
 */
export const tradeArrow = (tx) => (Number(tx.amountCents ?? 0) < 0 ? '→' : '←');

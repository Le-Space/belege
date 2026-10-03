// One invoice, paid in instalments (issue #258). A receipt can carry several
// payments until they add up to it: each instalment is covered by the same
// invoice, and the invoice says what is still open. Pure.
//
// What is paid is derived from the active links, never stored: unlinking one
// instalment reopens exactly its part. Payments the other way than the
// receipt's direction (a refund) are not counted as paid.

/** @typedef {Record<string, any>} Rec */

/** A link that counts (engine.js `isActive`, kept here so the scorer can use this file). @param {Rec} m */
const isActive = (m) => !m.deleted && (m.state === 'auto' || m.state === 'confirmed');

/**
 * Words a bank purpose uses for a part of an invoice: an instalment, a down
 * payment, the rest.
 */
export const INSTALMENT_WORDS =
	/\b(teilzahlung|teilbetrag|ratenzahlung|rate|anzahlung|abschlag(?:szahlung)?|restzahlung|restbetrag|instal?lment|partial payment|down payment|remaining amount)\b/i;

/** A receipt's amount in cents, without sign, or null when it has none. @param {Rec} r */
export function receiptTotal(r) {
	const x = r?.extraction ?? {};
	const cents =
		typeof r?.amountCents === 'number'
			? r.amountCents
			: typeof x.gross === 'number' && Number.isFinite(x.gross)
				? Math.round(x.gross * 100)
				: null;
	return cents === null || cents === 0 ? null : Math.abs(cents);
}

/**
 * @typedef {object} Settlement
 * @property {number | null} totalCents the receipt's amount; null when it has none
 * @property {number} paidCents what the linked payments add up to
 * @property {number} openCents what is still open (0 when paid or over-paid, or without a total)
 * @property {number} overCents what was paid beyond the total
 * @property {'open' | 'partial' | 'paid' | 'overpaid'} state
 * @property {Rec[]} payments the linked payments, oldest first
 */

/**
 * What a receipt's linked payments settle of it.
 *
 * @param {Rec} receipt
 * @param {Rec[]} matches
 * @param {Rec[] | Map<string, Rec>} transactions
 * @returns {Settlement}
 */
export function settlement(receipt, matches, transactions) {
	const byId =
		transactions instanceof Map ? transactions : new Map(transactions.map((t) => [t.id, t]));
	const payments = matches
		.filter((m) => m.receiptId === receipt?.id && isActive(m))
		.map((m) => byId.get(m.transactionId))
		.filter(/** @returns {t is Rec} */ (t) => Boolean(t) && !t?.deleted)
		.sort((a, b) => String(a.bookedOn).localeCompare(String(b.bookedOn)) || (a.id < b.id ? -1 : 1));
	// The way the money goes: the first payment's (the invoice's own direction).
	const sign = Math.sign(Number(payments[0]?.amountCents ?? 0));
	const paidCents = payments
		.filter((t) => Math.sign(Number(t.amountCents ?? 0)) === sign)
		.reduce((n, t) => n + Math.abs(Number(t.amountCents ?? 0)), 0);
	const totalCents = receiptTotal(receipt);
	if (totalCents === null) {
		return {
			totalCents,
			paidCents,
			openCents: 0,
			overCents: 0,
			state: payments.length ? 'paid' : 'open',
			payments
		};
	}
	const openCents = Math.max(0, totalCents - paidCents);
	const overCents = Math.max(0, paidCents - totalCents);
	return {
		totalCents,
		paidCents,
		openCents,
		overCents,
		state: !paidCents ? 'open' : overCents ? 'overpaid' : openCents ? 'partial' : 'paid',
		payments
	};
}

/**
 * Which instalment a payment is of its receipt: `{ index, count }`, 1-based,
 * or null when the receipt has only this payment and nothing is open.
 *
 * @param {Settlement} s
 * @param {string} transactionId
 */
export function instalmentOf(s, transactionId) {
	const index = s.payments.findIndex((t) => t.id === transactionId);
	if (index < 0) return null;
	if (s.payments.length === 1 && s.state !== 'partial') return null;
	return { index: index + 1, count: s.payments.length };
}

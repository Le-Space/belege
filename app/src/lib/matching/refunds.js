// A charge and its refund (issue #119): a card payment made by mistake and
// the money back weeks later are, together, nothing to document. Pure; fixed
// rules, no AI.
//
// Paired automatically when
//   - the signs are opposite, on any account (the same card included);
//   - the refund comes 0–120 days after the charge;
//   - the refund names the charge's counterparty (its name or purpose holds
//     the charge's counterparty key), or both keys are equal;
//   - the refund says it is one (Rückerstattung, Gutschrift, Storno, Refund,
//     …): equal amounts alone are no sign – two own accounts under the same
//     name move equal amounts too, and those are transfers;
//   - the refund is not more than the charge;
//   - each side has only the other – two equal charges and one refund are a
//     question, not a guess.
// A person's links (`refundPairs`) come first; `notRefunds` keeps a pair apart.
//
// A full refund covers both: neither needs a receipt. A partial one covers
// the refund only; the charge still needs its receipt.

import { dayNumber } from './normalize.js';
import { counterpartyKey } from './partners.js';

/** @typedef {Record<string, any>} Rec */

export const REFUND_DAYS = 120;
const REFUND_WORDS =
	/\b(r[üu]ckerstattung|erstattung|gutschrift|storno|stornierung|r[üu]ckbuchung|r[üu]ckzahlung|refund|chargeback|reversal)\b/i;

/** The same pair either way round. @param {string} a @param {string} b */
export const refundPairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** @param {Rec} t */
const key = (t) => counterpartyKey(t.counterparty);

/**
 * Whether a refund names a charge's counterparty.
 *
 * @param {Rec} charge
 * @param {Rec} refund
 */
function namesIt(charge, refund) {
	const k = key(charge);
	if (k.length < 3) return false;
	if (key(refund) === k) return true;
	const text = counterpartyKey(`${refund.counterparty ?? ''} ${refund.purpose ?? ''}`);
	return ` ${text} `.includes(` ${k} `);
}

/**
 * @param {Rec[]} transactions
 * @param {{ refundPairs?: string[], notRefunds?: string[] }} [settings]
 * @returns {{ refundOf: (tx: Rec) => { other: Rec, role: 'charge' | 'refund', full: boolean, manual: boolean } | null }}
 */
export function refundIndex(transactions, { refundPairs = [], notRefunds = [] } = {}) {
	const live = transactions.filter(
		(t) => !t.deleted && Number(t.amountCents ?? 0) !== 0 && t.movement !== 'fee'
	);
	const byId = new Map(live.map((t) => [String(t.id), t]));
	const apart = new Set(notRefunds);

	/** @type {Map<string, { other: string, manual: boolean }>} */
	const pairOf = new Map();
	for (const k of refundPairs) {
		const [a, b] = k.split('|');
		if (!byId.has(a) || !byId.has(b) || pairOf.has(a) || pairOf.has(b)) continue;
		pairOf.set(a, { other: b, manual: true });
		pairOf.set(b, { other: a, manual: true });
	}

	const charges = live.filter((t) => Number(t.amountCents) < 0 && !pairOf.has(String(t.id)));
	const refunds = live.filter((t) => Number(t.amountCents) > 0 && !pairOf.has(String(t.id)));
	/** @param {Rec} charge @param {Rec} refund */
	const fits = (charge, refund) => {
		if (apart.has(refundPairKey(String(charge.id), String(refund.id)))) return false;
		if ((charge.currency ?? 'EUR') !== (refund.currency ?? 'EUR')) return false;
		const dc = dayNumber(charge.bookedOn);
		const dr = dayNumber(refund.bookedOn);
		if (dc === null || dr === null || dr < dc || dr - dc > REFUND_DAYS) return false;
		const out = -Number(charge.amountCents);
		const back = Number(refund.amountCents);
		if (back > out) return false;
		if (!namesIt(charge, refund)) return false;
		return REFUND_WORDS.test(`${refund.counterparty ?? ''} ${refund.purpose ?? ''}`);
	};
	/** @type {Map<string, Rec[]>} */
	const refundsFor = new Map();
	/** @type {Map<string, Rec[]>} */
	const chargesFor = new Map();
	// Refunds by the words of their name and purpose, so a charge looks only
	// at those that could name it, not at every booking.
	/** @type {Map<string, Rec[]>} */
	const byWord = new Map();
	for (const r of refunds) {
		const words = new Set(counterpartyKey(`${r.counterparty ?? ''} ${r.purpose ?? ''}`).split(' '));
		for (const w of words) if (w.length >= 3) byWord.set(w, [...(byWord.get(w) ?? []), r]);
	}
	for (const c of charges) {
		const first = key(c)
			.split(' ')
			.find((w) => w.length >= 3);
		for (const r of first ? (byWord.get(first) ?? []) : []) {
			if (!fits(c, r)) continue;
			refundsFor.set(String(c.id), [...(refundsFor.get(String(c.id)) ?? []), r]);
			chargesFor.set(String(r.id), [...(chargesFor.get(String(r.id)) ?? []), c]);
		}
	}
	for (const [cid, rs] of refundsFor) {
		if (rs.length !== 1) continue;
		const rid = String(rs[0].id);
		if ((chargesFor.get(rid) ?? []).length !== 1) continue;
		pairOf.set(cid, { other: rid, manual: false });
		pairOf.set(rid, { other: cid, manual: false });
	}

	return {
		refundOf(tx) {
			const p = pairOf.get(String(tx.id));
			const other = p ? byId.get(p.other) : undefined;
			if (!p || !other) return null;
			const role = Number(tx.amountCents) < 0 ? 'charge' : 'refund';
			const [charge, refund] = role === 'charge' ? [tx, other] : [other, tx];
			return {
				other,
				role,
				full: Number(refund.amountCents) === -Number(charge.amountCents),
				manual: p.manual
			};
		}
	};
}

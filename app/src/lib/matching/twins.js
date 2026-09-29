// Twin own transfers (issue #176): two debits of the same amount on one own
// account, two credits of it on another, within days. Each debit has two
// candidates, and "a question, not a guess" used to leave all four unlinked.
// Twins are told apart by what the person wrote: the same purpose on both
// sides, then the smaller date gap – and a pair counts only when each side
// picks the other.

/** @typedef {Record<string, any>} Rec */

/** A purpose for comparing: lower case, words only. @param {unknown} s */
export const purposeKey = (s) =>
	String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** @param {Rec} a @param {Rec} b */
const dayGap = (a, b) => {
	const x = Date.parse(`${a.bookedOn ?? ''}T00:00:00Z`);
	const y = Date.parse(`${b.bookedOn ?? ''}T00:00:00Z`);
	return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86_400_000 : Infinity;
};

/**
 * The one candidate that is this booking's other side: the only one, the only
 * one with the same purpose, or the one clearly nearest in time; null when
 * two are equally good.
 *
 * @param {Rec} tx
 * @param {Rec[]} candidates
 * @returns {Rec | null}
 */
export function pickTwin(tx, candidates) {
	if (candidates.length <= 1) return candidates[0] ?? null;
	const key = purposeKey(tx.purpose);
	const same = key ? candidates.filter((o) => purposeKey(o.purpose) === key) : [];
	if (same.length === 1) return same[0];
	const pool = same.length ? same : candidates;
	const byGap = [...pool].sort((a, b) => dayGap(tx, a) - dayGap(tx, b));
	return dayGap(tx, byGap[0]) < dayGap(tx, byGap[1]) ? byGap[0] : null;
}

/**
 * Pick on both sides: `tx`'s pick, when that one picks `tx` back.
 *
 * @param {Rec} tx
 * @param {Rec[]} candidates tx's candidates
 * @param {(o: Rec) => Rec[]} candidatesOf the other side's candidates
 * @returns {Rec | null}
 */
export function mutualTwin(tx, candidates, candidatesOf) {
	const o = pickTwin(tx, candidates);
	if (!o) return null;
	return pickTwin(o, candidatesOf(o))?.id === tx.id ? o : null;
}

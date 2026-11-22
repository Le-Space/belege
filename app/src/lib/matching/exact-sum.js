// Which open amounts one payment most likely pays (#539): the ones that add up
// to it exactly, the oldest preferred; else the oldest until it is used up.
// Shared by travel payouts (travel/payout.js) and outlay repayments
// (outlays/repayment.js). Pure; amounts in cents.
//
// The search is bounded twice: only the oldest `pool` amounts take part, and
// at most `maxSums` distinct partial sums are kept. Past either bound there
// is no exact match, and the oldest-first fallback answers.

/** The oldest amounts that take part in the exact search: enough for a trip's receipts. */
export const EXACT_SUM_POOL = 24;
/** The most distinct partial sums kept while searching. */
export const EXACT_SUM_MAX_SUMS = 4096;

/**
 * @param {number} target without sign
 * @param {number[]} amounts oldest first, each > 0
 * @param {{ pool?: number, maxSums?: number }} [limits]
 * @returns {number[]} the indices picked, oldest first
 */
export function pickBySum(
	target,
	amounts,
	{ pool = EXACT_SUM_POOL, maxSums = EXACT_SUM_MAX_SUMS } = {}
) {
	const exact = exactSum(target, amounts.slice(0, pool), maxSums);
	if (exact) return exact;
	/** @type {number[]} */
	const picked = [];
	let left = target;
	for (let i = 0; i < amounts.length && left > 0; i++) {
		picked.push(i);
		left -= amounts[i];
	}
	return picked;
}

/**
 * The first subset found that adds up to `target`, items taken oldest first;
 * null when there is none, or when the search would keep more than `maxSums`.
 *
 * @param {number} target
 * @param {number[]} amounts
 * @param {number} maxSums
 * @returns {number[] | null}
 */
function exactSum(target, amounts, maxSums) {
	if (target <= 0) return null;
	/** @type {Map<number, { item: number, from: number } | null>} sum → how it was first reached */
	const reach = new Map([[0, null]]);
	for (let i = 0; i < amounts.length; i++) {
		for (const sum of [...reach.keys()]) {
			const next = sum + amounts[i];
			if (next > target || reach.has(next)) continue;
			if (reach.size >= maxSums) return null;
			reach.set(next, { item: i, from: sum });
		}
		if (reach.has(target)) {
			/** @type {number[]} */
			const picked = [];
			for (let step = reach.get(target); step; step = reach.get(step.from) ?? null)
				picked.unshift(step.item);
			return picked;
		}
	}
	return null;
}

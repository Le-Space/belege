// "Wie zugeordnet?": for the receipts overview, how each receipt was linked
// to its booking – by the matching on its own (with its points, perhaps on a
// learned vendor), confirmed by a person, or linked by hand – and whether a
// KI step found it (#31). The matching itself stays deterministic; the KI
// marker is about how the receipt was found. Pure, from the match record and
// the receipt.

/** @typedef {Record<string, any>} Rec */

/** @typedef {'auto' | 'auto-learned' | 'confirmed' | 'manual'} MatchOrigin */
/** @typedef {'auto' | 'confirmed' | 'manual' | 'ai' | 'open'} OriginFilter */

/** The filters of the overview, in this order. */
export const ORIGIN_FILTERS = /** @type {const} */ (['auto', 'confirmed', 'manual', 'ai', 'open']);

/**
 * @param {Rec | null | undefined} match the receipt's active match (view.js `matchOfReceipt`)
 * @returns {{ kind: MatchOrigin, score: number | null } | null}
 */
export function matchOrigin(match) {
	if (!match) return null;
	const reasons = Array.isArray(match.reasons) ? match.reasons : [];
	const score = typeof match.score === 'number' ? match.score : null;
	if (match.state === 'auto') {
		return { kind: reasons.includes('vendor-learned') ? 'auto-learned' : 'auto', score };
	}
	return { kind: reasons.includes('manual') ? 'manual' : 'confirmed', score };
}

/**
 * The KI search that found this receipt, when one did (receipts/import.js `foundBy`).
 *
 * @param {Rec} receipt
 * @returns {{ confidence: string | null, reason: string | null, model: string | null } | null}
 */
export function foundByAi(receipt) {
	const f = receipt?.foundBy;
	if (!f || f.kind !== 'mail-assist') return null;
	return {
		confidence: typeof f.confidence === 'string' ? f.confidence : null,
		reason: typeof f.reason === 'string' ? f.reason : null,
		model: typeof f.model === 'string' ? f.model : null
	};
}

/**
 * Whether a receipt belongs under a filter. "open": read or new, linked to
 * nothing and not set aside.
 *
 * @param {Rec} receipt
 * @param {Rec | null | undefined} match
 * @param {OriginFilter} filter
 */
export function inOrigin(receipt, match, filter) {
	const o = matchOrigin(match);
	switch (filter) {
		case 'auto':
			return o?.kind === 'auto' || o?.kind === 'auto-learned';
		case 'confirmed':
			return o?.kind === 'confirmed';
		case 'manual':
			return o?.kind === 'manual';
		case 'ai':
			return foundByAi(receipt) !== null;
		case 'open':
			return !o && receipt.status !== 'ignoriert';
		default:
			return true;
	}
}

/**
 * Counts per filter. auto + confirmed + manual + open + set aside = all;
 * "ai" counts across them.
 *
 * @param {Rec[]} receipts
 * @param {(id: string) => Rec | null | undefined} matchOf
 * @returns {Record<OriginFilter, number> & { ignored: number }}
 */
export function originCounts(receipts, matchOf) {
	const counts = { auto: 0, confirmed: 0, manual: 0, ai: 0, open: 0, ignored: 0 };
	for (const r of receipts) {
		const m = matchOf(r.id);
		for (const f of ORIGIN_FILTERS) if (inOrigin(r, m, f)) counts[f]++;
		if (!matchOrigin(m) && r.status === 'ignoriert') counts.ignored++;
	}
	return counts;
}

// A hospitality meal (Bewirtung, issue #213, step 1): what the law asks for
// before it counts, and the split of its costs. Pure; cents.
//
// The net costs and the tip are split into a deductible share (70 %) and the
// rest; the input VAT counts in full. A meal without a trip belongs to the
// month's statement all the same (decided 12.10.).

import { HOSPITALITY, rateOn } from './rates.js';

/**
 * @typedef {object} Hospitality
 * @property {string} date YYYY-MM-DD
 * @property {number} grossCents the restaurant bill, tip not included
 * @property {number} vatCents its VAT, all rates
 * @property {number} [tipCents] a tip without a receipt of its own
 * @property {string} [tipTo] who received the tip
 * @property {string} [place]
 * @property {string[]} [participants] the host included
 * @property {string} [occasion]
 */

/**
 * @param {Hospitality} h
 * @returns {{
 *   netCents: number,
 *   deductibleCents: number,
 *   nonDeductibleCents: number,
 *   inputVatCents: number,
 *   share: { from: string, deductible: number, source: string } | null,
 *   missing: ('place' | 'participants' | 'occasion' | 'tipTo')[]
 * }}
 */
export function hospitality(h) {
	const tip = Math.max(0, h.tipCents ?? 0);
	const netCents = h.grossCents - h.vatCents + tip;
	const share = rateOn(HOSPITALITY, h.date);
	const deductibleCents = share ? Math.round(netCents * share.deductible) : 0;
	/** @type {('place' | 'participants' | 'occasion' | 'tipTo')[]} */
	const missing = [];
	if (!h.place?.trim()) missing.push('place');
	if (!h.participants?.some((p) => p.trim())) missing.push('participants');
	if (!h.occasion?.trim()) missing.push('occasion');
	if (tip > 0 && !h.tipTo?.trim()) missing.push('tipTo');
	return {
		netCents,
		deductibleCents,
		nonDeductibleCents: netCents - deductibleCents,
		inputVatCents: h.vatCents,
		share: share ? { ...share } : null,
		missing
	};
}

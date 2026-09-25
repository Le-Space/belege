// The Belege page's source list grows by one entry per customer portal that
// has receipts: `portal:<id>`, named after the portal (import.js PORTAL_NAMES).

import { PORTAL_NAMES } from './import.js';

/**
 * The source a receipt is filed under on the Belege page.
 *
 * @param {Record<string, any>} r source, portal
 */
export function receiptSourceKey(r) {
	return r.source === 'portal' ? `portal:${r.portal ?? 'unbekannt'}` : (r.source ?? '');
}

/**
 * One entry per portal that has receipts, in the order of PORTAL_NAMES.
 *
 * @param {Record<string, any>[]} receipts
 * @returns {{ key: string, label: string, count: number }[]}
 */
export function portalSources(receipts) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const r of receipts) {
		if (r.source !== 'portal') continue;
		const key = receiptSourceKey(r);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const order = Object.keys(PORTAL_NAMES);
	return [...counts.entries()]
		.map(([key, count]) => {
			const id = key.slice('portal:'.length);
			return { key, label: PORTAL_NAMES[id] ?? id, count, rank: order.indexOf(id) };
		})
		.sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank))
		.map(({ key, label, count }) => ({ key, label, count }));
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// The euro value of Aleph Cloud credits (Le-Space/belege#113). Credits are
// no market asset with a rate of the day: Aleph sells them for USD. So a
// day's consumption is valued at the per-credit price of the last purchase
// on or before that day, or at Aleph's list price of 1 USD per 1,000,000
// credits when the account never bought any (credits moved in from another
// account) – then converted at that day's ECB reference rate
// (createRateService().rate('USD', day)). A choice for the tax adviser; the
// statement names it.

import { multiply, normalize } from '@le-space/ledger/decimal';

/** Aleph's list price, USD per credit. */
export const ALEPH_LIST_PRICE_USD = '0.000001';

/**
 * The per-credit price in force on each day, from an account's purchases.
 *
 * @param {{ time: string, price: string | number | null | undefined }[]} purchases any order; a
 *   purchase without a price (a transfer in) does not count
 * @returns {(date: string) => { usdPerCredit: string, source: 'purchase' | 'list' }} date YYYY-MM-DD, UTC
 */
export function alephCreditPrice(purchases) {
	const priced = purchases
		.filter((p) => p?.price && Number(p.price) > 0)
		.map((p) => ({ time: String(p.time), price: String(p.price) }))
		.sort((a, b) => (a.time < b.time ? -1 : 1));
	return (date) => {
		let found = null;
		for (const p of priced) if (p.time.slice(0, 10) <= date) found = p.price;
		return found
			? { usdPerCredit: found, source: 'purchase' }
			: { usdPerCredit: ALEPH_LIST_PRICE_USD, source: 'list' };
	};
}

/**
 * Credits → euros: credits × USD per credit × EUR per USD, rounded half away
 * from zero to cents. Exact, no float in between.
 *
 * @param {string | number} credits
 * @param {string} usdPerCredit
 * @param {string} eurPerUsd
 * @returns {string} EUR, two decimals at most
 */
export function alephCreditsInEur(credits, usdPerCredit, eurPerUsd) {
	const usd = multiply(plain(credits), plain(usdPerCredit), 12);
	return multiply(usd, plain(eurPerUsd), 2);
}

/**
 * A number as a plain decimal string (no exponent), at most 12 decimals.
 *
 * @param {string | number} v
 */
export function plain(v) {
	if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return normalize(v);
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
	return normalize(n.toFixed(12));
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// The euro value of Aleph Cloud credits (Le-Space/belege#113). Credits are
// no market asset with a rate of the day: Aleph sells them for USD, at a
// list price of 1 USD per 1,000,000 credits. So a day's consumption is
// valued at what a credit cost in the last purchase on or before that day,
// or at the list price when the account never bought any (credits moved in
// from another account) – then converted at that day's ECB reference rate
// (createRateService().rate('USD', day)). A choice for the tax adviser; the
// statement names it.
//
// What a purchase row of Aleph's credit history says (checked 2026-11-21
// against Aleph's node software, pyaleph – migration 0040, "rename
// credit_history ratio to price" – and against a paying transaction on
// Ethereum):
//
//   amount        the credits that came in, a bonus included
//   bonus_amount  the credits given on top (20 % of the credits paid for,
//                 when the payment was in ALEPH)
//   price         units of the PAYMENT TOKEN per credit paid for – not US
//                 dollars. For a purchase in a dollar token it is the dollar
//                 price; for one in ALEPH it is ALEPH per credit, a number
//                 some sixty to a hundred times the list price.
//   token         the payment token
//
// So:  credits paid for = amount − bonus_amount
//      tokens paid      = credits paid for × price
//      dollars paid     = tokens paid, for a dollar token;
//                         credits paid for × the list price otherwise
//                         (Aleph sells at the list price and takes the token
//                         at its rate; the token's own euro value on that day
//                         is the booking of the wallet that paid)
//      dollars a credit = dollars paid / amount  (the bonus makes it cheaper)
//
// Until 0.3.1 `price` was taken for dollars per credit, which valued a
// purchase in ALEPH, and every day's consumption after it, many times too high.

import { multiply, normalize } from '@le-space/ledger/decimal';

/** Aleph's list price, USD per credit. */
export const ALEPH_LIST_PRICE_USD = '0.000001';

/** Tokens whose unit is a US dollar: their `price` is a dollar price. */
const DOLLAR_TOKENS = new Set(['USD', 'USDC', 'USDT', 'DAI']);
/** A dollar price further than this factor from the list price is not believed. */
const PLAUSIBLE = 5;

/**
 * What a purchase row means in dollars (see the top of this file).
 *
 * @param {object} p
 * @param {number | string} p.credits the row's `amount`: credits that came in, the bonus included
 * @param {number | string | null} [p.bonus] the row's `bonus_amount`
 * @param {number | string | null} [p.price] the row's `price`: payment token per credit paid for
 * @param {string | null} [p.token]
 * @returns {{
 *   paidCredits: string,
 *   tokenAmount: string | null,
 *   token: string | null,
 *   usd: string,
 *   usdPerCredit: string,
 *   basis: 'price' | 'list'
 * } | null} null when the row has no credits
 */
export function alephPurchase({ credits, bonus = 0, price = null, token = null }) {
	const all = Math.trunc(Number(credits));
	if (!Number.isFinite(all) || all <= 0) return null;
	const extra = Math.trunc(Number(bonus ?? 0));
	const paid = Number.isFinite(extra) && extra > 0 && extra < all ? all - extra : all;
	const unit = price !== null && price !== undefined && Number(price) > 0 ? plain(price) : null;
	const name = token ? String(token) : null;
	// To four decimals: the price has more digits than the payment had.
	const tokenAmount = unit ? normalize(multiply(String(paid), unit, 4)) : null;
	// A dollar price only from a dollar token (or an unnamed one), and only near the list price.
	const ratio = unit ? Number(unit) / Number(ALEPH_LIST_PRICE_USD) : NaN;
	const dollars =
		(name === null || DOLLAR_TOKENS.has(name.toUpperCase())) &&
		ratio >= 1 / PLAUSIBLE &&
		ratio <= PLAUSIBLE;
	const usd =
		dollars && tokenAmount
			? tokenAmount
			: normalize(multiply(String(paid), ALEPH_LIST_PRICE_USD, 8));
	return {
		paidCredits: String(paid),
		tokenAmount,
		token: name,
		usd,
		usdPerCredit: plain(Number(usd) / all),
		basis: dollars ? 'price' : 'list'
	};
}

/**
 * The dollar price of a credit in force on each day, from an account's purchases.
 *
 * @param {{ time: string, usdPerCredit?: string | null, credits?: number | string, bonus?: number | string | null, price?: string | number | null, token?: string | null }[]} purchases
 *   any order; each with its `usdPerCredit`, or the row's fields to work it out (alephPurchase).
 *   A row without a price (a transfer in) does not count.
 * @returns {(date: string) => { usdPerCredit: string, source: 'purchase' | 'list' }} date YYYY-MM-DD, UTC
 */
export function alephCreditPrice(purchases) {
	const priced = purchases
		.map((p) => {
			const usdPerCredit =
				p?.usdPerCredit ??
				(p?.price && Number(p.price) > 0 && p.credits !== undefined
					? alephPurchase({
							credits: p.credits,
							bonus: p.bonus,
							price: p.price,
							token: p.token
						})?.usdPerCredit
					: null);
			return usdPerCredit && Number(usdPerCredit) > 0
				? { time: String(p.time), price: String(usdPerCredit) }
				: null;
		})
		.filter((p) => p !== null)
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

// SPDX-License-Identifier: AGPL-3.0-or-later
// Balances before and after a period, for a Kontoauszug.

import { sum } from './decimal.js';

/** @param {string} amount */
const negate = (amount) => (amount.startsWith('-') ? amount.slice(1) : `-${amount}`);

/**
 * Balances before and after a period, derived from today's balances less every
 * movement since: for chains whose nodes keep no old balances.
 *
 * @param {import('./index.js').LedgerEntry[]} all every entry up to now
 * @param {{ asset: string, amount: string }[]} current balances now
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 */
export function derivedStatement(all, current, from, to) {
	/** @type {Record<string, string>} */
	const opening = {};
	/** @type {Record<string, string>} */
	const closing = {};
	for (const b of current) {
		const own = all.filter((e) => e.asset === b.asset && e.success !== false);
		opening[b.asset] = sum([
			b.amount,
			...own.filter((e) => e.date >= from).map((e) => negate(e.amount))
		]);
		closing[b.asset] = sum([
			b.amount,
			...own.filter((e) => e.date > to).map((e) => negate(e.amount))
		]);
	}
	return {
		entries: all.filter((e) => e.date >= from && e.date <= to),
		opening,
		closing,
		method: /** @type {'derived'} */ ('derived'),
		at: null
	};
}

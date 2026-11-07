// SPDX-License-Identifier: AGPL-3.0-or-later
// Every entry with its euro value on the day it was made. Where the rate
// comes from is the caller's (the pipeline asks @le-space/rates); this file
// only applies it, and names a fixed rate for tests and offline demos.
//
// Aleph Cloud credits have no rate of the day: they are valued at the USD
// price per credit the reader hands with each entry (`unitPrice`: the last
// purchase on or before the day, else Aleph's list price) at that day's ECB
// rate for USD (@le-space/rates/aleph-credits).

import { multiply } from '@le-space/ledger';

/**
 * @typedef {object} Rate
 * @property {string} rate EUR per unit, decimal string
 * @property {string} source human-readable: where and which moment, printed on the document
 * @property {string} date YYYY-MM-DD the rate is for
 */

/** @typedef {{ rateFor: (asset: string, date: string) => Promise<Rate | null> }} Rates */

/**
 * @typedef {import('@le-space/ledger').LedgerEntry & { eur: { value: string, rate: string, source: string } | null }} ValuedEntry
 */

/**
 * Every entry with its euro value (8 decimals; printed with 4, the total rounded to cents
 * where it is printed). An entry without a price gets `eur: null`. One with a
 * `unitPrice` in USD (Aleph credits) is valued at that price and the day's rate for USD.
 *
 * @param {import('@le-space/ledger').LedgerEntry[]} entries
 * @param {Rates} rates
 * @returns {Promise<ValuedEntry[]>}
 */
export async function valueEntries(entries, rates) {
	const out = [];
	for (const e of entries) {
		const unit = /** @type {{ currency?: string, amount?: string, source?: string } | undefined} */ (/** @type {any} */ (e).unitPrice);
		if (!e.priceAs && e.success && unit?.currency === 'USD' && unit.amount) {
			const usd = await rates.rateFor('USD', e.date);
			const how = unit.source === 'purchase' ? 'Kaufpreis' : 'Listenpreis';
			out.push({
				...e,
				eur: usd
					? { value: multiply(multiply(e.amount, unit.amount, 12), usd.rate, 8), rate: multiply(unit.amount, usd.rate, 14), source: `Aleph ${how} ${unit.amount} USD je Credit × ${usd.source}` }
					: null
			});
			continue;
		}
		const r = e.priceAs && e.success ? await rates.rateFor(e.priceAs, e.date) : null;
		out.push({ ...e, eur: r ? { value: multiply(e.amount, r.rate, 8), rate: r.rate, source: r.source } : null });
	}
	return out;
}

/** Fixed rates, for tests and offline demos. @param {Record<string, string>} table `NEAR:2026-10-05` → `3.8796` @returns {Rates} */
export function fixedRates(table) {
	return {
		async rateFor(asset, date) {
			const rate = table[`${asset}:${date}`] ?? table[asset];
			return rate ? { rate, source: `fester Testkurs (${asset})`, date } : null;
		}
	};
}

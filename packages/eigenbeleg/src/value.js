// SPDX-License-Identifier: AGPL-3.0-or-later
// Every entry with its value on the day it was made: in euro, or in the
// document's currency when another is asked for (`currency`; the rates handed
// in are then in that currency, and say so). Where the rate
// comes from is the caller's (the pipeline asks @le-space/rates); this file
// only applies it, and names a fixed rate for tests and offline demos.
//
// Aleph Cloud credits have no rate of the day: they are valued at the USD
// price per credit the reader hands with each entry (`unitPrice`: the last
// purchase on or before the day, else Aleph's list price) at that day's ECB
// rate for USD (@le-space/rates/aleph-credits).

import { multiply } from '@le-space/ledger';

import { documentCurrency } from './document.js';

/**
 * @typedef {object} Rate
 * @property {string} rate EUR per unit (or the document currency's), decimal string
 * @property {string} source human-readable: where and which moment, printed on the document
 * @property {string} date YYYY-MM-DD the rate is for
 * @property {string} [currency] what the rate is in; EUR when not given
 */

/** @typedef {{ rateFor: (asset: string, date: string) => Promise<Rate | null> }} Rates */

/**
 * @typedef {import('@le-space/ledger').LedgerEntry & { eur: { value: string, rate: string, source: string, currency?: string } | null }} ValuedEntry
 *   `eur`: the value, named so since every document was in euro; in another
 *   currency it carries that `currency`
 */

/**
 * Every entry with its euro value (8 decimals; printed with 4, the total rounded to cents
 * where it is printed). An entry without a price gets `eur: null`. One with a
 * `unitPrice` in USD (Aleph credits) is valued at that price and the day's rate for USD.
 *
 * @param {import('@le-space/ledger').LedgerEntry[]} entries
 * @param {Rates} rates in the document's currency
 * @param {{ currency?: string }} [o] the document's currency (DOCUMENT_CURRENCIES), EUR when not given
 * @returns {Promise<ValuedEntry[]>}
 */
export async function valueEntries(entries, rates, { currency: asked } = {}) {
	const currency = documentCurrency(asked);
	// An EUR value stays as it always was; another currency is named on it.
	const mark = currency === 'EUR' ? {} : { currency };
	/** A rate in another currency than the document's is the caller's mistake, not a value. @param {string} asset @param {string} date */
	const rateFor = async (asset, date) => {
		const r = await rates.rateFor(asset, date);
		if (r && (r.currency ?? 'EUR') !== currency)
			throw new Error(`a rate in ${r.currency ?? 'EUR'} for a document in ${currency}`);
		return r;
	};
	const out = [];
	for (const e of entries) {
		const unit =
			/** @type {{ currency?: string, amount?: string, source?: string } | undefined} */ (
				/** @type {any} */ (e).unitPrice
			);
		if (!e.priceAs && e.success && unit?.currency === 'USD' && unit.amount) {
			const how = unit.source === 'purchase' ? 'Kaufpreis' : 'Listenpreis';
			// A document in USD: Aleph's own price, no rate at all.
			if (currency === 'USD') {
				out.push({
					...e,
					eur: {
						value: multiply(e.amount, unit.amount, 8),
						rate: unit.amount,
						source: `Aleph ${how} ${unit.amount} USD je Credit`,
						...mark
					}
				});
				continue;
			}
			const usd = await rateFor('USD', e.date);
			out.push({
				...e,
				eur: usd
					? {
							value: multiply(multiply(e.amount, unit.amount, 12), usd.rate, 8),
							rate: multiply(unit.amount, usd.rate, 14),
							source: `Aleph ${how} ${unit.amount} USD je Credit × ${usd.source}`,
							...mark
						}
					: null
			});
			continue;
		}
		const r = e.priceAs && e.success ? await rateFor(e.priceAs, e.date) : null;
		out.push({
			...e,
			eur: r
				? { value: multiply(e.amount, r.rate, 8), rate: r.rate, source: r.source, ...mark }
				: null
		});
	}
	return out;
}

/**
 * Fixed rates, for tests and offline demos.
 *
 * @param {Record<string, string>} table `NEAR:2026-10-05` → `3.8796`
 * @param {string} [currency] what the table's rates are in; EUR when not given
 * @returns {Rates}
 */
export function fixedRates(table, currency) {
	const mark = currency && currency !== 'EUR' ? { currency } : {};
	return {
		async rateFor(asset, date) {
			const rate = table[`${asset}:${date}`] ?? table[asset];
			return rate ? { rate, source: `fester Testkurs (${asset})`, date, ...mark } : null;
		}
	};
}

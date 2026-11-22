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
//
// A token not in the chain's list (EVM, `listed: false`, #93) has no market
// asset either: it is valued only when the caller hands in `tokenRateFor`,
// asked by its contract, chain, block and decimals. Its symbol is the token's
// own claim and is never asked for as a market asset.

import { multiply } from '@le-space/ledger';

import { documentCurrency } from './document.js';

/**
 * @typedef {object} Rate
 * @property {string} rate EUR per unit (or the document currency's), decimal string
 * @property {string} source human-readable: where and which moment, printed on the document
 * @property {string} date YYYY-MM-DD the rate is for
 * @property {string} [currency] what the rate is in; EUR when not given
 */

/**
 * @typedef {object} TokenRef a token not in the chain's list, by its contract (#93)
 * @property {string} asset the symbol it calls itself, its own claim
 * @property {string} contract 0x + 40 hex, lower case
 * @property {string} chain e.g. `ethereum`, `base`
 * @property {number} block the booking's block, for a DEX pool's price at it
 * @property {number} decimals
 */

/**
 * @typedef {object} Rates
 * @property {(asset: string, date: string) => Promise<Rate | null>} rateFor a listed asset
 * @property {(token: TokenRef, date: string) => Promise<Rate | null>} [tokenRateFor] a token
 *   not in the list, by its contract (@le-space/rates: CoinGecko by contract, else a DEX
 *   pool at the block); without it such a token stays unvalued
 */

/**
 * @typedef {import('@le-space/ledger').LedgerEntry & { eur: { value: string, rate: string, source: string, currency?: string } | null }} ValuedEntry
 *   `eur`: the value, named so since every document was in euro; in another
 *   currency it carries that `currency`
 */

/**
 * A token not in the chain's list (#115, #93): booked by its contract, no market asset.
 * @param {import('@le-space/ledger').LedgerEntry} e
 */
const isToken = (e) =>
	e.listed === false && /^0x[0-9a-fA-F]{40}$/.test(e.contract) && Number.isSafeInteger(e.height);

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
	/** @param {Rate | null} r */
	const checked = (r) => {
		if (r && (r.currency ?? 'EUR') !== currency)
			throw new Error(`a rate in ${r.currency ?? 'EUR'} for a document in ${currency}`);
		return r;
	};
	const rateFor = async (/** @type {string} */ asset, /** @type {string} */ date) =>
		checked(await rates.rateFor(asset, date));
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
		const r = !e.success
			? null
			: e.priceAs
				? await rateFor(e.priceAs, e.date)
				: isToken(e) && rates.tokenRateFor
					? await checked(
							await rates.tokenRateFor(
								{
									asset: e.asset,
									contract: e.contract.toLowerCase(),
									chain: e.chain,
									block: e.height,
									decimals: e.decimals
								},
								e.date
							)
						)
					: null;
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
 * @param {Record<string, string>} table `NEAR:2026-10-05` → `3.8796`; a token not in the list by
 *   its contract (lower case): `0x…:2026-10-05` or `0x…`
 * @param {string} [currency] what the table's rates are in; EUR when not given
 * @returns {Rates}
 */
export function fixedRates(table, currency) {
	const mark = currency && currency !== 'EUR' ? { currency } : {};
	return {
		async rateFor(asset, date) {
			const rate = table[`${asset}:${date}`] ?? table[asset];
			return rate ? { rate, source: `fester Testkurs (${asset})`, date, ...mark } : null;
		},
		async tokenRateFor({ contract }, date) {
			const rate = table[`${contract}:${date}`] ?? table[contract];
			return rate
				? { rate, source: `fester Testkurs (Token-Vertrag ${contract})`, date, ...mark }
				: null;
		}
	};
}

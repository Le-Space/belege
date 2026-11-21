// SPDX-License-Identifier: AGPL-3.0-or-later
// A reference value for an asset nobody quotes (issue #885). DOI, Doichain's
// coin, is not listed on an exchange, and price feeds that still show a figure
// for it must not be used. So its euro value of a day comes from a dated table
// set by hand: "from day X: N EUR per DOI". The value of a day is the last
// line on or before it; a day before the first line has none, and the entry
// stays unvalued.
//
// This is no rate of the day and does not pretend to be: the source names it
// a reference value, who set it and since when, and that it is no exchange
// rate. Whether that carries in the books is for the tax adviser; the
// document says what was done. A business with its own figure (what it paid
// for its DOI, say) hands in its own table and is named as the one who set it.
//
// No table ships with this package: who values DOI, and at what, is the
// caller's to say.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * @typedef {object} ReferenceLine
 * @property {string} from YYYY-MM-DD, the first day the value holds
 * @property {string} eur EUR per unit, a decimal string
 * @property {string} [by] who set it, as printed: `Le Space UG`
 */

/**
 * @typedef {object} Rate what a document's valuation takes (@le-space/eigenbeleg `valueEntries`)
 * @property {string} rate EUR per unit, decimal string
 * @property {string} source printed on the document
 * @property {string} date YYYY-MM-DD the rate is for
 */

/**
 * The reference value in force on each day.
 *
 * @param {ReferenceLine[]} table any order
 * @returns {(date: string) => Rate | null} date YYYY-MM-DD, UTC
 */
export function referenceRate(table) {
	const lines = table.map((line) => {
		if (!DAY.test(String(line?.from)) || Number.isNaN(Date.parse(`${line.from}T00:00:00Z`)))
			throw new Error('a reference value needs the day it holds from, YYYY-MM-DD');
		if (typeof line.eur !== 'string' || !DECIMAL.test(line.eur) || !(Number(line.eur) > 0))
			throw new Error('a reference value is a positive decimal string');
		return { from: line.from, eur: line.eur, by: String(line.by ?? '').trim() };
	});
	lines.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	return (date) => {
		let found = null;
		for (const line of lines) if (line.from <= date) found = line;
		if (!found) return null;
		return {
			rate: found.eur,
			source: `Referenzwert ${found.by ? `von ${found.by}` : 'des Ausstellers'}, Stand ${found.from} (kein Börsenkurs)`,
			date
		};
	};
}

/**
 * A rate source in which the listed assets are valued by their tables and by
 * nothing else: an asset with a table never reaches `inner`, also on a day its
 * table has no line for. Everything else is `inner`'s.
 *
 * @param {{ rateFor: (asset: string, date: string) => Promise<Rate | null> }} inner
 * @param {Record<string, ReferenceLine[]>} tables by asset symbol: `{ DOI: [...] }`
 * @returns {{ rateFor: (asset: string, date: string) => Promise<Rate | null> }}
 */
export function withReferenceRates(inner, tables) {
	const byAsset = new Map(
		Object.entries(tables).map(([asset, table]) => [asset, referenceRate(table)])
	);
	return {
		async rateFor(asset, date) {
			const reference = byAsset.get(asset);
			return reference ? reference(date) : inner.rateFor(asset, date);
		}
	};
}

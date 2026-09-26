// A crypto movement becomes a booking in euros.
//
// Belege books in EUR cents, as the bank accounts do: `amountCents` is what
// the movement was worth on its day. Next to it the transaction keeps what
// actually moved and how the euro amount came about, so the booking can be
// checked (GoBD) and recomputed:
//
//   asset      the symbol (registry.js)
//   quantity   integer of the smallest unit, signed, as a string (quantity.js)
//   decimals   the asset's decimals, kept so the record explains itself
//   valuation  { rate, currency: 'EUR', source, at }: EUR per whole unit,
//              from which source, for which moment (bridge/src/rates.js)

import { assetOf } from './registry.js';
import { formatQuantity, valueCents } from './quantity.js';

/**
 * @typedef {object} Rate what the bridge answers for GET /rates
 * @property {string} asset
 * @property {string} date YYYY-MM-DD
 * @property {'EUR'} currency
 * @property {string} rate EUR per whole unit, a decimal string
 * @property {string | null} usdRate USD per whole unit, when the source has it
 * @property {'coingecko' | 'kraken' | 'ecb' | 'manual'} source
 * @property {string} at the moment the rate is for, ISO 8601
 */

/**
 * @typedef {object} Valuation
 * @property {string} rate
 * @property {'EUR'} currency
 * @property {Rate['source']} source
 * @property {string} at
 */

/** How a source is named to people. */
export const SOURCE_NAMES = Object.freeze({
	coingecko: 'CoinGecko',
	kraken: 'Kraken',
	ecb: 'EZB-Referenzkurs',
	manual: 'von Hand eingetragen'
});

/**
 * The transaction fields for a movement of `units` of `asset`, valued at `rate`.
 *
 * @param {{ asset: string, units: string, rate: Pick<Rate, 'rate' | 'source' | 'at'> }} params
 */
export function valuedFields({ asset, units, rate }) {
	const known = assetOf(asset);
	if (!known) throw new Error(`Unknown asset: ${asset}`);
	return {
		amountCents: valueCents(units, known.decimals, rate.rate),
		currency: 'EUR',
		asset: known.symbol,
		quantity: String(units),
		decimals: known.decimals,
		/** @type {Valuation} */
		valuation: { rate: rate.rate, currency: 'EUR', source: rate.source, at: rate.at }
	};
}

/**
 * Value a movement with the rate of its day.
 *
 * @param {{ asset: string, units: string, date: string }} movement
 * @param {(asset: string, date: string) => Promise<Rate>} getRate usually the bridge client's `rate`
 */
export async function valueMovement({ asset, units, date }, getRate) {
	const known = assetOf(asset);
	if (!known) throw new Error(`Unknown asset: ${asset}`);
	return valuedFields({ asset: known.symbol, units, rate: await getRate(known.symbol, date) });
}

/** @param {Record<string, any>} tx */
export function hasQuantity(tx) {
	return typeof tx?.quantity === 'string' && Boolean(tx.asset);
}

/**
 * `0,015 BTC`, or '' for a transaction without a crypto quantity.
 *
 * @param {Record<string, any>} tx
 */
export function quantityText(tx) {
	if (!hasQuantity(tx)) return '';
	const decimals = Number.isInteger(tx.decimals) ? tx.decimals : assetOf(tx.asset)?.decimals;
	if (!Number.isInteger(decimals)) return '';
	return formatQuantity(tx.quantity, /** @type {number} */ (decimals), tx.asset);
}

/** `60123.4` → `60.123,40` (at least two decimals, every further significant one). @param {string} rate */
export function formatRate(rate) {
	const [int, frac = ''] = String(rate).split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${grouped},${frac.replace(/0+$/, '').padEnd(2, '0')}`;
}

/**
 * `60.123,40 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`, or ''.
 *
 * @param {Record<string, any>} tx
 */
export function valuationText(tx) {
	const v = tx?.valuation;
	if (!hasQuantity(tx) || !v?.rate) return '';
	const source = /** @type {Record<string, string>} */ (SOURCE_NAMES)[v.source] ?? v.source;
	const at = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v.at ?? ''));
	const when = at ? `${at[3]}.${at[2]}.${at[1]} ${at[4]}:${at[5]} UTC` : '';
	return `${formatRate(v.rate)} EUR je ${tx.asset} · ${source}${when ? `, ${when}` : ''}`;
}

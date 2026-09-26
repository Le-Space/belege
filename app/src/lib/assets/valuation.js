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
 * @property {'coingecko' | 'kraken' | 'ecb' | 'trade' | 'manual'} source
 *   `trade`: the price of the trade itself (what was paid for the asset)
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
	trade: 'Preis des Handels',
	manual: 'von Hand eingetragen'
});

/**
 * The transaction fields for a movement of `units` of `asset`, valued at `rate`.
 * `decimals` defaults to the asset's (registry.js); an exchange that keeps
 * more digits (Kraken: 10 for BTC) passes its own, and may then also name an
 * asset Belege does not list.
 *
 * @param {{ asset: string, units: string, rate: Pick<Rate, 'rate' | 'source' | 'at'>, decimals?: number }} params
 */
export function valuedFields({ asset, units, rate, decimals }) {
	const known = assetOf(asset);
	const digits = decimals ?? known?.decimals;
	if (!Number.isInteger(digits) || !/^[A-Z0-9]{2,10}$/i.test(asset)) {
		throw new Error(`Unknown asset: ${asset}`);
	}
	return {
		amountCents: valueCents(units, /** @type {number} */ (digits), rate.rate),
		currency: 'EUR',
		asset: known?.symbol ?? asset.toUpperCase(),
		quantity: String(units),
		decimals: /** @type {number} */ (digits),
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

/**
 * EUR per whole unit when `cents` bought or sold `units`: the price of a
 * trade, as a decimal string with up to 12 decimals.
 *
 * @param {number} cents
 * @param {string} units
 * @param {number} decimals
 */
export function tradeRate(cents, units, decimals) {
	const q = BigInt(units) < 0n ? -BigInt(units) : BigInt(units);
	if (q === 0n) throw new Error('A trade of nothing has no price.');
	const c = BigInt(Math.abs(cents));
	const digits = 12n;
	// cents / 100 / (q / 10^decimals), with 12 decimals, rounded half up
	const scaled = (c * 10n ** BigInt(decimals) * 10n ** digits * 10n) / (100n * q);
	const rounded = (scaled + 5n) / 10n;
	const s = rounded.toString().padStart(Number(digits) + 1, '0');
	const out = `${s.slice(0, -Number(digits))}.${s.slice(-Number(digits))}`;
	return out.replace(/0+$/, '').replace(/\.$/, '');
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

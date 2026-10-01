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

import { intlLocale, t } from '../i18n/index.js';
import { formatDate } from '../bank/format.js';
import { assetOf } from './registry.js';
import { formatQuantity, groupDigits, separators, valueCents } from './quantity.js';

/**
 * @typedef {object} Rate what the bridge answers for GET /rates
 * @property {string} asset
 * @property {string} date YYYY-MM-DD
 * @property {'EUR'} currency
 * @property {string} rate EUR per whole unit, a decimal string
 * @property {string | null} usdRate USD per whole unit, when the source has it
 * @property {'coingecko' | 'kraken' | 'ecb' | 'trade' | 'dex' | 'migration' | 'manual'} source
 *   `trade`: the price of the trade itself (what was paid for the asset);
 *   `dex`: a DEX pool's price at the booking's block (#163);
 *   `migration`: a replacement token, worth the holding burned for it (#162)
 * @property {string} at the moment the rate is for, ISO 8601
 * @property {string} [ref] `dex`: `uniswap-v2:<pool>@<block>` (V4: the pool id)
 */

/**
 * @typedef {object} Valuation
 * @property {string} rate
 * @property {'EUR'} currency
 * @property {Rate['source']} source
 * @property {string} at
 * @property {string} [ref] `dex`: the pool and block, `uniswap-v2:<pool>@<block>` (V4: the pool id)
 */

/** How a source is named in German documents (the Eigenbeleg); the app's own words are in the catalogue. */
export const SOURCE_NAMES = Object.freeze({
	coingecko: 'CoinGecko',
	kraken: 'Kraken',
	ecb: 'EZB-Referenzkurs',
	trade: 'Preis des Handels',
	dex: 'DEX-Pool',
	migration: 'Wert der verbrannten alten Token',
	manual: 'von Hand eingetragen'
});

/**
 * The transaction fields for a movement of `units` of `asset`, valued at `rate`.
 * `decimals` defaults to the asset's (registry.js); an exchange that keeps
 * more digits (Kraken: 10 for BTC) passes its own, and may then also name an
 * asset Belege does not list.
 *
 * @param {{ asset: string, units: string, rate: Pick<Rate, 'rate' | 'source' | 'at' | 'ref'>, decimals?: number }} params
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
		valuation: {
			rate: rate.rate,
			currency: 'EUR',
			source: rate.source,
			at: rate.at,
			...(rate.ref ? { ref: rate.ref } : {})
		}
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
 * @param {string} [locale] DOCUMENT_LOCALE for documents
 */
export function quantityText(tx, locale = intlLocale()) {
	if (!hasQuantity(tx)) return '';
	const decimals = Number.isInteger(tx.decimals) ? tx.decimals : assetOf(tx.asset)?.decimals;
	if (!Number.isInteger(decimals)) return '';
	return formatQuantity(tx.quantity, /** @type {number} */ (decimals), tx.asset, { locale });
}

/**
 * `60123.4` → `60.123,40` (German), `60,123.40` (English): at least two
 * decimals, every further significant one.
 *
 * @param {string} rate
 * @param {string} [locale] DOCUMENT_LOCALE for documents
 */
export function formatRate(rate, locale = intlLocale()) {
	const [int, frac = ''] = String(rate).split('.');
	return `${groupDigits(int, locale)}${separators(locale).decimal}${frac.replace(/0+$/, '').padEnd(2, '0')}`;
}

/**
 * The placeholder of the "EUR per unit" field: the rate the booking has, as it
 * is typed – the locale's decimal mark, no grouping (setManualRate reads no
 * thousands separator) – or nothing when it has none. Never a fixed example: one
 * number cannot be right for BTC and for a cent token at once.
 *
 * @param {string | null | undefined} rate
 * @param {string} [locale]
 */
export function rateInputPlaceholder(rate, locale = intlLocale()) {
	if (typeof rate !== 'string' || !/^\d+(\.\d+)?$/.test(rate)) return '';
	return rate.replace('.', separators(locale).decimal);
}

/**
 * ` (Uniswap V2, Pool 0x1234…abcd, Block 123)` from a `dex` rate's ref, or ''.
 *
 * @param {unknown} ref
 */
function poolText(ref) {
	// V2/V3 name a pool contract; V4 a pool id in its one PoolManager.
	const m = /^uniswap-v([234]):(0x[0-9a-f]{40}|0x[0-9a-f]{64})@(\d+)$/.exec(String(ref ?? ''));
	if (m) return ` (Uniswap V${m[1]}, Pool ${m[2].slice(0, 6)}…${m[2].slice(-4)}, Block ${m[3]})`;
	const burn = /^0x[0-9a-f]{64}$/.exec(String(ref ?? ''));
	return burn ? ` (Burn Tx ${burn[0].slice(0, 8)}…${burn[0].slice(-4)})` : '';
}

/**
 * `60.123,40 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`, or ''.
 *
 * @param {Record<string, any>} tx
 */
export function valuationText(tx) {
	const v = tx?.valuation;
	if (!hasQuantity(tx) || !v?.rate) return '';
	const source = Object.hasOwn(SOURCE_NAMES, v.source)
		? t(`assets.sources.${v.source}`)
		: String(v.source ?? '');
	const at = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v.at ?? ''));
	const when = at ? `${formatDate(`${at[1]}-${at[2]}-${at[3]}`)} ${at[4]}:${at[5]} UTC` : '';
	return t('assets.valuationLine', {
		rate: formatRate(v.rate),
		asset: String(tx.asset ?? ''),
		source: `${source}${poolText(v.ref)}`,
		when: when ? `, ${when}` : ''
	});
}

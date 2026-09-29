// Exact amounts of an asset, without floating point.
//
// A quantity is stored as the integer number of the asset's smallest unit, in
// a string: 0.015 BTC with 8 decimals is `"1500000"`, −1 NYM with 6 decimals
// is `"-1000000"`. A string, because 18-decimal tokens overflow a double long
// before they overflow a wallet, and a stored record must survive JSON.
//
// Rates are decimal strings too (`"60123.45"`); valueCents multiplies both as
// integers and rounds once, half away from zero, to whole cents.

import { intlLocale } from '../i18n/index.js';

const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
const UNITS = /^-?\d+$/;

/**
 * A decimal string (`"0.015"`, `"-12"`) → smallest units (`"1500000"`).
 * More fraction digits than the asset has are an error, not rounded away.
 *
 * @param {string} decimal
 * @param {number} decimals
 */
export function toUnits(decimal, decimals) {
	const text = String(decimal).trim();
	if (!DECIMAL.test(text)) throw new Error(`Not a decimal number: ${decimal}`);
	const negative = text.startsWith('-');
	const [int, frac = ''] = text.replace(/^[+-]/, '').split('.');
	if (frac.replace(/0+$/, '').length > decimals) {
		throw new Error(`${decimal} has more than ${decimals} decimals`);
	}
	const units = BigInt(int + frac.padEnd(decimals, '0').slice(0, decimals));
	return (negative && units !== 0n ? -units : units).toString();
}

/**
 * Smallest units → a plain decimal string, without trailing zeros: `"1500000"`, 8 → `"0.015"`.
 *
 * @param {string} units
 * @param {number} decimals
 */
export function fromUnits(units, decimals) {
	if (!UNITS.test(String(units))) throw new Error(`Not an integer of units: ${units}`);
	const value = BigInt(units);
	const negative = value < 0n;
	const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
	const int = digits.slice(0, digits.length - decimals);
	const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
	return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** @type {Map<string, { group: string, decimal: string }>} */
const separatorCache = new Map();

/**
 * The locale's group and decimal separators (`.` and `,` in German, `,` and
 * `.` in English), from Intl – the digits themselves never pass through a
 * double.
 *
 * @param {string} locale
 */
export function separators(locale) {
	let s = separatorCache.get(locale);
	if (!s) {
		const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
		s = {
			group: parts.find((p) => p.type === 'group')?.value ?? '',
			decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.'
		};
		separatorCache.set(locale, s);
	}
	return s;
}

/**
 * Grouped digits: `1234567` → `1.234.567` (German), `1,234,567` (English).
 *
 * @param {string} int
 * @param {string} locale
 */
export function groupDigits(int, locale) {
	return int.replace(/\B(?=(\d{3})+(?!\d))/g, separators(locale).group);
}

/**
 * For people, in the app's language: `0,015 BTC`, `-1.234,5 NYM`, `12,00 EUR`
 * (German), `0.015 BTC` (English). Shows every significant digit (a crypto
 * amount is never rounded for display) and at least `minFraction` of them.
 * Documents pass DOCUMENT_LOCALE.
 *
 * @param {string} units
 * @param {number} decimals
 * @param {string} [symbol]
 * @param {{ minFraction?: number, locale?: string }} [options]
 */
export function formatQuantity(
	units,
	decimals,
	symbol = '',
	{ minFraction = 0, locale = intlLocale() } = {}
) {
	const plain = fromUnits(units, decimals);
	const negative = plain.startsWith('-');
	const [int, frac = ''] = plain.replace(/^-/, '').split('.');
	const fraction = frac.padEnd(Math.min(minFraction, decimals), '0');
	const number = `${negative ? '-' : ''}${groupDigits(int, locale)}${fraction ? `${separators(locale).decimal}${fraction}` : ''}`;
	return symbol ? `${number}\u00a0${symbol}` : number;
}

/**
 * A decimal rate (`"60123.45"`) as an integer and its scale.
 *
 * @param {string} rate
 */
function scaled(rate) {
	const text = String(rate).trim();
	if (!DECIMAL.test(text) || text.startsWith('-')) throw new Error(`Not a rate: ${rate}`);
	const [int, frac = ''] = text.replace(/^\+/, '').split('.');
	return { value: BigInt(int + frac), scale: 10n ** BigInt(frac.length) };
}

/**
 * What a quantity is worth in cents at a rate (EUR per whole unit), rounded
 * once, half away from zero.
 *
 * @param {string} units
 * @param {number} decimals
 * @param {string} rate
 * @returns {number} a safe integer of cents
 */
export function valueCents(units, decimals, rate) {
	if (!UNITS.test(String(units))) throw new Error(`Not an integer of units: ${units}`);
	const { value, scale } = scaled(rate);
	const q = BigInt(units);
	const numerator = q * value * 100n;
	const denominator = scale * 10n ** BigInt(decimals);
	const negative = numerator < 0n;
	const abs = negative ? -numerator : numerator;
	const rounded = (abs * 2n + denominator) / (denominator * 2n);
	const cents = Number(negative ? -rounded : rounded);
	if (!Number.isSafeInteger(cents)) throw new Error('The value does not fit into cents.');
	return cents;
}

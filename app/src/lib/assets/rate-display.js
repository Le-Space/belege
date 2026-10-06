// Rates of weak currencies as people say them (issue #312): "91,57 RUB je
// 1 EUR", not "0,010921 EUR je 1 RUB". The books keep EUR per unit at full
// precision (`original.rate`, `valuation.rate`); only what is shown and typed
// turns round. Exact decimal arithmetic, no floats.

/** Digits kept when a rate is turned round: as many as a bank's EUR-per-unit figure carries. */
const DIGITS = 12;

/** A rate below this (EUR per unit) is shown as units per euro. */
export const WEAK_BELOW = 0.1;

/**
 * Currencies worth well under 10 cents, for a form that has no rate yet to
 * go by. Once a rate is known, it decides (`isWeak`).
 */
export const WEAK_CURRENCIES = new Set([
	'RUB',
	'TRY',
	'KZT',
	'UZS',
	'KGS',
	'AMD',
	'RSD',
	'UAH',
	'JPY',
	'HUF',
	'ISK',
	'CZK',
	'SEK',
	'NOK',
	'INR',
	'IDR',
	'KRW',
	'PHP',
	'THB',
	'VND',
	'MXN',
	'ZAR',
	'ARS',
	'CLP',
	'COP'
]);

/** @param {string} text a decimal, `.` as the mark */
function scaled(text) {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
	if (!m) return null;
	const frac = m[2] ?? '';
	return { value: BigInt(m[1] + frac), scale: frac.length };
}

/**
 * 1 / rate as a plain decimal with up to `digits` places after the mark,
 * rounded half up, trailing zeros dropped; null for no rate or zero.
 *
 * @param {string} rate
 * @param {number} [digits]
 */
export function invertRate(rate, digits = DIGITS) {
	const s = scaled(rate);
	if (!s || s.value === 0n) return null;
	// 1 / (value / 10^scale) = 10^scale / value, with digits + 1 places to round
	const q = 10n ** BigInt(s.scale + digits + 1) / s.value;
	const rounded = (q + 5n) / 10n;
	const str = rounded.toString().padStart(digits + 1, '0');
	const out = `${str.slice(0, -digits) || '0'}.${str.slice(-digits)}`;
	return out.replace(/0+$/, '').replace(/\.$/, '');
}

/** Whether a currency's rate reads better as units per euro. @param {string} currency @param {string | null} [rate] EUR per unit */
export function isWeak(currency, rate = null) {
	const r = Number(rate);
	if (rate && Number.isFinite(r) && r > 0) return r < WEAK_BELOW;
	return WEAK_CURRENCIES.has(String(currency).toUpperCase());
}

/**
 * EUR per unit as units per euro, rounded to `digits` for showing: `0.010921143881`
 * → `91.5655`.
 *
 * @param {string} rate
 * @param {number} [digits]
 */
export const perEuro = (rate, digits = 4) => invertRate(rate, digits);

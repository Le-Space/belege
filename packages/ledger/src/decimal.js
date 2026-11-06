// SPDX-License-Identifier: AGPL-3.0-or-later
// Decimal strings, never floats: a chain's smallest units to a signed
// decimal and back, sums, and amount × rate rounded half away from zero.
// One NEAR has 24 decimals, more than a JavaScript number keeps.

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** `1.50` → `1.5`, `-0` → `0`, `007` → `7`. @param {string} s */
export function normalize(s) {
	if (!DECIMAL.test(s)) return s;
	let [int, frac = ''] = s.replace(/^-/, '').split('.');
	int = int.replace(/^0+(?=\d)/, '');
	frac = frac.replace(/0+$/, '');
	const out = frac ? `${int}.${frac}` : int;
	return s.startsWith('-') && out !== '0' ? `-${out}` : out;
}

/**
 * Base units → a signed decimal string: (1500000n, 6) → `1.5`.
 *
 * @param {bigint | string} units @param {number} decimals
 */
export function fromUnits(units, decimals) {
	const v = BigInt(units);
	const neg = v < 0n;
	const abs = (neg ? -v : v).toString().padStart(decimals + 1, '0');
	const int = abs.slice(0, abs.length - decimals);
	const frac = decimals ? abs.slice(abs.length - decimals) : '';
	return normalize(`${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`);
}

/** The name Belege's chain readers use for `fromUnits`. */
export const unitsToDecimal = fromUnits;

/**
 * Decimal string → base units: ('1.5', 6) → 1500000n; extra digits are cut.
 *
 * @param {string} amount @param {number} decimals
 */
export function toUnits(amount, decimals) {
	const s = String(amount).trim();
	if (!DECIMAL.test(s)) throw new Error(`bad decimal ${amount}`);
	const neg = s.startsWith('-');
	const [int, frac = ''] = s.replace(/^-/, '').split('.');
	const v = BigInt(int + frac.padEnd(decimals, '0').slice(0, decimals));
	return neg ? -v : v;
}

/** Sum of decimal strings. @param {string[]} amounts */
export function sum(amounts) {
	const d = Math.max(0, ...amounts.map((a) => (String(a).split('.')[1] ?? '').length));
	return fromUnits(
		amounts.reduce((acc, a) => acc + toUnits(a, d), 0n),
		d
	);
}

/**
 * amount × rate, rounded half away from zero to `places` decimals.
 *
 * @param {string} amount decimal
 * @param {string} rate decimal
 * @param {number} [places]
 */
export function multiply(amount, rate, places = 2) {
	const da = (amount.split('.')[1] ?? '').length;
	const dr = (rate.split('.')[1] ?? '').length;
	const product = toUnits(amount, da) * toUnits(rate, dr); // scale da + dr
	const scale = da + dr;
	if (scale <= places) return fromUnits(product * 10n ** BigInt(places - scale), places);
	const div = 10n ** BigInt(scale - places);
	const neg = product < 0n;
	const abs = neg ? -product : product;
	let q = abs / div;
	if ((abs % div) * 2n >= div) q += 1n;
	return fromUnits(neg ? -q : q, places);
}

/** Round a decimal half away from zero. @param {string} amount @param {number} places */
export function round(amount, places) {
	return multiply(amount, '1', places);
}

// Amounts as signed decimal strings, from a chain's smallest units.

/** Units → a signed decimal string. @param {bigint} units @param {number} decimals */
export function unitsToDecimal(units, decimals) {
	const negative = units < 0n;
	const digits = (negative ? -units : units).toString().padStart(decimals + 1, '0');
	const int = digits.slice(0, digits.length - decimals);
	const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
	return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

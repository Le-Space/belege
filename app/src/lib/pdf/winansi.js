// Text for pdf-lib's built-in fonts (Helvetica): they speak Windows-1252 only.
// Umlauts, ß, € and · are there; anything else (a minus sign U+2212, an
// arrow, a name in another script) is replaced before it reaches pdf-lib,
// which would otherwise refuse the whole page.

/** Characters of Windows-1252 above 0x7F that are not Latin-1. */
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * Text Helvetica can draw: no-break spaces as spaces, a minus as a hyphen,
 * anything else outside Windows-1252 as "?".
 *
 * @param {string} text
 */
export function winAnsi(text) {
	return [
		...String(text ?? '')
			.replace(/[\u00a0\u202f]/g, ' ')
			.replace(/\u2212/g, '-')
	]
		.map((c) => {
			const code = c.codePointAt(0) ?? 0;
			if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return c;
			return CP1252_EXTRA.has(c) ? c : '?';
		})
		.join('');
}

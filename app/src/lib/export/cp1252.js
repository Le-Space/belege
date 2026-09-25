// Windows-1252 ("ANSI"), the encoding DATEV's and MonkeyOffice's CSV import
// expects. Browsers only decode it (TextEncoder writes UTF-8 alone), so the
// bytes are made here. A character outside Windows-1252 is first decomposed
// (é stays é, but "ő" becomes "o"); what is still outside becomes "?".

/** Code points 0x80–0x9F of Windows-1252; the rest of 0x00–0xFF is Latin-1. */
const HIGH = new Map(
	/** @type {[number, number][]} */ ([
		[0x20ac, 0x80],
		[0x201a, 0x82],
		[0x0192, 0x83],
		[0x201e, 0x84],
		[0x2026, 0x85],
		[0x2020, 0x86],
		[0x2021, 0x87],
		[0x02c6, 0x88],
		[0x2030, 0x89],
		[0x0160, 0x8a],
		[0x2039, 0x8b],
		[0x0152, 0x8c],
		[0x017d, 0x8e],
		[0x2018, 0x91],
		[0x2019, 0x92],
		[0x201c, 0x93],
		[0x201d, 0x94],
		[0x2022, 0x95],
		[0x2013, 0x96],
		[0x2014, 0x97],
		[0x02dc, 0x98],
		[0x2122, 0x99],
		[0x0161, 0x9a],
		[0x203a, 0x9b],
		[0x0153, 0x9c],
		[0x017e, 0x9e],
		[0x0178, 0x9f]
	])
);

/** The byte of one code point, or null when Windows-1252 has none. @param {number} cp */
function byteOf(cp) {
	if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) return cp;
	return HIGH.get(cp) ?? null;
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function encodeWindows1252(text) {
	/** @type {number[]} */
	const out = [];
	for (const ch of text.normalize('NFC')) {
		const cp = /** @type {number} */ (ch.codePointAt(0));
		const b = byteOf(cp);
		if (b !== null) {
			out.push(b);
			continue;
		}
		// Try without accents: the base letters that Windows-1252 has.
		const base = [...ch.normalize('NFD')]
			.map((c) => byteOf(/** @type {number} */ (c.codePointAt(0))))
			.filter((x) => x !== null && x >= 0x20 && !(x >= 0x80 && x <= 0x9f));
		out.push(...(base.length ? /** @type {number[]} */ (base) : [0x3f]));
	}
	return Uint8Array.from(out);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Fonts for the PDFs Le Space's tools draw (Eigenbelege, statements, a mail
// as a PDF, the travel statement): text in any script the books hold – a
// Russian station, a Turkish vendor, a Greek name, an Arabic hotel – instead
// of the "?" pdf-lib's built-in Helvetica (Windows-1252 only) left of it.
//
//   DejaVu Sans Condensed  Latin, Cyrillic, Greek (regular and bold): about as
//                      wide as Helvetica, so the tables keep their columns
//   Noto Sans Arabic   Arabic, shaped and right to left (fontkit's layout)
//   DejaVu Sans Mono   hashes, addresses, IBANs: fixed width
//
// DejaVu rather than Noto Sans for the first: pdf-lib's subsetting lost most
// letters of the Noto Sans build that npm has, and DejaVu's come through.
//
// Every font is embedded, as a subset of the letters used, so a PDF grows by
// a few kilobytes, not by the fonts – and stays PDF/A (pdfa.js): no standard
// font that is not embedded (Courier was, for mono, before), and no letter a
// font lacks (it would be drawn as .notdef, which PDF/A forbids). A text is
// drawn in runs, each in the font that has its letters; a letter none has
// (Chinese, say) is a "?". Control and format characters (bidi overrides
// among them, which could turn text around) are dropped.
//
// The fonts are embedded in a fixed order, so the same document is the same
// file, in Node and in a browser. Their bytes come from assets.js.

import fontkit from '@pdf-lib/fontkit';

import { asset } from './assets.js';

/** @typedef {import('pdf-lib').PDFDocument} PDFDocument */
/** @typedef {import('pdf-lib').PDFFont} PDFFont */
/** @typedef {import('pdf-lib').PDFPage} PDFPage */

/** Loaded once per page or process: the files are large, the fonts the same for every PDF. */
/** @type {Map<string, Promise<{ bytes: Uint8Array, font: any }>>} */
const loaded = new Map();
/** @param {import('./assets.js').AssetName} name */
function load(name) {
	let f = loaded.get(name);
	if (!f) {
		f = asset(name).then((bytes) => ({ bytes, font: fontkit.create(bytes) }));
		// A failed load is tried again next time.
		f.catch(() => loaded.delete(name));
		loaded.set(name, f);
	}
	return f;
}

const ARABIC = /\p{Script=Arabic}/u;
/** A number, which reads left to right inside Arabic text too. */
const NUMBER = /(\p{Nd}+(?:[.,:/-]\p{Nd}+)*)/u;
const NUMBER_ONLY = /^\p{Nd}+(?:[.,:/-]\p{Nd}+)*$/u;
/** Spaces, punctuation and digits: they take the font of what stands around them. */
const NEUTRAL = /[\s\p{P}\p{N}]/u;

/**
 * What any face draws: one line, no-break spaces as spaces, a minus as a
 * hyphen-minus, no control or format characters.
 *
 * @param {unknown} text
 */
export const pdfText = (text) =>
	String(text ?? '')
		.replace(/[  ]/g, ' ')
		.replace(/−/g, '-')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/[\p{Cc}\p{Cf}]/gu, '');

/**
 * @typedef {object} Face
 * @property {(text: string, size: number) => number} width
 * @property {(page: PDFPage, text: string, options: { x: number, y: number, size: number, color?: import('pdf-lib').Color }) => void} draw
 */

/**
 * The faces of one document: regular, bold, mono. Each draws one line of
 * text (pdfText); a layout wraps it (wrapText).
 *
 * @param {PDFDocument} pdf
 * @returns {Promise<{ regular: Face, bold: Face, mono: Face }>}
 */
export async function pdfFonts(pdf) {
	pdf.registerFontkit(fontkit);
	const [regular, bold, mono, arabic] = await Promise.all([
		load('DejaVuSansCondensed.ttf'),
		load('DejaVuSansCondensed-Bold.ttf'),
		load('DejaVuSansMono.ttf'),
		load('NotoSansArabic-Regular.ttf')
	]);
	const files = { regular, bold, mono, arabic };
	// One after the other: the order of the font objects is the order of the calls.
	/** @type {Record<'regular' | 'bold' | 'mono' | 'arabic', PDFFont>} */
	const embedded = {
		regular: await pdf.embedFont(files.regular.bytes, { subset: true }),
		bold: await pdf.embedFont(files.bold.bytes, { subset: true }),
		mono: await pdf.embedFont(files.mono.bytes, { subset: true }),
		arabic: await pdf.embedFont(files.arabic.bytes, { subset: true })
	};

	/**
	 * A face: its main font, Arabic beside it, and – for mono – DejaVu Sans
	 * Mono for what it has.
	 *
	 * @param {'regular' | 'bold'} main
	 * @param {boolean} [isMono]
	 * @returns {Face}
	 */
	function face(main, isMono = false) {
		/** @typedef {'mono' | 'main' | 'arabic'} Key */
		/** @param {Key} key @param {number} code @returns {boolean} */
		const canDraw = (key, code) =>
			(key === 'main' ? files[main] : files[key]).font.hasGlyphForCodePoint(code);
		/** @param {string} c @returns {Key | null} */
		const fontFor = (c) => {
			const code = c.codePointAt(0) ?? 0;
			if (isMono && canDraw('mono', code)) return 'mono';
			if (ARABIC.test(c)) return canDraw('arabic', code) ? 'arabic' : null;
			return canDraw('main', code) ? 'main' : null;
		};
		/** @param {string} text @returns {{ font: PDFFont, text: string }[]} */
		const runs = (text) => {
			const chars = [...pdfText(text)];
			/** @type {Key} */
			const fallback = isMono ? 'mono' : 'main';
			/** @type {(Key | null)[]} the strong font of each letter; null: neutral */
			const strong = chars.map((c) => (NEUTRAL.test(c) ? null : (fontFor(c) ?? fallback)));
			/** @type {{ key: Key, text: string }[]} */
			const out = [];
			chars.forEach((c, i) => {
				let key = strong[i];
				let char = c;
				const code = c.codePointAt(0) ?? 0;
				if (key === null) {
					// A space, a comma, a digit: Arabic only between Arabic letters, so a phrase is
					// shaped and turned as one, and "950,00 AED" after it stays left to right.
					const before = strong.slice(0, i).findLast((k) => k !== null) ?? null;
					const after = strong.slice(i + 1).find((k) => k !== null) ?? null;
					/** @type {Key} */
					let k =
						before === 'arabic' && after === 'arabic'
							? 'arabic'
							: isMono && canDraw('mono', code)
								? 'mono'
								: 'main';
					if (!canDraw(k, code)) k = canDraw('main', code) ? 'main' : fallback;
					if (!canDraw(k, code)) char = '?';
					key = k;
				} else if (!fontFor(c)) {
					char = '?';
				}
				const last = out[out.length - 1];
				if (last && last.key === key) last.text += char;
				else out.push({ key, text: char });
			});
			/** @type {{ font: PDFFont, text: string }[]} */
			const drawn = [];
			for (const r of out) {
				if (r.key !== 'arabic') {
					drawn.push({ font: r.key === 'mono' ? embedded.mono : embedded[main], text: r.text });
					continue;
				}
				// Right to left: fontkit turns the letters, but a number in the phrase reads left
				// to right, and the phrase's parts stand right to left. "المجموع 950,00 درهم".
				const parts = r.text.split(NUMBER).filter(Boolean);
				for (const part of parts.reverse()) {
					const isNumber = NUMBER_ONLY.test(part);
					const font =
						isNumber && canDraw('main', part.codePointAt(0) ?? 0)
							? embedded[main]
							: embedded.arabic;
					drawn.push({ font, text: part });
				}
			}
			return drawn;
		};
		return {
			width: (text, size) =>
				runs(text).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0),
			draw(page, text, { x, y, size, color }) {
				let at = x;
				for (const r of runs(text)) {
					page.drawText(r.text, { x: at, y, size, font: r.font, ...(color ? { color } : {}) });
					at += r.font.widthOfTextAtSize(r.text, size);
				}
			}
		};
	}

	return { regular: face('regular'), bold: face('bold'), mono: face('regular', true) };
}

/**
 * Text wrapped to a width: paragraphs at line breaks, words at spaces, and a
 * word wider than the line (a hash, an address) broken anywhere, never cut.
 *
 * @param {unknown} text
 * @param {Face} face
 * @param {number} size
 * @param {number} max
 * @returns {string[]}
 */
export function wrapText(text, face, size, max) {
	/** @type {string[]} */
	const lines = [];
	// Split first: pdfText turns a line break into a space.
	for (const paragraph of String(text ?? '')
		.split(/\r\n?|\n/)
		.map(pdfText)) {
		let line = '';
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const next = line ? `${line} ${word}` : word;
			if (face.width(next, size) <= max) {
				line = next;
				continue;
			}
			if (line) lines.push(line);
			let rest = [...word];
			while (rest.length > 1 && face.width(rest.join(''), size) > max) {
				let n = rest.length - 1;
				while (n > 1 && face.width(rest.slice(0, n).join(''), size) > max) n--;
				lines.push(rest.slice(0, n).join(''));
				rest = rest.slice(n);
			}
			line = rest.join('');
		}
		lines.push(line);
	}
	return lines;
}

// Fonts for the PDFs Belege draws (Eigenbelege, statements, a mail as a PDF,
// the travel statement): text in any script the books hold – a Russian
// station, a Turkish vendor, a Greek name, an Arabic hotel – instead of the
// "?" pdf-lib's built-in Helvetica (Windows-1252 only) left of it.
//
//   DejaVu Sans Condensed  Latin, Cyrillic, Greek (regular and bold): about as
//                      wide as Helvetica, so the tables keep their columns
//   Noto Sans Arabic   Arabic, shaped and right to left (fontkit's layout)
//   Courier            hashes, addresses, IBANs: fixed width, ASCII
//
// DejaVu rather than Noto Sans for the first: pdf-lib's subsetting lost most
// letters of the Noto Sans build that npm has, and DejaVu's come through.
//
// A text is drawn in runs, each in the font that has its letters; a letter
// none has (Chinese, say) is still a "?". Only the letters used are embedded
// (subset), so a PDF grows by a few kilobytes, not by the fonts. The font
// files (DejaVu: Bitstream Vera licence; Noto: SIL Open Font License) come
// with the app as assets and are fetched only when a PDF is drawn.

import fontkit from '@pdf-lib/fontkit';
import { StandardFonts } from 'pdf-lib';

import dejavuRegular from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import dejavuBold from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import notoArabic from '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf?url';

/**
 * A font file's bytes: fetched in the browser (an asset of the build, cached
 * by the service worker for offline use); read from disk where there is no
 * page, as in the unit tests.
 *
 * @param {string} url
 */
async function bytesOf(url) {
	if (typeof window === 'undefined') {
		const fsName = 'node:fs/promises';
		const { readFile } = await import(/* @vite-ignore */ fsName);
		const path = url.replace(/^\/@fs/, '').replace(/^\/node_modules\//, 'node_modules/');
		return new Uint8Array(await readFile(path));
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Font not loaded: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/** Loaded once per page: the files are large, the fonts the same for every PDF. */
/** @type {Map<string, Promise<{ bytes: Uint8Array, font: any }>>} */
const loaded = new Map();
/** @param {string} url */
function load(url) {
	let f = loaded.get(url);
	if (!f) {
		f = bytesOf(url).then((bytes) => ({ bytes, font: fontkit.create(bytes) }));
		// A failed load is tried again next time.
		f.catch(() => loaded.delete(url));
		loaded.set(url, f);
	}
	return f;
}

/** Characters of Windows-1252 above 0x7F that are not Latin-1: what Courier has. */
// eslint-disable-next-line belege/no-german -- a code page table, not text
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** @param {number} code */
const inCp1252 = (code) =>
	(code >= 0x20 && code <= 0x7e) ||
	(code >= 0xa0 && code <= 0xff) ||
	CP1252_EXTRA.has(String.fromCodePoint(code));

const ARABIC = /\p{Script=Arabic}/u;
/** A number, which reads left to right inside Arabic text too. */
const NUMBER = /(\p{Nd}+(?:[.,:/-]\p{Nd}+)*)/u;
const NUMBER_ONLY = /^\p{Nd}+(?:[.,:/-]\p{Nd}+)*$/u;
/** Spaces, punctuation and digits: they take the font of what stands around them. */
const NEUTRAL = /[\s\p{P}\p{N}]/u;

/** What any face draws: no-break spaces as spaces, a minus as a hyphen-minus. @param {string} text */
export const pdfText = (text) =>
	String(text ?? '')
		.replace(/[\u00a0\u202f]/g, ' ')
		.replace(/\u2212/g, '-')
		.replace(/[\r\n\t]+/g, ' ');

/**
 * @typedef {object} Face
 * @property {(text: string, size: number) => number} width
 * @property {(page: import('pdf-lib').PDFPage, text: string, options: { x: number, y: number, size: number, color?: import('pdf-lib').Color }) => void} draw
 */

/**
 * The faces of one document: regular, bold, mono.
 *
 * @param {import('pdf-lib').PDFDocument} pdf
 * @returns {Promise<{ regular: Face, bold: Face, mono: Face }>}
 */
export async function pdfFonts(pdf) {
	pdf.registerFontkit(fontkit);
	const [regular, bold, arabic] = await Promise.all([
		load(dejavuRegular),
		load(dejavuBold),
		load(notoArabic)
	]);
	const files = { regular, bold, arabic };
	const embedded = {
		regular: await pdf.embedFont(files.regular.bytes, { subset: true }),
		bold: await pdf.embedFont(files.bold.bytes, { subset: true }),
		arabic: await pdf.embedFont(files.arabic.bytes, { subset: true }),
		courier: await pdf.embedFont(StandardFonts.Courier)
	};

	/**
	 * A face: its main font, Arabic beside it, and – for mono – Courier for
	 * what Windows-1252 has.
	 *
	 * @param {'regular' | 'bold'} main
	 * @param {boolean} [mono]
	 * @returns {Face}
	 */
	function face(main, mono = false) {
		/** @param {'courier' | 'main' | 'arabic'} key @param {number} code */
		const canDraw = (key, code) =>
			key === 'courier'
				? inCp1252(code)
				: (key === 'arabic' ? files.arabic : files[main]).font.hasGlyphForCodePoint(code);
		/** @param {string} c @returns {'courier' | 'main' | 'arabic' | null} */
		const fontFor = (c) => {
			const code = c.codePointAt(0) ?? 0;
			if (mono && inCp1252(code)) return 'courier';
			if (ARABIC.test(c)) return canDraw('arabic', code) ? 'arabic' : null;
			return canDraw('main', code) ? 'main' : null;
		};
		/** @param {string} text @returns {{ font: import('pdf-lib').PDFFont, text: string }[]} */
		const runs = (text) => {
			const chars = [...pdfText(text)];
			/** @type {('courier' | 'main' | 'arabic' | null)[]} the strong font of each letter; null: neutral */
			const strong = chars.map((c) =>
				NEUTRAL.test(c) ? null : (fontFor(c) ?? (mono ? 'courier' : 'main'))
			);
			/** @type {{ key: 'courier' | 'main' | 'arabic', text: string }[]} */
			const out = [];
			chars.forEach((c, i) => {
				let key = strong[i];
				let char = c;
				if (key === null) {
					// A space, a comma, a digit: Arabic only between Arabic letters, so a phrase is
					// shaped and turned as one, and "950,00 AED" after it stays left to right.
					const before = strong.slice(0, i).findLast((k) => k !== null) ?? null;
					const after = strong.slice(i + 1).find((k) => k !== null) ?? null;
					key =
						before === 'arabic' && after === 'arabic'
							? 'arabic'
							: mono && inCp1252(c.codePointAt(0) ?? 0)
								? 'courier'
								: 'main';
					if (!canDraw(key, c.codePointAt(0) ?? 0)) key = 'main';
				} else if (!fontFor(c)) {
					char = '?';
				}
				const last = out[out.length - 1];
				if (last && last.key === key) last.text += char;
				else out.push({ key, text: char });
			});
			/** @type {{ font: import('pdf-lib').PDFFont, text: string }[]} */
			const drawn = [];
			for (const r of out) {
				if (r.key !== 'arabic') {
					drawn.push({
						font: r.key === 'courier' ? embedded.courier : embedded[main],
						text: r.text
					});
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

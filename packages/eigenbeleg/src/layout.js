// SPDX-License-Identifier: AGPL-3.0-or-later
// Eigenbeleg's look, shared by every document this package draws (the
// Eigenbeleg of a period, the Kontoauszug, the Eigenbeleg of one booking, a
// statement Eigenbeleg): A4, a 48 pt margin, grey labels beside their values,
// thin rules, a tinted box for the note, tables whose header repeats on a
// new page, a QR code of the explorer link. Text in any script the fonts
// have (@le-space/pdf); pages as many as the content needs.
//
// The drawing helpers of Eigenbeleg's pdf.js and statement-pdf.js (from
// Le-Space/eigenbeleg-agent at e6cde90), on faces instead of pdf-lib fonts.

import { rgb } from 'pdf-lib';
import { encode } from 'uqr';
import { pdfText, wrapText } from '@le-space/pdf';

/** @typedef {import('@le-space/pdf').Face} Face */
/** @typedef {{ regular: Face, bold: Face, mono: Face }} Fonts */
/** @typedef {import('pdf-lib').Color} Color */

export const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
export const BLACK = rgb(0, 0, 0);
export const GREY = rgb(0.38, 0.38, 0.38);
export const RULE = rgb(0.78, 0.78, 0.78);
export const TINT = rgb(0.95, 0.95, 0.93);
export const BAND = rgb(0.93, 0.94, 0.95);
export const WARN = rgb(0.6, 0.12, 0.08);
export const OK = rgb(0.1, 0.42, 0.2);

/**
 * @typedef {object} Column
 * @property {string} title
 * @property {number} width
 * @property {boolean} [right] aligned right, as numbers are
 * @property {boolean} [mono]
 */

/**
 * A layout on a new A4 page of `pdf`.
 *
 * @param {import('pdf-lib').PDFDocument} pdf
 * @param {Fonts} fonts
 * @param {object} [o]
 * @param {number} [o.margin]
 * @param {number} [o.bottom] room kept free above the bottom margin, for the footer
 * @param {(l: Layout) => void} [o.leavePage] before a new page: the old one's footer
 * @param {(l: Layout) => void} [o.enterPage] on a new page: its running head
 */
export function pageLayout(pdf, fonts, { margin = 48, bottom = 14, leavePage, enterPage } = {}) {
	const { regular } = fonts;
	const l = {
		pdf,
		fonts,
		margin,
		width: A4[0] - 2 * margin,
		page: pdf.addPage(A4),
		y: A4[1] - margin,
		/** @type {import('pdf-lib').PDFPage[]} */
		pages: /** @type {import('pdf-lib').PDFPage[]} */ ([]),

		newPage() {
			leavePage?.(l);
			l.page = pdf.addPage(A4);
			l.pages.push(l.page);
			l.y = A4[1] - margin;
			enterPage?.(l);
		},

		/** A new page when fewer than `h` points are left. @param {number} h */
		ensure(h) {
			if (l.y - h >= margin + bottom) return false;
			l.newPage();
			return true;
		},

		/** @param {number} h */
		gap(h) {
			l.y -= h;
		},

		/**
		 * Wrapped text, a new page where it runs out.
		 *
		 * @param {string} t
		 * @param {{ x?: number, size?: number, face?: Face, color?: Color, max?: number, lead?: number }} [o]
		 */
		text(t, o = {}) {
			const {
				x = margin,
				size = 9.5,
				face = regular,
				color = BLACK,
				max = l.width - (x - margin),
				lead = 1.35
			} = o;
			for (const line of wrapText(t, face, size, max)) {
				l.ensure(size * lead);
				face.draw(l.page, line, { x, y: l.y - size, size, color });
				l.y -= size * lead;
			}
		},

		/** One line, right-aligned at `xRight`. @param {string} t @param {number} xRight @param {number} size @param {Face} face @param {Color} [color] */
		right(t, xRight, size, face, color = BLACK) {
			const c = pdfText(t);
			face.draw(l.page, c, { x: xRight - face.width(c, size), y: l.y - size, size, color });
		},

		/** One line at `x`, on the current line. @param {string} t @param {number} x @param {number} size @param {Face} face @param {Color} [color] */
		at(t, x, size, face, color = BLACK) {
			face.draw(l.page, pdfText(t), { x, y: l.y - size, size, color });
		},

		/** @param {number} [thickness] @param {Color} [color] */
		rule(thickness = 0.6, color = RULE) {
			l.page.drawLine({
				start: { x: margin, y: l.y },
				end: { x: A4[0] - margin, y: l.y },
				thickness,
				color
			});
		},

		/**
		 * A label and its value side by side.
		 *
		 * @param {string} label
		 * @param {string} value
		 * @param {{ face?: Face, size?: number, max?: number, labelWidth?: number }} [o]
		 */
		field(label, value, o = {}) {
			const lw = o.labelWidth ?? 92;
			const size = o.size ?? 8.5;
			const lines = wrapText(value || '—', o.face ?? regular, size, (o.max ?? l.width) - lw);
			l.ensure(Math.min(lines.length, 3) * size * 1.35);
			const top = l.y;
			l.text(label, { face: fonts.bold, size: 8, color: GREY, max: lw - 6 });
			const after = l.y;
			const page = l.page;
			l.y = top;
			l.text(value || '—', {
				x: margin + lw,
				face: o.face ?? regular,
				size,
				max: (o.max ?? l.width) - lw
			});
			// Where the value went on to a new page, the label's end does not count.
			l.y = l.page === page ? Math.min(l.y, after) : l.y;
		},

		/** A note in a tinted box. @param {string} t @param {number} [size] */
		box(t, size = 9) {
			const lines = wrapText(t, regular, size, l.width - 16);
			const h = lines.length * size * 1.35 + 14;
			l.ensure(h);
			l.page.drawRectangle({
				x: margin,
				y: l.y - h,
				width: l.width,
				height: h,
				color: TINT,
				borderColor: RULE,
				borderWidth: 0.6
			});
			l.y -= 7;
			for (const line of lines) {
				regular.draw(l.page, line, { x: margin + 8, y: l.y - size, size });
				l.y -= size * 1.35;
			}
			l.y -= 7;
		},

		/** A QR code of `value`, `side` points wide, its top left at (x, top). @param {string} value @param {number} x @param {number} top @param {number} side */
		qr(value, x, top, side) {
			const code = encode(value, { border: 0 });
			const cell = side / code.size;
			code.data.forEach((row, r) => {
				// Runs of dark cells as one rectangle each.
				for (let c = 0; c < row.length; c++) {
					if (!row[c]) continue;
					let n = 1;
					while (row[c + n]) n++;
					l.page.drawRectangle({
						x: x + c * cell,
						y: top - (r + 1) * cell,
						width: n * cell + 0.05,
						height: cell + 0.05,
						color: BLACK
					});
					c += n - 1;
				}
			});
		},

		/**
		 * One row of a table, its cells wrapped; a new page (and `header` again) where it does not fit.
		 *
		 * @param {Column[]} columns
		 * @param {string[]} cells
		 * @param {{ face?: Face, color?: Color, size?: number, lead?: number, header?: () => void }} [o]
		 */
		row(columns, cells, o = {}) {
			const { face = regular, color = BLACK, size = 7.5, lead = 9.5, header } = o;
			const wrapped = columns.map((c, i) =>
				wrapText(cells[i] ?? '', c.mono ? fonts.mono : face, size, c.width - 6)
			);
			const h = Math.max(...wrapped.map((w) => w.length)) * lead + 2;
			if (l.ensure(h)) header?.();
			let x = margin;
			columns.forEach((c, i) => {
				const f = c.mono ? fonts.mono : face;
				wrapped[i].forEach((line, j) => {
					const w = f.width(line, size);
					f.draw(l.page, line, {
						x: c.right ? x + c.width - 6 - w : x,
						y: l.y - size - j * lead,
						size,
						color
					});
				});
				x += c.width;
			});
			l.y -= h;
		}
	};
	l.pages.push(l.page);
	return l;
}

/** @typedef {ReturnType<typeof pageLayout>} Layout */

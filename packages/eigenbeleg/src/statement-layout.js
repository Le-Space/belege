// The layout of a statement Eigenbeleg (Aleph's, Akash's): an A4 page in the
// look of receipts/eigenbeleg-pdf.js – a head with the number, labelled
// fields, rules, headings, tables whose header repeats on a new page, and a
// line to sign. Pages as long as the content needs; text in any script the
// fonts have (fonts.js).

import { PDFDocument, rgb } from 'pdf-lib';

import { pdfFonts, pdfText } from './fonts.js';

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 48;
const LABEL = 150;
const GREY = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.75, 0.75, 0.75);

/**
 * A new document and the means to fill it.
 *
 * @param {object} p
 * @param {string} p.title the PDF's title
 * @param {Date} p.created
 * @param {string} p.continuation printed on top of every further page
 */
export async function statementLayout({ title, created, continuation }) {
	const pdf = await PDFDocument.create();
	pdf.setTitle(pdfText(title));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	const { regular, bold, mono } = await pdfFonts(pdf);
	const width = A4[0] - 2 * MARGIN;
	let page = pdf.addPage(A4);
	let y = A4[1] - MARGIN;

	/** A new page when fewer than `need` points are left. @param {number} need */
	function room(need) {
		if (y - need >= MARGIN + 20) return;
		page = pdf.addPage(A4);
		y = A4[1] - MARGIN;
		regular.draw(page, continuation, { x: MARGIN, y, size: 8, color: GREY });
		y -= 20;
	}

	/**
	 * @param {string} text
	 * @param {import('./fonts.js').Face} font
	 * @param {number} size
	 * @param {number} max
	 */
	function wrap(text, font, size, max) {
		/** @type {string[]} */
		const lines = [];
		for (const paragraph of String(text).split(/\r?\n/).map(pdfText)) {
			let line = '';
			for (const word of paragraph.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.width(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					line = word;
					while (font.width(line, size) > max) {
						let n = line.length - 1;
						while (n > 1 && font.width(line.slice(0, n), size) > max) n--;
						lines.push(line.slice(0, n));
						line = line.slice(n);
					}
				}
			}
			lines.push(line);
		}
		return lines;
	}

	/** @param {string} label @param {string} value @param {boolean | 'mono'} [style] */
	function field(label, value, style = false) {
		const font = style === 'mono' ? mono : style ? bold : regular;
		const size = style === 'mono' ? 9 : 10;
		const lines = wrap(value || '—', font, size, width - LABEL);
		room(lines.length * 13 + 7);
		regular.draw(page, label, { x: MARGIN, y, size: 9, color: GREY });
		lines.forEach((line, i) => font.draw(page, line, { x: MARGIN + LABEL, y: y - i * 13, size }));
		y -= lines.length * 13 + 7;
	}

	function rule() {
		room(20);
		y += 2;
		page.drawLine({
			start: { x: MARGIN, y },
			end: { x: A4[0] - MARGIN, y },
			thickness: 0.5,
			color: RULE
		});
		y -= 14;
	}

	/** @param {string} title */
	function heading(title) {
		room(40);
		bold.draw(page, title, { x: MARGIN, y, size: 11 });
		y -= 16;
	}

	/**
	 * A table: columns by width and alignment; the header repeats on a new page.
	 *
	 * @param {{ title: string, width: number, right?: boolean, mono?: boolean }[]} columns
	 * @param {string[][]} rows
	 */
	function table(columns, rows) {
		const header = () => {
			let x = MARGIN;
			for (const c of columns) {
				const w = bold.width(c.title, 8);
				// Right-aligned as its cells, off the next column.
				bold.draw(page, c.title, { x: c.right ? x + c.width - 6 - w : x, y, size: 8 });
				x += c.width;
			}
			y -= 12;
		};
		room(30);
		header();
		for (const row of rows) {
			const cells = row.map((text, i) =>
				wrap(text, columns[i].mono ? mono : regular, 8, columns[i].width - 6)
			);
			const height = Math.max(...cells.map((c) => c.length)) * 10 + 2;
			if (y - height < MARGIN + 20) {
				room(Infinity);
				header();
			}
			let x = MARGIN;
			cells.forEach((lines, i) => {
				const c = columns[i];
				const font = c.mono ? mono : regular;
				lines.forEach((line, n) => {
					const w = font.width(line, 8);
					font.draw(page, line, { x: c.right ? x + c.width - 6 - w : x, y: y - n * 10, size: 8 });
				});
				x += c.width;
			});
			y -= height;
		}
		y -= 8;
	}

	/**
	 * "Eigenbeleg" (or another title), the number on the right, the issuer, a grey line.
	 *
	 * @param {string} number
	 * @param {string} issuer
	 * @param {string} subtitle
	 * @param {string} [title]
	 */
	function head(number, issuer, subtitle, title = 'Eigenbeleg') {
		bold.draw(page, title, { x: MARGIN, y: y - 18, size: 22 });
		bold.draw(page, number, { x: A4[0] - MARGIN - bold.width(number, 12), y: y - 14, size: 12 });
		y -= 36;
		if (issuer) {
			regular.draw(page, issuer, { x: MARGIN, y, size: 11 });
			y -= 16;
		}
		regular.draw(page, subtitle, { x: MARGIN, y, size: 9, color: GREY });
		y -= 22;
		rule();
	}

	function signature() {
		room(60);
		y -= 36;
		page.drawLine({
			start: { x: MARGIN + LABEL, y },
			end: { x: MARGIN + LABEL + 220, y },
			thickness: 0.5
		});
		regular.draw(page, 'Unterschrift', { x: MARGIN + LABEL, y: y - 11, size: 8, color: GREY });
	}

	return { width, head, field, rule, heading, table, signature, save: () => pdf.save() };
}

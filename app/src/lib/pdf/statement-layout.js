// The layout of a statement Eigenbeleg (Aleph's, Akash's): an A4 page in the
// look of receipts/eigenbeleg-pdf.js – a head with the number, labelled
// fields, rules, headings, tables whose header repeats on a new page, and a
// line to sign. Pages as long as the content needs; every text goes through
// winAnsi.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { winAnsi } from './winansi.js';

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
	pdf.setTitle(winAnsi(title));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const mono = await pdf.embedFont(StandardFonts.Courier);
	const width = A4[0] - 2 * MARGIN;
	let page = pdf.addPage(A4);
	let y = A4[1] - MARGIN;

	/** A new page when fewer than `need` points are left. @param {number} need */
	function room(need) {
		if (y - need >= MARGIN + 20) return;
		page = pdf.addPage(A4);
		y = A4[1] - MARGIN;
		page.drawText(winAnsi(continuation), { x: MARGIN, y, size: 8, font: regular, color: GREY });
		y -= 20;
	}

	/**
	 * @param {string} text
	 * @param {import('pdf-lib').PDFFont} font
	 * @param {number} size
	 * @param {number} max
	 */
	function wrap(text, font, size, max) {
		/** @type {string[]} */
		const lines = [];
		for (const paragraph of String(text).split(/\r?\n/).map(winAnsi)) {
			let line = '';
			for (const word of paragraph.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					line = word;
					while (font.widthOfTextAtSize(line, size) > max) {
						let n = line.length - 1;
						while (n > 1 && font.widthOfTextAtSize(line.slice(0, n), size) > max) n--;
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
		page.drawText(winAnsi(label), { x: MARGIN, y, size: 9, font: regular, color: GREY });
		lines.forEach((line, i) =>
			page.drawText(line, { x: MARGIN + LABEL, y: y - i * 13, size, font })
		);
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
		page.drawText(winAnsi(title), { x: MARGIN, y, size: 11, font: bold });
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
				const t = winAnsi(c.title);
				const w = bold.widthOfTextAtSize(t, 8);
				// Right-aligned as its cells, off the next column.
				page.drawText(t, { x: c.right ? x + c.width - 6 - w : x, y, size: 8, font: bold });
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
					const w = font.widthOfTextAtSize(line, 8);
					page.drawText(line, {
						x: c.right ? x + c.width - 6 - w : x,
						y: y - n * 10,
						size: 8,
						font
					});
				});
				x += c.width;
			});
			y -= height;
		}
		y -= 8;
	}

	/** "Eigenbeleg", the number on the right, the issuer, a grey line. @param {string} number @param {string} issuer @param {string} subtitle */
	function head(number, issuer, subtitle) {
		page.drawText('Eigenbeleg', { x: MARGIN, y: y - 18, size: 22, font: bold });
		const no = winAnsi(number);
		page.drawText(no, {
			x: A4[0] - MARGIN - bold.widthOfTextAtSize(no, 12),
			y: y - 14,
			size: 12,
			font: bold
		});
		y -= 36;
		if (issuer) {
			page.drawText(winAnsi(issuer), { x: MARGIN, y, size: 11, font: regular });
			y -= 16;
		}
		page.drawText(winAnsi(subtitle), { x: MARGIN, y, size: 9, font: regular, color: GREY });
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
		page.drawText(winAnsi('Unterschrift'), {
			x: MARGIN + LABEL,
			y: y - 11,
			size: 8,
			font: regular,
			color: GREY
		});
	}

	return { width, head, field, rule, heading, table, signature, save: () => pdf.save() };
}

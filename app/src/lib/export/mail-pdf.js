// A receipt that is a mail without an attachment (a shop's receipt written in
// the mail itself) as an A4 PDF for the monthly ZIP, in the browser, with
// pdf-lib and its built-in Helvetica. Without it the receipt had a number in
// the booking batch and no document in the ZIP.
//
// It shows sender, the day it came, subject and the text: the whole text of
// the mail as received where Belege kept it (`.eml`, #288; the ZIP holds it
// beside this PDF), else the excerpt taken at the fetch – at most about 2,000
// characters (bridge/src/mail/mime.js) – and then says when that was cut.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { winAnsi } from '../pdf/winansi.js';

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 56;
const SIZE = 10;
const LEADING = 14;
const GREY = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.8, 0.8, 0.8);

/** Whether the kept text is the bridge's cut excerpt (it ends in "…" when cut). @param {string} text */
export const isCut = (text) => text.length >= 1999 && text.endsWith('…');

/**
 * The kept text made readable on paper: line breaks as they were (at most one
 * empty line between paragraphs), a link shortened to its host – a shop's
 * receipt mail is full of tracking links a page cannot follow anyway – and
 * the image references of a mail's plain-text part (`[https://….png]`) left
 * out.
 *
 * @param {string} text
 */
export function readableMailText(text) {
	return String(text ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/\s*\[https?:\/\/[^\]\s]+\]/g, '')
		.replace(/https?:\/\/([^\s/)\]>]+)[^\s)\]>]*/g, (url, host) =>
			url.length > 40 ? `${host}/…` : url
		)
		.replace(/[ \t]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Lines of at most `width` points: words kept whole where they fit, a word
 * longer than a line broken where it must.
 *
 * @param {string} text
 * @param {(s: string) => number} measure
 * @param {number} width
 * @returns {string[]}
 */
export function wrap(text, measure, width) {
	/** @type {string[]} */
	const out = [];
	for (const paragraph of text.split('\n')) {
		let line = '';
		for (const word of paragraph.split(' ')) {
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= width) {
				line = candidate;
				continue;
			}
			if (line) out.push(line);
			let rest = word;
			while (measure(rest) > width && rest.length > 1) {
				let cut = rest.length - 1;
				while (cut > 1 && measure(rest.slice(0, cut)) > width) cut--;
				out.push(rest.slice(0, cut));
				rest = rest.slice(cut);
			}
			line = rest;
		}
		out.push(line);
	}
	return out;
}

/**
 * @param {Record<string, any>} receipt a mail receipt without a file (`excerpt`)
 * @param {{ number: string, created: Date, text?: string | null }} options its receipt number in
 *   this export; `text`: the mail's text from the kept original, when there is one
 * @returns {Promise<Uint8Array>}
 */
export async function mailReceiptPdf(receipt, { number, created, text: full = null }) {
	const pdf = await PDFDocument.create();
	pdf.setTitle(winAnsi(`E-Mail-Beleg ${number}`));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const width = A4[0] - 2 * MARGIN;

	let page = pdf.addPage(A4);
	let y = A4[1] - MARGIN;
	/** @param {string} text @param {{ font?: any, size?: number, color?: any }} [o] */
	const write = (text, o = {}) => {
		if (y < MARGIN + LEADING) {
			page = pdf.addPage(A4);
			y = A4[1] - MARGIN;
		}
		page.drawText(text, {
			x: MARGIN,
			y,
			size: o.size ?? SIZE,
			font: o.font ?? regular,
			color: o.color
		});
		y -= LEADING;
	};
	const measure = (/** @type {string} */ s) => regular.widthOfTextAtSize(s, SIZE);

	write(winAnsi(`E-Mail-Beleg ${number}`), { font: bold, size: 14 });
	y -= 6;
	const received = String(receipt.receivedAt ?? '').slice(0, 10);
	for (const [label, value] of [
		['Von', receipt.from ?? ''],
		['Betreff', receipt.subject ?? ''],
		['Empfangen', /^\d{4}-\d{2}-\d{2}$/.test(received) ? formatDate(received, DOCUMENT_LOCALE) : '']
	]) {
		if (!value) continue;
		const lines = wrap(winAnsi(String(value)), measure, width - 70);
		page.drawText(`${label}:`, { x: MARGIN, y, size: SIZE, font: bold });
		for (const [i, l] of lines.entries()) {
			page.drawText(l, { x: MARGIN + 70, y, size: SIZE, font: regular });
			if (i < lines.length - 1) y -= LEADING;
		}
		y -= LEADING;
	}
	y -= 4;
	page.drawLine({
		start: { x: MARGIN, y },
		end: { x: A4[0] - MARGIN, y },
		thickness: 0.5,
		color: RULE
	});
	y -= LEADING + 4;

	const original = Boolean(full && full.trim());
	const text = original ? String(full) : String(receipt.excerpt ?? '');
	// Broken into lines first, then into the PDF's code page: winAnsi turns a
	// line break into "?", and the whole mail became one block.
	for (const line of wrap(readableMailText(text), (l) => measure(winAnsi(l)), width)) {
		write(winAnsi(line));
	}

	y -= LEADING;
	const notes = original
		? [
				'Aus dem Text der E-Mail erzeugt; die E-Mail selbst, wie sie ankam, liegt als .eml mit derselben Belegnummer daneben.'
			]
		: [
				'Aus dem Text der E-Mail erzeugt, den Belege beim Abruf aus dem Buchhaltungspostfach gespeichert hat; die E-Mail selbst liegt im Postfach.',
				...(isCut(text)
					? [
							'Der gespeicherte Text ist gekürzt (höchstens etwa 2.000 Zeichen) – die vollständige E-Mail steht im Postfach.'
						]
					: [])
			];
	for (const note of notes) {
		for (const line of wrap(winAnsi(note), (s) => regular.widthOfTextAtSize(s, 8), width)) {
			write(line, { size: 8, color: GREY });
		}
	}
	return pdf.save();
}

// Draws an Eigenbeleg (eigenbeleg.js) as an A4 PDF, in the browser, with
// pdf-lib's Helvetica; every text goes through winAnsi (pdf/winansi.js).
// Loaded on first use.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { formatDate } from '../bank/format.js';
import { formatQuantity } from '../assets/quantity.js';
import { formatRate, SOURCE_NAMES } from '../assets/valuation.js';
import { amount } from '../export/datev.js';
import { winAnsi } from '../pdf/winansi.js';

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 56;
const LABEL = 150;
const GREY = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.75, 0.75, 0.75);

/**
 * @param {import('./eigenbeleg.js').EigenbelegDocument} doc
 * @returns {Promise<Uint8Array>}
 */
export async function eigenbelegPdf(doc) {
	const created = new Date(doc.createdAt);
	const pdf = await PDFDocument.create();
	pdf.setTitle(winAnsi(`Eigenbeleg ${doc.number}`));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const page = pdf.addPage(A4);
	const width = A4[0] - 2 * MARGIN;
	let y = A4[1] - MARGIN;

	/**
	 * Words wrapped to a width.
	 *
	 * @param {string} text
	 * @param {import('pdf-lib').PDFFont} font
	 * @param {number} size
	 * @param {number} max
	 */
	function wrap(text, font, size, max) {
		/** @type {string[]} */
		const lines = [];
		for (const paragraph of winAnsi(text).split(/\r?\n/)) {
			let line = '';
			for (const word of paragraph.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					line = word;
				}
			}
			lines.push(line);
		}
		return lines;
	}

	/** @param {string} label @param {string} value @param {boolean} [strong] */
	function field(label, value, strong = false) {
		const lines = wrap(value || '—', strong ? bold : regular, 10, width - LABEL);
		page.drawText(winAnsi(label), { x: MARGIN, y, size: 9, font: regular, color: GREY });
		lines.forEach((line, i) => {
			page.drawText(line, {
				x: MARGIN + LABEL,
				y: y - i * 13,
				size: 10,
				font: strong ? bold : regular
			});
		});
		y -= lines.length * 13 + 7;
	}

	function rule() {
		y += 2;
		page.drawLine({
			start: { x: MARGIN, y },
			end: { x: A4[0] - MARGIN, y },
			thickness: 0.5,
			color: RULE
		});
		y -= 14;
	}

	page.drawText('Eigenbeleg', { x: MARGIN, y: y - 18, size: 22, font: bold });
	const no = winAnsi(doc.number);
	page.drawText(no, {
		x: A4[0] - MARGIN - bold.widthOfTextAtSize(no, 12),
		y: y - 14,
		size: 12,
		font: bold
	});
	y -= 36;
	if (doc.issuer) {
		page.drawText(winAnsi(doc.issuer), { x: MARGIN, y, size: 11, font: regular });
		y -= 16;
	}
	page.drawText(winAnsi('Beleg für eine Zahlung, zu der es keinen Beleg der Gegenseite gibt.'), {
		x: MARGIN,
		y,
		size: 9,
		font: regular,
		color: GREY
	});
	y -= 22;
	rule();

	const sign = doc.amountCents < 0 ? '-' : '';
	field('Datum der Zahlung', formatDate(doc.date));
	field('Betrag', `${sign}${amount(doc.amountCents)} EUR`, true);
	field(doc.amountCents < 0 ? 'Empfänger' : 'Zahlende Seite', doc.counterparty);
	field('Konto', doc.account);
	if (doc.purpose && doc.purpose !== doc.description) field('Verwendungszweck', doc.purpose);
	if (doc.crypto) {
		const c = doc.crypto;
		const source = /** @type {Record<string, string>} */ (SOURCE_NAMES)[c.source] ?? c.source;
		field('Menge', `${formatQuantity(c.quantity, c.decimals)} ${c.asset}`);
		field(
			'Kurs',
			`${formatRate(c.rate)} EUR je ${c.asset} · ${source}${c.at ? `, ${formatDate(c.at.slice(0, 10))}` : ''}`
		);
	}
	if (doc.txRef) field('Referenz', doc.txRef);
	rule();
	field('Was wurde bezahlt', doc.description);
	field('Warum kein Fremdbeleg', doc.reason);
	rule();
	field(
		'Erstellt',
		`${formatDate(doc.createdAt.slice(0, 10))}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`
	);

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

	const note = wrap(
		'Erstellt mit Belege. Ein Eigenbeleg ersetzt einen fehlenden Beleg der Gegenseite; er ist keine Rechnung und berechtigt nicht zum Vorsteuerabzug. Ob er anerkannt wird, klärt die Steuerberatung.',
		regular,
		7,
		width
	);
	note.forEach((line, i) => {
		page.drawText(line, { x: MARGIN, y: MARGIN - 10 - i * 9, size: 7, font: regular, color: GREY });
	});

	return pdf.save({ useObjectStreams: false });
}

// Draws an Eigenbeleg (eigenbeleg.js) as an A4 PDF, in the browser, with
// pdf-lib's Helvetica; every text goes through winAnsi (pdf/winansi.js).
// Loaded on first use.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { encode } from 'uqr';

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
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
	// Hashes and addresses in a fixed width, broken anywhere but never cut (#126).
	const mono = await pdf.embedFont(StandardFonts.Courier);
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
		// Split first: winAnsi turns a line break into "?".
		for (const paragraph of String(text).split(/\r?\n/).map(winAnsi)) {
			let line = '';
			for (const word of paragraph.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					line = word;
					// A word longer than the line (a hash, an address): broken, not cut.
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
		page.drawText(winAnsi(label), { x: MARGIN, y, size: 9, font: regular, color: GREY });
		lines.forEach((line, i) => {
			page.drawText(line, { x: MARGIN + LABEL, y: y - i * 13, size, font });
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
	field('Datum der Zahlung', formatDate(doc.date, DOCUMENT_LOCALE));
	field('Betrag', `${sign}${amount(doc.amountCents)} EUR`, true);
	field(doc.amountCents < 0 ? 'Empfänger' : 'Zahlende Seite', doc.counterparty);
	field('Konto', doc.account);
	if (doc.purpose && doc.purpose !== doc.description) field('Verwendungszweck', doc.purpose);
	if (doc.crypto) {
		const c = doc.crypto;
		const source = /** @type {Record<string, string>} */ (SOURCE_NAMES)[c.source] ?? c.source;
		field(
			'Menge',
			`${formatQuantity(c.quantity, c.decimals, '', { locale: DOCUMENT_LOCALE })} ${c.asset}`
		);
		field(
			'Kurs',
			`${formatRate(c.rate, DOCUMENT_LOCALE)} EUR je ${c.asset} · ${source}${c.at ? `, ${formatDate(c.at.slice(0, 10), DOCUMENT_LOCALE)}` : ''}`
		);
	}
	if (doc.chain) {
		const c = doc.chain;
		rule();
		field('Chain', c.chain);
		field('Transaktion', c.hash, 'mono');
		if (c.at) field('Zeitpunkt', `${c.at.slice(0, 16).replace('T', ' ')} UTC`);
		/** @param {{ label: string, address: string, own: boolean }} p */
		const party = (p) =>
			`${p.label || '—'}${p.own ? ' (eigene Wallet)' : ''}${p.address && p.address !== p.label ? `\n${p.address}` : ''}`;
		field('Von', party(c.from));
		field('An', party(c.to));
		field(
			'Bewegungen',
			c.movements
				.map((m) => `${m.what}: ${m.quantity || '—'}${m.euro ? ` · ${m.euro}` : ''}`)
				.join('\n')
		);
		if (c.explorerUrl) {
			field('Block-Explorer', c.explorerUrl, 'mono');
			// The same link as a QR code, to check the transaction from paper.
			const qr = encode(c.explorerUrl, { border: 0 });
			const side = 84;
			const cell = side / qr.size;
			const top = y + 4;
			qr.data.forEach((row, r) =>
				row.forEach((dark, col) => {
					if (!dark) return;
					page.drawRectangle({
						x: MARGIN + LABEL + col * cell,
						y: top - (r + 1) * cell,
						width: cell,
						height: cell,
						color: rgb(0, 0, 0)
					});
				})
			);
			page.drawText(winAnsi('Transaktion im Block-Explorer'), {
				x: MARGIN + LABEL + side + 10,
				y: top - side / 2,
				size: 8,
				font: regular,
				color: GREY
			});
			y -= side + 12;
		}
	} else if (doc.txRef) field('Referenz', doc.txRef, 'mono');
	rule();
	field('Was wurde bezahlt', doc.description);
	field('Warum kein Fremdbeleg', doc.reason);
	rule();
	field(
		'Erstellt',
		`${formatDate(doc.createdAt.slice(0, 10), DOCUMENT_LOCALE)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`
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

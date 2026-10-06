// Draws a monthly statement (statement.js) as an A4 PDF, in the browser, with
// pdf-lib and its built-in Helvetica. Loaded lazily by build.js.
// Every text goes through winAnsi (pdf/winansi.js): Helvetica speaks Windows-1252 only.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { formatQuantity } from '../assets/quantity.js';
import { formatRate } from '../assets/valuation.js';
import { amount } from './datev.js';
import { lastDay } from './statement.js';
import { winAnsi } from '../pdf/winansi.js';

export { winAnsi };

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 42;
const ROW = 11;
const SIZE = 8;
const GREY = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.8, 0.8, 0.8);

/** How the rate's source is marked in its column (the legend is in the footer). */
const SOURCE_MARK = /** @type {Record<string, string>} */ ({
	kraken: 'K',
	coingecko: 'CG',
	ecb: 'EZB',
	cbr: 'CBR',
	nbk: 'NBK',
	'cbr-cross': 'CBR-X',
	trade: 'H',
	dex: 'DEX',
	migration: 'MIG',
	manual: 'M'
});

/** Where a balance comes from (#287): Kraken's ledger, or worked back from the bookings. */
const BALANCE_SOURCE = /** @type {Record<string, string>} */ ({
	kraken: 'laut Kraken',
	derived: 'errechnet'
});

/**
 * `(laut Kraken, abgestimmt)`: where the balance comes from, and for the
 * closing whether the bookings lead to it.
 *
 * @param {import('./statement.js').Balance} balance
 * @param {import('./statement.js').Reconciliation | null} [check]
 */
function balanceNote(balance, check = null) {
	const parts = [BALANCE_SOURCE[balance.source], check?.status === 'ok' ? 'abgestimmt' : ''];
	const text = parts.filter(Boolean).join(', ');
	return text ? ` (${text})` : '';
}

/** 1.234,56 with its sign. @param {number} cents */
const euros = (cents) => `${cents < 0 ? '-' : ''}${amount(cents)}`;

/**
 * @param {import('./statement.js').Statement} statement
 * @param {{ created: Date }} options
 * @returns {Promise<Uint8Array>}
 */
export async function statementPdf(statement, { created }) {
	const pdf = await PDFDocument.create();
	pdf.setTitle(winAnsi(`Kontoauszug ${statement.number}`));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

	const crypto =
		statement.lines.some((l) => l.quantity !== null) || Boolean(statement.balances?.closing.units);
	const asset = String(
		statement.account.asset ?? statement.lines.find((l) => l.asset)?.asset ?? ''
	);
	const decimals = Number(
		statement.account.decimals ?? statement.lines.find((l) => l.decimals !== null)?.decimals ?? 0
	);

	/** @type {{ key: string, title: string, width: number, align: 'left' | 'right', pad?: number }[]} */
	const columns = crypto
		? [
				{ key: 'date', title: 'Datum', width: 50, align: 'left' },
				{ key: 'text', title: 'Buchung', width: 170, align: 'left' },
				{ key: 'quantity', title: `Menge ${asset}`, width: 88, align: 'right' },
				{ key: 'rate', title: 'Kurs EUR', width: 76, align: 'right' },
				{ key: 'amount', title: 'Betrag EUR', width: 66, align: 'right' },
				{ key: 'receipt', title: 'Beleg', width: 61, align: 'left', pad: 10 }
			]
		: [
				{ key: 'date', title: 'Datum', width: 50, align: 'left' },
				{ key: 'text', title: 'Buchung', width: 330, align: 'left' },
				{ key: 'amount', title: 'Betrag EUR', width: 70, align: 'right' },
				{ key: 'receipt', title: 'Beleg', width: 61, align: 'left', pad: 10 }
			];

	/** @type {import('pdf-lib').PDFPage} */
	let page = pdf.addPage(A4);
	let y = A4[1] - MARGIN;

	/**
	 * @param {string} text
	 * @param {number} x
	 * @param {number} width
	 * @param {'left' | 'right'} align
	 * @param {import('pdf-lib').PDFFont} [font]
	 * @param {number} [size]
	 */
	function cell(text, x, width, align, font = regular, size = SIZE) {
		let s = winAnsi(text);
		if (font.widthOfTextAtSize(s, size) > width - 4) {
			while (s && font.widthOfTextAtSize(`${s}…`, size) > width - 4) s = s.slice(0, -1);
			s = `${s.trimEnd()}…`;
		}
		const w = font.widthOfTextAtSize(s, size);
		page.drawText(s, { x: align === 'right' ? x + width - 4 - w : x, y, size, font });
	}

	function tableHeader() {
		let x = MARGIN;
		for (const c of columns) {
			cell(c.title, x + (c.pad ?? 0), c.width - (c.pad ?? 0), c.align, bold);
			x += c.width;
		}
		y -= 4;
		page.drawLine({
			start: { x: MARGIN, y },
			end: { x: A4[0] - MARGIN, y },
			thickness: 0.5,
			color: RULE
		});
		y -= ROW;
	}

	function newPageIfNeeded(rows = 1) {
		if (y - rows * ROW > MARGIN + 40) return;
		page = pdf.addPage(A4);
		y = A4[1] - MARGIN;
		cell(`Kontoauszug ${statement.number} · ${statement.label}`, MARGIN, 400, 'left', bold);
		y -= ROW * 2;
		tableHeader();
	}

	/** @param {Record<string, string>} values @param {import('pdf-lib').PDFFont} [font] */
	function row(values, font = regular) {
		newPageIfNeeded();
		let x = MARGIN;
		for (const c of columns) {
			if (values[c.key])
				cell(values[c.key], x + (c.pad ?? 0), c.width - (c.pad ?? 0), c.align, font);
			x += c.width;
		}
		y -= ROW;
	}

	/** @param {string | null} units */
	const qty = (units) =>
		units === null ? '' : formatQuantity(units, decimals, '', { locale: DOCUMENT_LOCALE });

	// Head of the first page.
	page.drawText('Kontoauszug', { x: MARGIN, y: y - 14, size: 16, font: bold });
	cell('Belege', A4[0] - MARGIN - 150, 150, 'right', bold, 10);
	y -= 30;
	const [yy, mm] = statement.month.split('-');
	const head = [
		statement.label,
		statement.ledger ? `Sachkonto ${statement.ledger}` : '',
		`Zeitraum ${formatDate(`${yy}-${mm}-01`, DOCUMENT_LOCALE)} – ${formatDate(lastDay(statement.month), DOCUMENT_LOCALE)}`,
		`Auszug-Nr. ${statement.number}`
	].filter(Boolean);
	for (const line of head) {
		cell(line, MARGIN, 400, 'left', regular, 9);
		y -= ROW + 1;
	}
	y -= ROW;
	tableHeader();

	if (statement.balances) {
		row(
			{
				text: `Anfangsbestand${balanceNote(statement.balances.opening)}`,
				quantity: qty(statement.balances.opening.units),
				amount:
					statement.balances.opening.units === null ? euros(statement.balances.opening.cents) : ''
			},
			bold
		);
	}
	for (const l of statement.lines) {
		row({
			date: formatDate(l.date, DOCUMENT_LOCALE),
			text: l.text,
			quantity:
				l.quantity === null
					? ''
					: formatQuantity(l.quantity, l.decimals ?? decimals, '', { locale: DOCUMENT_LOCALE }),
			rate: l.valuation?.rate
				? `${formatRate(String(l.valuation.rate), DOCUMENT_LOCALE)} ${SOURCE_MARK[l.valuation.source] ?? ''}`.trim()
				: '',
			amount: euros(l.amountCents),
			receipt: l.receipt
		});
	}
	if (!statement.lines.length) row({ text: 'Keine Buchungen in diesem Monat.' });
	if (statement.balances) {
		row(
			{
				text: `Endbestand${balanceNote(statement.balances.closing, statement.balances.check)}`,
				quantity: qty(statement.balances.closing.units),
				amount:
					statement.balances.closing.units === null ? euros(statement.balances.closing.cents) : ''
			},
			bold
		);
		// Not reconciled (#287): what the bookings give, and the gap – no one number as the truth.
		const check = statement.balances.check;
		if (check?.status === 'open') {
			const value = (/** @type {{ cents: number, units: string | null }} */ v) => ({
				quantity: qty(v.units),
				amount: v.units === null ? euros(v.cents) : ''
			});
			row(
				{
					text: 'Nicht abgestimmt: Buchungen ergeben',
					...value(check.booked)
				},
				bold
			);
			row(
				{
					text: 'Differenz',
					...value(check.difference)
				},
				bold
			);
		}
	}

	// Totals.
	newPageIfNeeded(5);
	y -= 4;
	page.drawLine({
		start: { x: MARGIN, y: y + ROW - 2 },
		end: { x: A4[0] - MARGIN, y: y + ROW - 2 },
		thickness: 0.5,
		color: RULE
	});
	row({ text: 'Eingänge', amount: euros(statement.totals.inCents) });
	row({ text: 'Ausgänge', amount: euros(statement.totals.outCents) });
	row(
		{
			text: 'Summe des Monats',
			quantity: statement.totals.quantity === null ? '' : qty(statement.totals.quantity),
			amount: euros(statement.totals.netCents)
		},
		bold
	);

	// What "nicht abgestimmt" means here, below the totals.
	const check = statement.balances?.check;
	if (check?.status === 'open') {
		const why =
			check.by === 'month'
				? 'Nicht abgestimmt: Anfangs- und Endbestand sind die von Kraken; Anfangsbestand und Buchungen des Monats ergeben einen anderen Endbestand. Im Monat fehlt eine Bewegung, oder eine Buchung wurde gelöscht.'
				: 'Nicht abgestimmt: Der Endbestand ist aus dem heutigen Bestand zurückgerechnet; alle Buchungen seit Beginn ergeben einen anderen. Seitdem fehlt eine Bewegung, etwa eine Gebühr, die die Quelle nicht meldet, oder eine Buchung wurde gelöscht.';
		/** @type {string[]} */
		const wrapped = [''];
		for (const w of winAnsi(why).split(' ')) {
			const next = wrapped[wrapped.length - 1] ? `${wrapped[wrapped.length - 1]} ${w}` : w;
			if (bold.widthOfTextAtSize(next, SIZE) > A4[0] - 2 * MARGIN) wrapped.push(w);
			else wrapped[wrapped.length - 1] = next;
		}
		newPageIfNeeded(wrapped.length + 1);
		y -= ROW;
		for (const text of wrapped) {
			page.drawText(text, { x: MARGIN, y, size: SIZE, font: bold });
			y -= ROW;
		}
	}

	// Footer on every page.
	const note = crypto
		? 'Erstellt von Belege aus den gespeicherten Buchungen. Beträge in EUR; jede Menge zum Kurs ihres Tages bewertet. Kursquelle: K = Kraken, CG = CoinGecko, EZB = EZB-Referenzkurs, CBR = Referenzkurs der Bank of Russia, NBK = Referenzkurs der Nationalbank Kasachstans, CBR-X = Kreuzkurs über RUB aus den Kursen der Bank of Russia, H = Preis des Handels, DEX = Preis eines DEX-Pools (Uniswap) im Block der Buchung, MIG = Wert der dafür verbrannten alten Token.'
		: 'Erstellt von Belege aus den gespeicherten Buchungen. Beträge in EUR. Ersetzt nicht den Kontoauszug der Bank.';
	const pages = pdf.getPages();
	pages.forEach((p, i) => {
		page = p;
		y = MARGIN - 6;
		const words = winAnsi(
			`${note} Erstellt am ${formatDate(created.toISOString().slice(0, 10), DOCUMENT_LOCALE)}.`
		).split(' ');
		/** @type {string[]} */
		const lines = [''];
		for (const w of words) {
			const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
			if (regular.widthOfTextAtSize(next, 7) > A4[0] - 2 * MARGIN - 70) lines.push(w);
			else lines[lines.length - 1] = next;
		}
		lines.forEach((text, j) => {
			p.drawText(text, { x: MARGIN, y: y - j * 9, size: 7, font: regular, color: GREY });
		});
		const label = `Seite ${i + 1} von ${pages.length}`;
		p.drawText(label, {
			x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 7),
			y,
			size: 7,
			font: regular,
			color: GREY
		});
	});

	return pdf.save({ useObjectStreams: false });
}

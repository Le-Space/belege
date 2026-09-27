// A vendor account's timeline as an A4 PDF (issue #121), for the tax adviser:
// summary, what does not add up, and every row with period and positions.
// Drawn in the browser with pdf-lib's Helvetica; loaded on first use.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { formatDate, formatMoney } from '../bank/format.js';
import { winAnsi } from '../pdf/winansi.js';

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 48;
const GREY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.7, 0.1, 0.1);

/**
 * @param {object} p
 * @param {string} p.name the vendor
 * @param {string} p.from YYYY-MM-DD
 * @param {string} p.until YYYY-MM-DD
 * @param {ReturnType<typeof import('./vendor-account.js').vendorTimeline>} p.timeline
 * @param {string[]} p.findings as the page words them
 * @param {boolean} p.prepaid kept as a prepaid account
 * @param {string} p.createdAt ISO
 * @returns {Promise<Uint8Array>}
 */
export async function vendorAccountPdf({
	name,
	from,
	until,
	timeline,
	findings,
	prepaid,
	createdAt
}) {
	const pdf = await PDFDocument.create();
	pdf.setTitle(winAnsi(`Lieferantenkonto ${name}`));
	pdf.setCreator('Belege');
	pdf.setProducer('Belege');
	const regular = await pdf.embedFont(StandardFonts.Helvetica);
	const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
	let page = pdf.addPage(A4);
	let y = A4[1] - MARGIN;
	const money = (/** @type {number} */ c) => formatMoney(c, 'EUR');

	/** @param {number} needed */
	const room = (needed) => {
		if (y - needed > MARGIN) return;
		page = pdf.addPage(A4);
		y = A4[1] - MARGIN;
	};
	/**
	 * @param {string} text
	 * @param {number} x
	 * @param {{ size?: number, font?: import('pdf-lib').PDFFont, color?: ReturnType<typeof rgb>, right?: boolean }} [o]
	 */
	const draw = (
		text,
		x,
		{ size = 9, font = regular, color = rgb(0, 0, 0), right = false } = {}
	) => {
		const t = winAnsi(text);
		page.drawText(t, { x: right ? x - font.widthOfTextAtSize(t, size) : x, y, size, font, color });
	};

	draw('Lieferantenkonto', MARGIN, { size: 18, font: bold });
	y -= 22;
	draw(name, MARGIN, { size: 12, font: bold });
	y -= 16;
	draw(
		`${formatDate(from)} bis ${formatDate(until)}${prepaid ? ' · als Guthabenkonto geführt' : ''} · erstellt ${formatDate(createdAt.slice(0, 10))}`,
		MARGIN,
		{ color: GREY }
	);
	y -= 22;
	const summary = [
		['Anfangsbestand', timeline.openingCents === null ? 'unbekannt' : money(timeline.openingCents)],
		['Zahlungen / Aufladungen', money(timeline.topUpCents)],
		['Verbrauch laut Belegen', money(timeline.usageCents)],
		['Saldo', money(timeline.closingCents)]
	];
	for (const [label, value] of summary) {
		draw(label, MARGIN, { color: GREY });
		draw(value, MARGIN + 200, { font: bold });
		y -= 13;
	}
	if (findings.length) {
		y -= 8;
		draw('Was nicht zusammenpasst', MARGIN, { font: bold });
		y -= 13;
		for (const f of findings) {
			room(13);
			draw(`– ${f.slice(0, 120)}`, MARGIN, { color: RED });
			y -= 12;
		}
	}
	y -= 10;
	const cols = {
		date: MARGIN,
		what: MARGIN + 62,
		period: MARGIN + 130,
		topUp: 420,
		usage: 480,
		balance: A4[0] - MARGIN
	};
	const header = () => {
		draw('Datum', cols.date, { font: bold });
		draw('Vorgang', cols.what, { font: bold });
		draw('Zeitraum', cols.period, { font: bold });
		draw('Zahlung', cols.topUp, { font: bold, right: true });
		draw('Verbrauch', cols.usage, { font: bold, right: true });
		draw('Saldo', cols.balance, { font: bold, right: true });
		y -= 13;
	};
	header();
	for (const r of timeline.rows) {
		room(13 + (r.items?.length ?? 0) * 11);
		if (y > A4[1] - MARGIN - 1) header();
		draw(formatDate(r.date), cols.date);
		draw(r.kind === 'payment' ? 'Zahlung' : 'Beleg', cols.what);
		if (r.period) draw(`${formatDate(r.period.from)} – ${formatDate(r.period.to)}`, cols.period);
		if (r.topUpCents) draw(money(r.topUpCents), cols.topUp, { right: true });
		if (r.usageCents) draw(money(r.usageCents), cols.usage, { right: true });
		draw(money(r.balanceCents), cols.balance, {
			right: true,
			color: r.balanceCents < 0 ? RED : rgb(0, 0, 0)
		});
		y -= 12;
		for (const item of r.items ?? []) {
			draw(item.description.slice(0, 70), cols.period, { size: 8, color: GREY });
			draw(money(item.cents), cols.usage, { size: 8, color: GREY, right: true });
			y -= 11;
		}
	}
	return pdf.save({ useObjectStreams: false });
}

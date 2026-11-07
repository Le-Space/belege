// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug as an A4 PDF/A-2b, laid out like a bank statement:
// holder and account in the head, per asset the opening balance, a table of
// bookings (date, text, debit, credit, running balance, EUR value), the
// closing balance with its check against the chain, and the sums a
// bookkeeper needs. German, for German bookkeeping. Aleph Cloud credits get
// the same layout titled »Verbrauchsauszug« (`st.title`).

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { round } from '@le-space/ledger';
import { deDate, deEuro, deNumber } from './document.js';
import { makePdfA } from './pdf.js';
import { asset, FONTS } from './assets.js';

const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const M = 44;
const GREY = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.78, 0.78, 0.78);
const BAND = rgb(0.93, 0.94, 0.95);
const WARN = rgb(0.6, 0.12, 0.08);
const OK = rgb(0.1, 0.42, 0.2);

const COLS = [
	{ t: 'Buchungstag', w: 52, a: 'l' },
	{ t: 'Vorgang', w: 175, a: 'l' },
	{ t: 'Soll', w: 72, a: 'r' },
	{ t: 'Haben', w: 72, a: 'r' },
	{ t: 'Saldo', w: 80, a: 'r' },
	{ t: 'Wert EUR', w: 56, a: 'r' }
];

/** Quantities in the table: at most 12 decimals, the CSV keeps them all. @param {string} q */
const qty = (q) => (q ? deNumber(round(q, 12)) : '');

/**
 * @param {import('./statement.js').Statement} st
 * @returns {Promise<Uint8Array>}
 */
export async function statementPdf(st) {
	const created = new Date(st.issuedAt);
	// Aleph credits: a Verbrauchsauszug in the same layout, valued by its own rule.
	const aleph = st.chain === 'aleph';
	const title = `${st.title} ${st.number}`;
	const subject = `${st.title} ${st.chainName} ${st.account}, ${deDate(st.period.from)} – ${deDate(st.period.to)}`;
	const producer = 'eigenbeleg (Le Space UG), pdf-lib';
	const pdf = await PDFDocument.create({ updateMetadata: false });
	pdf.registerFontkit(fontkit);
	pdf.setTitle(title);
	pdf.setAuthor(st.holder.name);
	pdf.setSubject(subject);
	pdf.setCreator('eigenbeleg');
	pdf.setProducer(producer);
	pdf.setCreationDate(created);
	pdf.setModificationDate(created);
	pdf.setLanguage('de-DE');
	// Loaded together, embedded in a fixed order: the same document is the same file.
	const fontBytes = await Promise.all(FONTS.map((f) => asset(f)));
	const regular = await pdf.embedFont(fontBytes[0], { subset: true });
	const bold = await pdf.embedFont(fontBytes[1], { subset: true });
	const mono = await pdf.embedFont(fontBytes[2], { subset: true });
	const charsets = new Map([regular, bold, mono].map((f) => [f, new Set(f.getCharacterSet())]));
	const width = A4[0] - 2 * M;
	let page = pdf.addPage(A4);
	let y = A4[1] - M;
	/** @type {import('pdf-lib').PDFPage[]} */
	const pages = [page];

	/** @param {string} text @param {any} font */
	const clean = (text, font) => {
		const has = charsets.get(font);
		return String(text)
			.replace(/\r\n?/g, '\n')
			.replace(/\t/g, ' ')
			.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? c : ''))
			.replace(/[^\n]/gu, (c) => (has?.has(/** @type {number} */ (c.codePointAt(0))) ? c : '?'));
	};
	/** @param {string} text @param {any} font @param {number} size @param {number} max */
	const wrap = (text, font, size, max) => {
		const lines = [];
		for (const para of clean(text, font).split('\n')) {
			let line = '';
			for (const word of para.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					let rest = word;
					while (font.widthOfTextAtSize(rest, size) > max) {
						let n = rest.length;
						while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > max) n--;
						lines.push(rest.slice(0, n));
						rest = rest.slice(n);
					}
					line = rest;
				}
			}
			lines.push(line);
		}
		return lines;
	};
	const newPage = () => {
		page = pdf.addPage(A4);
		pages.push(page);
		y = A4[1] - M;
		const head = clean(`${st.title} ${st.number} · ${st.account}`, regular);
		page.drawText(head, { x: M, y: y - 8, size: 8, font: regular, color: GREY });
		y -= 18;
	};
	/** @param {number} h */
	const ensure = (h) => {
		if (y - h >= M + 16) return false;
		newPage();
		return true;
	};
	/** @param {string} t @param {{ x?: number, size?: number, font?: any, color?: any, max?: number }} [o] */
	const text = (t, o = {}) => {
		const { x = M, size = 9, font = regular, color = rgb(0, 0, 0), max = width - (x - M) } = o;
		for (const l of wrap(t, font, size, max)) {
			ensure(size * 1.35);
			page.drawText(l, { x, y: y - size, size, font, color });
			y -= size * 1.35;
		}
	};
	/** @param {string} t @param {number} xRight @param {number} size @param {any} font @param {any} [color] */
	const right = (t, xRight, size, font, color = rgb(0, 0, 0)) => {
		const c = clean(t, font);
		page.drawText(c, { x: xRight - font.widthOfTextAtSize(c, size), y: y - size, size, font, color });
	};

	// ---- head: like a bank's, with the holder's address window on the left
	if (st.testnet) {
		text('TESTNET – keine echten Werte. Kurse des Mainnet-Assets nur zur Veranschaulichung.', { font: bold, size: 8.5, color: WARN });
		y -= 4;
	}
	const top = y;
	text('Kontoinhaber', { font: bold, size: 7.5, color: GREY, max: 250 });
	text(st.holder.name, { font: bold, size: 10, max: 250 });
	text(st.holder.address, { size: 9.5, max: 250 });
	const leftEnd = y;
	y = top;
	const rx = M + 300;
	const facts = [
		// The label column is 72 pt wide: »Verbrauchsauszug« does not fit.
		[st.title === 'Kontoauszug' ? 'Kontoauszug' : 'Auszug-Nr.', st.number],
		['Zeitraum', `${deDate(st.period.from)} – ${deDate(st.period.to)}`],
		['Chain', `${st.chainName} (${st.network})`],
		['Erstellt am', `${deDate(st.issuedAt)}, ${st.issuedAt.slice(11, 16)} UTC`]
	];
	for (const [k, v] of facts) {
		page.drawText(k, { x: rx, y: y - 8.5, size: 8, font: bold, color: GREY });
		page.drawText(clean(v, regular), { x: rx + 72, y: y - 8.5, size: 8.5, font: regular });
		y -= 12;
	}
	y = Math.min(y, leftEnd) - 14;
	text(st.title, { font: bold, size: 18 });
	text('Konto', { font: bold, size: 7.5, color: GREY });
	text(st.account, { font: mono, size: 9 });
	y -= 6;
	text(st.note, { size: 8, color: GREY });
	y -= 10;

	// ---- one section per asset
	for (const s of st.sections) {
		ensure(90);
		page.drawRectangle({ x: M, y: y - 18, width, height: 18, color: BAND });
		page.drawText(clean(`${s.asset} · ${st.account}`, bold), { x: M + 6, y: y - 12.5, size: 9.5, font: bold });
		y -= 24;
		const head = () => {
			let x = M;
			for (const c of COLS) {
				if (c.a === 'r') right(c.t, x + c.w - 4, 7.5, bold, GREY);
				else page.drawText(c.t, { x, y: y - 7.5, size: 7.5, font: bold, color: GREY });
				x += c.w;
			}
			y -= 11;
			page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
			y -= 3;
		};
		head();
		// opening balance
		page.drawText(`Kontostand am ${deDate(st.period.from)} (Beginn)`, { x: M + COLS[0].w, y: y - 8, size: 8, font: bold });
		right(qty(s.opening), M + 451 - 4, 8, bold);
		y -= 13;
		for (const r of s.rows) {
			const detail = [r.counterparty && `${r.debit ? "an" : "von"} ${r.counterparty}`, r.hash && `${r.hashLabel} ${r.hash.slice(0, 10)}…${r.hash.slice(-6)}`, r.beleg && `Eigenbeleg ${r.beleg}`].filter(Boolean).join(' · ');
			const lines = wrap(r.text, regular, 8, COLS[1].w - 6);
			const sub = wrap(detail, regular, 6.5, COLS[1].w - 6);
			const h = lines.length * 10 + sub.length * 8.5 + 4;
			if (ensure(h)) head();
			page.drawText(`${deDate(r.date)}`, { x: M, y: y - 8, size: 8, font: regular });
			page.drawText(r.time, { x: M, y: y - 16.5, size: 6.5, font: regular, color: GREY });
			lines.forEach((l, i) => page.drawText(l, { x: M + COLS[0].w, y: y - 8 - i * 10, size: 8, font: regular }));
			sub.forEach((l, i) => page.drawText(l, { x: M + COLS[0].w, y: y - 8 - lines.length * 10 - i * 8.5 + 1.5, size: 6.5, font: regular, color: GREY }));
			let x = M + COLS[0].w + COLS[1].w;
			right(qty(r.debit), x + COLS[2].w - 4, 8, regular);
			x += COLS[2].w;
			right(qty(r.credit), x + COLS[3].w - 4, 8, regular);
			x += COLS[3].w;
			right(qty(r.balance), x + COLS[4].w - 4, 8, regular);
			x += COLS[4].w;
			right(r.eur ? deEuro(r.eur, 4).replace(' €', '') : '—', x + COLS[5].w - 4, 8, regular, r.eur ? rgb(0, 0, 0) : GREY);
			y -= h;
			page.drawLine({ start: { x: M, y: y + 1 }, end: { x: A4[0] - M, y: y + 1 }, thickness: 0.25, color: RULE });
		}
		if (s.rows.length === 0) {
			page.drawText('Keine Buchungen in diesem Zeitraum.', { x: M + COLS[0].w, y: y - 8, size: 8, font: regular, color: GREY });
			y -= 13;
		}
		// sums and closing balance
		ensure(60);
		page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
		y -= 3;
		page.drawText('Summe', { x: M + COLS[0].w, y: y - 8, size: 8, font: bold });
		right(qty(s.debit), M + 299 - 4, 8, bold);
		right(qty(s.credit), M + 371 - 4, 8, bold);
		y -= 13;
		page.drawText(`Kontostand am ${deDate(st.period.to)} (Ende)`, { x: M + COLS[0].w, y: y - 9, size: 9, font: bold });
		right(`${qty(s.closing)} ${s.asset}`, M + 451 - 4, 9, bold);
		y -= 15;
		// the check
		if (st.method === 'archive' && s.reported !== null) {
			const ok = s.difference !== null && /^-?0(\.0+)?$/.test(s.difference);
			const when = st.at ? ` (Block ${st.at.closing.height}, ${st.at.closing.time.slice(0, 19).replace('T', ' ')} UTC)` : '';
			text(
				ok
					? `Abgestimmt: Der Kontostand laut Chain nach dem Zeitraum${when} ist ${qty(s.reported)} ${s.asset} und stimmt mit Anfangsstand plus Buchungen überein.`
					: `Nicht abgestimmt: Der Kontostand laut Chain${when} ist ${qty(s.reported)} ${s.asset}; Differenz ${deNumber(/** @type {string} */ (s.difference))} ${s.asset} (Bewegungen, die der Leser nicht sieht, etwa Auszahlungen eines Staking-Pools).`,
				{ size: 7.5, color: ok ? OK : WARN }
			);
		} else {
			text(`Anfangs- und Endstand abgeleitet aus dem heutigen Kontostand abzüglich aller Bewegungen seither (${aleph ? 'die Aleph-API nennt den heutigen Stand und die Summen seither' : 'die Chain hält keine alten Kontostände vor'}).`, { size: 7.5, color: GREY });
		}
		y -= 4;
		text(
			aleph
				? `Ausgänge ${deEuro(s.eurOut)} · Eingänge ${deEuro(s.eurIn)} · davon Verbrauch (Aufwand) ${deEuro(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – Euro-Werte: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis) × EZB-Referenzkurs USD/EUR des Tages.`
				: `Ausgänge ${deEuro(s.eurOut)} · Eingänge ${deEuro(s.eurIn)} · davon Netzwerkgebühren (Aufwand) ${deEuro(s.eurFees)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – Euro-Werte zum Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken).`,
			{ size: 7.5, color: GREY }
		);
		y -= 12;
	}
	if (st.unlisted) text(`${st.unlisted} Bewegung(en) in Token ohne verlässlichen Kurs (oft Spam) sind nur in der CSV-Datei aufgeführt.`, { size: 7.5, color: GREY });

	// page numbers and footer on every page
	pages.forEach((p, i) => {
		const f = clean(`${st.number} · Seite ${i + 1} von ${pages.length}`, regular);
		p.drawText(f, { x: M, y: M / 2, size: 7, font: regular, color: GREY });
		const data = /** @type {Record<string, string>} */ ({ near: 'NearBlocks.io APIs, NEAR-Archiv-RPC', filecoin: 'Filfox', akash: 'Akash-RPC, Akash Console', aleph: 'Aleph-API (api2.aleph.im)' });
		const r = `Daten: ${data[st.chain] ?? st.chainName} · kein Dokument eines Kreditinstituts`;
		p.drawText(r, { x: A4[0] - M - regular.widthOfTextAtSize(r, 7), y: M / 2, size: 7, font: regular, color: GREY });
	});

	await makePdfA(pdf, { title, author: st.holder.name, subject, producer, created, seed: `${st.number}|${st.issuedAt}|${st.account}` });
	return pdf.save({ useObjectStreams: false });
}

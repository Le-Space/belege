// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg as an A4 PDF/A-2b: fonts embedded (DejaVu, subset), an sRGB
// output intent, XMP metadata that matches the document info, and a
// document id. PDF/A is what an archive for bookkeeping records expects.
//
// The text is German: the document is for German bookkeeping.

import { sha256 } from '@noble/hashes/sha2.js';
import { PDFDocument, PDFHexString, PDFName, PDFString, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { encode } from 'uqr';

import { round, toHex, utf8 } from '@le-space/ledger';

import { deDate, deEuro, deNumber } from './document.js';
import { asset, FONTS } from './assets.js';


const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const M = 48;
const GREY = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.78, 0.78, 0.78);
const TINT = rgb(0.95, 0.95, 0.93);
const WARN = rgb(0.6, 0.12, 0.08);


/**
 * @param {import('./document.js').EigenbelegDocument} doc
 * @returns {Promise<Uint8Array>}
 */
export async function eigenbelegPdf(doc) {
	const created = new Date(doc.issuedAt);
	const title = `Eigenbeleg ${doc.number}`;
	const producer = 'eigenbeleg (Le Space UG), pdf-lib';
	const pdf = await PDFDocument.create({ updateMetadata: false });
	pdf.registerFontkit(fontkit);
	pdf.setTitle(title);
	pdf.setAuthor(doc.payer.name);
	const subject = `${doc.layout === 'single' ? 'Eigenbelege' : 'Sammel-Eigenbeleg'} ${doc.chainName}, ${deDate(doc.period.from)} – ${deDate(doc.period.to)}`;
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

	let page = pdf.addPage(A4);
	let y = A4[1] - M;
	const width = A4[0] - 2 * M;
	let pageNo = 1;
	let current = doc.number;

	/** The letters each font has: anything else would be drawn as .notdef, which PDF/A forbids. */
	const charsets = new Map([regular, bold, mono].map((f) => [f, new Set(f.getCharacterSet())]));
	/**
	 * Text a font can draw: control and format characters (bidi overrides
	 * among them, which could turn text around) go, a letter the font lacks
	 * becomes "?". Line breaks stay.
	 *
	 * @param {string} text @param {import('pdf-lib').PDFFont} font
	 */
	function clean(text, font) {
		const has = /** @type {Set<number>} */ (charsets.get(font));
		return String(text)
			.replace(/\r\n?/g, '\n')
			.replace(/\t/g, ' ')
			.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? c : ''))
			.replace(/[^\n]/gu, (c) => (has.has(/** @type {number} */ (c.codePointAt(0))) ? c : '?'));
	}

	/** @param {string} text @param {import('pdf-lib').PDFFont} font @param {number} size @param {number} max */
	function wrap(text, font, size, max) {
		const lines = [];
		for (const para of clean(text, font).split('\n')) {
			let line = '';
			for (const word of para.split(/\s+/).filter(Boolean)) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= max) line = next;
				else {
					if (line) lines.push(line);
					// a word wider than the column (a hash, an implicit account): break it anywhere
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
	}

	/** @param {string} text @param {{ x?: number, size?: number, font?: import('pdf-lib').PDFFont, color?: any, max?: number, lead?: number }} [o] */
	function text(text, o = {}) {
		const { x = M, size = 9.5, font = regular, color = rgb(0, 0, 0), max = width - (x - M), lead = 1.35 } = o;
		for (const l of wrap(text, font, size, max)) {
			ensure(size * lead);
			page.drawText(l, { x, y: y - size, size, font, color });
			y -= size * lead;
		}
	}

	function footer() {
		const s = 7;
		page.drawText(`${current} · Seite ${pageNo}`, { x: M, y: M / 2, size: s, font: regular, color: GREY });
		const right = 'Daten: NearBlocks.io APIs · Kurse: siehe Kursquelle';
		page.drawText(right, { x: A4[0] - M - regular.widthOfTextAtSize(right, s), y: M / 2, size: s, font: regular, color: GREY });
	}

	/** @param {number} h */
	function ensure(h) {
		if (y - h >= M + 14) return false;
		footer();
		page = pdf.addPage(A4);
		pageNo++;
		y = A4[1] - M;
		return true;
	}

	function gap(/** @type {number} */ h) {
		y -= h;
	}

	function rule() {
		page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: RULE });
	}

	/** A QR code of `value`, `side` points wide, its top left at (x, top). */
	function qr(value, x, top, side) {
		const code = encode(value, { border: 0 });
		const cell = side / code.size;
		code.data.forEach((row, r) => {
			// runs of dark cells as one rectangle each
			for (let c = 0; c < row.length; c++) {
				if (!row[c]) continue;
				let n = 1;
				while (row[c + n]) n++;
				page.drawRectangle({ x: x + c * cell, y: top - (r + 1) * cell, width: n * cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
				c += n - 1;
			}
		});
	}

	/** A label and its value side by side. @param {string} label @param {string} value @param {{ font?: any, size?: number, max?: number }} [o] */
	function field(label, value, o = {}) {
		const LW = 92;
		const top = y;
		text(label, { font: bold, size: 8, color: GREY, max: LW - 6 });
		const after = y;
		y = top;
		text(value || '—', { x: M + LW, font: o.font ?? regular, size: o.size ?? 8.5, max: (o.max ?? width) - LW });
		y = Math.min(y, after);
	}

	function head(/** @type {string} */ number, /** @type {string} */ subtitle) {
		current = number;
		if (doc.testnet) {
			text('TESTNET – keine echte Zahlung. Kurse des Mainnet-Assets nur zur Veranschaulichung; dieser Beleg ist kein Buchungsbeleg.', { font: bold, size: 9, color: WARN });
			gap(4);
		}
		text('Eigenbeleg', { font: bold, size: 20 });
		text(`Nr. ${number}`, { font: bold, size: 12 });
		gap(2);
		text(subtitle, { size: 10 });
		gap(10);
		// payer | issue data, two columns
		const top = y;
		text('Zahlender und Aussteller', { font: bold, size: 8.5, color: GREY, max: width / 2 - 10 });
		text(doc.payer.name, { font: bold, size: 10, max: width / 2 - 10 });
		text(doc.payer.address, { size: 9.5, max: width / 2 - 10 });
		const leftEnd = y;
		y = top;
		const rx = M + width / 2 + 10;
		text('Ausgestellt am', { x: rx, font: bold, size: 8.5, color: GREY });
		text(`${deDate(doc.issuedAt)}, ${doc.issuedAt.slice(11, 16)} UTC`, { x: rx });
		gap(3);
		text('Empfänger', { x: rx, font: bold, size: 8.5, color: GREY });
		text(`${doc.chainName}: Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation`, { x: rx });
		y = Math.min(y, leftEnd);
		gap(8);
		text(doc.payer.addresses.length > 1 ? 'Eigene Zahlungsadressen' : 'Eigene Zahlungsadresse', { font: bold, size: 8.5, color: GREY });
		for (const a of doc.payer.addresses) text(a, { font: mono, size: 8 });
		gap(10);
		// the note, in a box
		const lines = wrap(doc.note, regular, 9, width - 16);
		const h = lines.length * 9 * 1.35 + 14;
		ensure(h);
		page.drawRectangle({ x: M, y: y - h, width, height: h, color: TINT, borderColor: RULE, borderWidth: 0.6 });
		y -= 7;
		for (const l of lines) {
			page.drawText(l, { x: M + 8, y: y - 9, size: 9, font: regular });
			y -= 9 * 1.35;
		}
		y -= 7;
		gap(12);
	}

	/**
	 * One transaction: hash, who paid whom with full addresses, its QR code,
	 * and every movement it had, the ones not on the Eigenbeleg with the reason.
	 *
	 * @param {import('./document.js').Transaction} t @param {{ big?: boolean }} [o]
	 */
	function transaction(t, { big = false } = {}) {
		const side = big ? 96 : 58;
		const textMax = width - side - 12;
		ensure(big ? 150 : 120);
		const top = y;
		const title = `${big ? 'Zahlung' : `Position ${t.pos}`} · ${deDate(t.time)} ${t.time.slice(11, 19)} UTC`;
		text(title, { font: bold, size: 9.5, max: textMax });
		gap(2);
		field('Transaktion', t.hash, { font: mono, size: 7.5, max: textMax });
		field('Von', `${t.from.address} (${t.from.label})`, { font: mono, size: 7.5, max: textMax });
		field('An', t.to.label ? `${t.to.address} (${t.to.label})` : t.to.address, { font: mono, size: 7.5, max: textMax });
		field('Block-Explorer', t.explorerUrl, { font: mono, size: 6.5, max: textMax });
		const qrTop = top - 2;
		qr(t.explorerUrl, A4[0] - M - side, qrTop, side);
		y = Math.min(y, qrTop - side - 4);
		gap(3);
		// movements
		const cols = [
			{ t: 'Bewegung', w: 150, a: 'l' },
			{ t: 'Menge', w: 118, a: 'r' },
			{ t: 'Kurs EUR', w: 52, a: 'r' },
			{ t: 'Wert EUR', w: 66, a: 'r' },
			{ t: 'Auf dem Beleg', w: width - 386, a: 'l' }
		];
		const row = (/** @type {string[]} */ cells, /** @type {any} */ font, /** @type {any} */ color) => {
			const wrapped = cols.map((c, i) => wrap(cells[i], font, 7.5, c.w - 6));
			const h = Math.max(...wrapped.map((l) => l.length)) * 9.5 + 2;
			ensure(h);
			let x = M;
			cols.forEach((c, i) => {
				wrapped[i].forEach((l, j) => {
					const tw = font.widthOfTextAtSize(l, 7.5);
					page.drawText(l, { x: c.a === 'r' ? x + c.w - 6 - tw : x, y: y - 7.5 - j * 9.5, size: 7.5, font, color });
				});
				x += c.w;
			});
			y -= h;
		};
		row(cols.map((c) => c.t), bold, GREY);
		for (const m of t.movements) {
			const e = m.entry;
			row(
				[
					`${m.what}${e.type === 'received' ? ' (Eingang)' : ''}`,
					`${deNumber(e.amount)} ${e.asset}`,
					e.eur ? deNumber(e.eur.rate) : '—',
					e.eur ? deEuro(e.eur.value, 4) : '—',
					m.onIt ? 'ja' : `nein – ${m.why}`
				],
				regular,
				m.onIt ? rgb(0, 0, 0) : GREY
			);
		}
		const sumText = `Auf dem Beleg: ${deEuro(t.eurExact, 4)}`;
		ensure(12);
		page.drawText(sumText, { x: A4[0] - M - bold.widthOfTextAtSize(sumText, 8.5), y: y - 9, size: 8.5, font: bold });
		y -= 14;
	}

	function sourcesAndSignature(/** @type {{ why: string }[]} */ excluded, /** @type {string[]} */ sources) {
		gap(6);
		text('Kursquelle', { font: bold, size: 8.5, color: GREY });
		text(sources.length ? `${sources.join('; ')} – jeweils für den Tag der Zahlung (UTC).` : '—', { size: 8.5 });
		gap(6);
		if (excluded.length) {
			text('Nicht auf diesem Eigenbeleg', { font: bold, size: 8.5, color: GREY });
			/** @type {Record<string, number>} */
			const why = {};
			for (const x of excluded) why[x.why] = (why[x.why] ?? 0) + 1;
			for (const [w, n] of Object.entries(why)) text(`${n} × ${w}`, { size: 8.5 });
			text('Alle Bewegungen des Zeitraums stehen in der CSV-Datei zu diesem Eigenbeleg.', { size: 8.5, color: GREY });
			gap(6);
		}
		text(doc.notInvoice, { size: 8.5, color: GREY });
		gap(24);
		ensure(40);
		page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.6, color: rgb(0, 0, 0) });
		y -= 4;
		text('Ort, Datum, Unterschrift des Zahlenden', { size: 8, color: GREY });
	}

	const sourcesOf = (/** @type {import('./document.js').Transaction[]} */ ts) => [
		...new Set(ts.flatMap((t) => t.movements.filter((m) => m.onIt).map((m) => /** @type {any} */ (m.entry.eur).source.replace(/ \d{4}-\d{2}-\d{2}.*$/, ''))))
	];
	const period = `${deDate(doc.period.from)} – ${deDate(doc.period.to)}`;

	if (doc.layout === 'single' && doc.transactions.length > 0) {
		doc.transactions.forEach((t, i) => {
			if (i > 0) {
				footer();
				page = pdf.addPage(A4);
				pageNo = 1;
				y = A4[1] - M;
			}
			head(t.number, `Eigenbeleg für eine Zahlung auf ${doc.chainName} (${doc.network}) am ${deDate(t.time)}`);
			transaction(t, { big: true });
			const what = [...new Set(t.movements.filter((m) => m.onIt).map((m) => m.what))].join(', ');
			ensure(40);
			const total = deEuro(t.eurExact, 2);
			page.drawText('Betrag', { x: M, y: y - 10, size: 10, font: bold });
			page.drawText(total, { x: A4[0] - M - bold.widthOfTextAtSize(total, 11), y: y - 10, size: 11, font: bold });
			y -= 16;
			if (round(t.eurExact, 2) === '0' && t.eurExact !== '0') text(`Ungerundet ${deEuro(t.eurExact, 8)} (unter einem Cent).`, { size: 8, color: GREY });
			gap(4);
			field('Was wurde bezahlt', `${what} an ${t.to.label || t.to.address}`);
			field('Warum kein Fremdbeleg', 'Der Empfänger ist ein Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation; es stellt keine Rechnung aus.');
			sourcesAndSignature([], sourcesOf([t]));
		});
	} else {
		head(doc.number, `Sammel-Eigenbeleg für Zahlungen auf ${doc.chainName} (${doc.network}), Zeitraum ${period}`);
		if (doc.transactions.length === 0) {
			text('Keine Zahlungen an das Netzwerk in diesem Zeitraum.', { size: 10 });
		} else {
			for (const t of doc.transactions) {
				transaction(t);
				rule();
				gap(8);
			}
			// totals
			ensure(40);
			const qty = Object.entries(doc.totals.quantities)
				.map(([a, q]) => `${deNumber(q)} ${a}`)
				.join(', ');
			const n = doc.transactions.length;
			const label = `Summe (${n} ${n === 1 ? 'Position' : 'Positionen'}): ${qty}`;
			page.drawText(label, { x: M, y: y - 10, size: 10, font: bold });
			const total = deEuro(doc.totals.eur, 2);
			page.drawText(total, { x: A4[0] - M - bold.widthOfTextAtSize(total, 11), y: y - 10, size: 11, font: bold });
			y -= 16;
			const exact = /^0(\.0*)?$/.test(round(doc.totals.eurExact, 4)) ? deEuro(doc.totals.eurExact, 8) : deEuro(doc.totals.eurExact, 4);
			const subCent = doc.totals.eur === '0' && doc.totals.eurExact !== '0';
			text(`Ungerundet ${exact}${subCent ? ' (unter einem Cent)' : ''}; jede Position zum Tageskurs ihres Zahlungstages.`, { size: 8, color: GREY });
		}
		gap(4);
		sourcesAndSignature(doc.excluded, doc.sources);
	}
	footer();

	await makePdfA(pdf, { title, author: doc.payer.name, subject, producer, created, seed: `${doc.number}|${doc.issuedAt}|${doc.payer.name}` });
	return pdf.save({ useObjectStreams: false });
}

/** @param {string} s */
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Turns the document into PDF/A-2b: XMP metadata, an sRGB output intent and
 * a document id.
 *
 * @param {PDFDocument} pdf
 * @param {{ title: string, author: string, subject: string, producer: string, created: Date, seed: string }} m
 */
export async function makePdfA(pdf, { title, author, subject, producer, created, seed }) {
	const ctx = pdf.context;
	// Dates as the Info dictionary has them (pdf-lib writes UTC with Z).
	const date = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const meta = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xml(author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>eigenbeleg</xmp:CreatorTool>
   <xmp:CreateDate>${date}</xmp:CreateDate>
   <xmp:ModifyDate>${date}</xmp:ModifyDate>
   <xmp:MetadataDate>${date}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xml(producer)}</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
	const metaStream = ctx.stream(new TextEncoder().encode(meta), { Type: 'Metadata', Subtype: 'XML' });
	pdf.catalog.set(PDFName.of('Metadata'), ctx.register(metaStream));

	const icc = await asset('sRGB-v2-micro.icc');
	const iccStream = ctx.stream(icc, { N: 3 });
	const intent = ctx.obj({
		Type: 'OutputIntent',
		S: 'GTS_PDFA1',
		OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
		Info: PDFString.of('sRGB IEC61966-2.1'),
		DestOutputProfile: ctx.register(iccStream)
	});
	pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));

	const id = toHex(sha256(utf8(seed))).slice(0, 32);
	ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}

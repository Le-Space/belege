// SPDX-License-Identifier: AGPL-3.0-or-later
// Draws the Eigenbeleg of one booking (booking.js) as an A4 PDF/A-2b in
// Eigenbeleg's layout (layout.js), with text in any script (@le-space/pdf):
// the head with the number, issuer and date, the note, the payment, an own
// wallet's transaction in full with its explorer link as a QR code, the
// amount, what was paid and why there is no receipt from the other side, and
// a line to sign.
//
// The text is German: the document is for German bookkeeping.

import { createPdfA, savePdfA } from '@le-space/pdf';
import { fromUnits } from '@le-space/ledger';

import { bookingNote, bookingNotInvoice } from './booking.js';
import { deDate, deEuro, deNumber } from './document.js';
import { A4, BLACK, GREY, pageLayout } from './layout.js';

/**
 * @param {import('./booking.js').BookingEigenbeleg} doc
 * @param {{ creator?: string, producer?: string }} [o] what made it: `Belege` when not given
 * @returns {Promise<Uint8Array>}
 */
export async function bookingPdf(doc, { creator = 'Belege', producer } = {}) {
	const created = new Date(doc.createdAt);
	const { pdf, fonts } = await createPdfA();
	const { regular, bold, mono } = fonts;
	const M = 48;
	let pageNo = 1;
	const footer = (/** @type {import('./layout.js').Layout} */ l) =>
		regular.draw(l.page, `${doc.number} · Seite ${pageNo}`, {
			x: M,
			y: M / 2,
			size: 7,
			color: GREY
		});
	const l = pageLayout(pdf, fonts, {
		margin: M,
		leavePage: footer,
		enterPage: () => {
			pageNo++;
		}
	});
	const { text, gap, field } = l;
	const width = l.width;
	const out = doc.amountCents < 0;

	// ---- head
	text('Eigenbeleg', { face: bold, size: 20 });
	text(`Nr. ${doc.number}`, { face: bold, size: 12 });
	gap(2);
	text('Beleg für eine Zahlung, zu der es keinen Beleg der Gegenseite gibt.', { size: 10 });
	gap(10);
	const top = l.y;
	const half = width / 2 - 10;
	text('Aussteller', { face: bold, size: 8.5, color: GREY, max: half });
	text(doc.issuer || '—', { face: bold, size: 10, max: half });
	if (doc.issuerAddress) text(doc.issuerAddress, { size: 9.5, max: half });
	const leftEnd = l.y;
	l.y = top;
	const rx = M + width / 2 + 10;
	text('Ausgestellt am', { x: rx, face: bold, size: 8.5, color: GREY });
	text(`${deDate(doc.createdAt)}, ${doc.createdAt.slice(11, 16)} UTC`, { x: rx });
	gap(3);
	text(out ? 'Empfänger' : 'Zahlende Seite', { x: rx, face: bold, size: 8.5, color: GREY });
	text(doc.counterparty || '—', { x: rx });
	l.y = Math.min(l.y, leftEnd);
	gap(8);
	text('Konto', { face: bold, size: 8.5, color: GREY });
	text(doc.account || '—', { size: 9.5 });
	gap(10);
	l.box(bookingNote(Boolean(doc.chain)));
	gap(12);

	// ---- the payment
	field('Datum der Zahlung', deDate(doc.date));
	if (doc.purpose && doc.purpose !== doc.description) field('Verwendungszweck', doc.purpose);
	if (doc.crypto) {
		const c = doc.crypto;
		field('Menge', `${deNumber(fromUnits(c.quantity, c.decimals))} ${c.asset}`);
		field(
			'Kurs',
			`${deNumber(c.rate)} EUR je ${c.asset} · ${c.source}${c.at ? `, ${deDate(c.at)}` : ''}`
		);
	}
	gap(8);

	if (doc.chain) {
		const c = doc.chain;
		const side = 96;
		const textMax = width - side - 12;
		l.ensure(150);
		l.rule();
		gap(8);
		const qrTop = l.y;
		text(`Zahlung auf ${c.chain}${c.at ? ` · ${deDate(c.at)} ${c.at.slice(11, 19)} UTC` : ''}`, {
			face: bold,
			size: 9.5,
			max: textMax
		});
		gap(2);
		/** @param {import('./booking.js').Party} p */
		const party = (p) => {
			const note = [p.label, p.own ? 'eigene Wallet' : ''].filter(Boolean).join(', ');
			if (!p.address) return note || '—';
			return note && p.address !== p.label ? `${p.address} (${note})` : p.address;
		};
		field('Transaktion', c.hash, { face: mono, size: 7.5, max: textMax });
		field('Von', party(c.from), { face: mono, size: 7.5, max: textMax });
		field('An', party(c.to), { face: mono, size: 7.5, max: textMax });
		if (c.explorerUrl) {
			field('Block-Explorer', c.explorerUrl, { face: mono, size: 6.5, max: textMax });
			l.qr(c.explorerUrl, A4[0] - M - side, qrTop, side);
			l.y = Math.min(l.y, qrTop - side - 4);
		}
		gap(3);
		const columns = [
			{ title: 'Bewegung', width: 170 },
			{ title: 'Menge', width: 150, right: true },
			{ title: 'Wert EUR', width: 90, right: true },
			{ title: 'Gebucht', width: width - 410 }
		];
		const header = () =>
			l.row(
				columns,
				columns.map((x) => x.title),
				{ face: bold, color: GREY }
			);
		header();
		for (const m of c.movements)
			l.row(columns, [m.what, m.quantity || '—', m.euro || '—', m.booked ? 'ja' : 'nein'], {
				color: m.booked ? BLACK : GREY,
				header
			});
		gap(6);
	} else if (doc.txRef) field('Referenz', doc.txRef, { face: mono, size: 7.5 });

	// ---- the amount, what and why
	l.ensure(40);
	l.rule();
	gap(8);
	l.at('Betrag', M, 10, bold);
	l.right(deEuro(fromUnits(String(doc.amountCents), 2), 2), A4[0] - M, 11, bold);
	l.y -= 18;
	field('Was wurde bezahlt', doc.description);
	field('Warum kein Fremdbeleg', doc.reason);
	field('Erstellt', `${deDate(doc.createdAt)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`);

	// ---- what it is not, and the line to sign
	gap(8);
	text(bookingNotInvoice(creator), { size: 8.5, color: GREY });
	gap(24);
	l.ensure(40);
	l.page.drawLine({
		start: { x: M, y: l.y },
		end: { x: M + 230, y: l.y },
		thickness: 0.6,
		color: BLACK
	});
	l.y -= 4;
	text('Ort, Datum, Unterschrift', { size: 8, color: GREY });
	footer(l);

	return savePdfA(pdf, {
		title: `Eigenbeleg ${doc.number}`,
		author: doc.issuer,
		subject: `Eigenbeleg für eine Zahlung am ${deDate(doc.date)}`,
		creator,
		...(producer ? { producer } : {}),
		created,
		seed: `${doc.number}|${doc.createdAt}|${doc.issuer}`
	});
}

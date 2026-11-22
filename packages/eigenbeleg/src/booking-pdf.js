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
import { A4, BLACK, GREY, TYPE, embedIssuerLogo, pageLayout } from './layout.js';

/**
 * @param {import('./booking.js').BookingEigenbeleg} doc
 * @param {{ creator?: string, producer?: string, issuerLogo?: Uint8Array | null }} [o] what made it: `Belege` when not given. issuerLogo: the issuer's own
 *   logo, a PNG or JPEG file's bytes, large as a letterhead: top right, the text below it (none unless given; an
 *   ImageError of @le-space/pdf when the file is no small PNG or JPEG)
 * @returns {Promise<Uint8Array>}
 */
export async function bookingPdf(doc, { creator = 'Belege', producer, issuerLogo = null } = {}) {
	const created = new Date(doc.createdAt);
	const { pdf, fonts } = await createPdfA();
	const { bold, mono } = fonts;
	const own = await embedIssuerLogo(pdf, issuerLogo);
	const M = 48;
	let pageNo = 1;
	const footer = (/** @type {import('./layout.js').Layout} */ l) =>
		l.foot(l.page, `${doc.number} · Seite ${pageNo}`);
	const l = pageLayout(pdf, fonts, {
		margin: M,
		leavePage: footer,
		enterPage: () => {
			pageNo++;
		}
	});
	const { text, gap, field, label } = l;
	const width = l.width;
	const out = doc.amountCents < 0;

	// ---- head
	l.letterhead(own);
	l.head('Eigenbeleg', {
		number: doc.number,
		subtitle: 'Beleg für eine Zahlung, zu der es keinen Beleg der Gegenseite gibt.'
	});
	const top = l.y;
	const half = width / 2 - 10;
	label('Aussteller', { max: half });
	text(doc.issuer || '—', { face: bold, size: TYPE.lead, max: half });
	if (doc.issuerAddress) text(doc.issuerAddress, { max: half });
	const leftEnd = l.y;
	l.y = top;
	const rx = M + width / 2 + 10;
	label('Ausgestellt am', { x: rx });
	text(`${deDate(doc.createdAt)}, ${doc.createdAt.slice(11, 16)} UTC`, { x: rx });
	gap(5);
	label(out ? 'Empfänger' : 'Zahlende Seite', { x: rx });
	text(doc.counterparty || '—', { x: rx });
	l.y = Math.min(l.y, leftEnd);
	gap(8);
	label('Konto');
	text(doc.account || '—');
	gap(12);
	l.note(bookingNote(Boolean(doc.chain)));
	gap(16);

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
		const side = 72;
		const textMax = width - side - 16;
		l.ensure(150);
		l.rule();
		gap(10);
		const qrTop = l.y;
		text(`Zahlung auf ${c.chain}${c.at ? ` · ${deDate(c.at)} ${c.at.slice(11, 19)} UTC` : ''}`, {
			face: bold,
			size: TYPE.lead,
			max: textMax
		});
		gap(3);
		/** @param {import('./booking.js').Party} p */
		const party = (p) => {
			const note = [p.label, p.own ? 'eigene Wallet' : ''].filter(Boolean).join(', ');
			if (!p.address) return note || '—';
			return note && p.address !== p.label ? `${p.address} (${note})` : p.address;
		};
		const hash = { face: mono, size: TYPE.small, max: textMax, labelWidth: 76 };
		field('Transaktion', c.hash, hash);
		field('Von', party(c.from), hash);
		field('An', party(c.to), hash);
		if (c.explorerUrl) {
			field('Block-Explorer', c.explorerUrl, { ...hash, size: TYPE.label });
			l.qr(c.explorerUrl, A4[0] - M - side, qrTop, side);
			l.y = Math.min(l.y, qrTop - side);
		}
		gap(10);
		const columns = [
			{ title: 'Bewegung', width: 170 },
			{ title: 'Menge', width: 150, right: true },
			{ title: 'Wert EUR', width: 90, right: true },
			{ title: 'Gebucht', width: width - 410 }
		];
		const header = () => l.tableHead(columns);
		header();
		for (const m of c.movements)
			l.row(columns, [m.what, m.quantity || '—', m.euro || '—', m.booked ? 'ja' : 'nein'], {
				color: m.booked ? BLACK : GREY,
				header
			});
		gap(12);
	} else if (doc.txRef) field('Referenz', doc.txRef, { face: mono, size: TYPE.small });

	// ---- the amount, what and why
	l.total('Betrag', deEuro(fromUnits(String(doc.amountCents), 2), 2));
	field('Was wurde bezahlt', doc.description);
	gap(2);
	field('Warum kein Fremdbeleg', doc.reason);
	gap(2);
	field('Erstellt', `${deDate(doc.createdAt)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`);

	// ---- what it is not, and the line to sign
	gap(8);
	text(bookingNotInvoice(creator), { size: TYPE.table, color: GREY });
	l.signature('Ort, Datum, Unterschrift');
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

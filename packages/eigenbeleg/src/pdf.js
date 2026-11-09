// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg of a period as an A4 PDF/A-2b (@le-space/pdf): fonts
// embedded as subsets, text in any script, an sRGB output intent, XMP
// metadata that matches the document info, and a document id. PDF/A is what
// an archive for bookkeeping records expects.
//
// The text is German: the document is for German bookkeeping.

import { asset, createPdfA, LOGOS, savePdfA } from '@le-space/pdf';
import { round } from '@le-space/ledger';

import { DATA_SOURCES, deDate, deEuro, deNumber, noInvoice } from './document.js';
import { A4, BLACK, GREY, WARN, pageLayout } from './layout.js';

/** What made the file, unless the caller says otherwise. */
export const CREATOR = 'eigenbeleg';
export const PRODUCER = 'eigenbeleg (Le Space UG), pdf-lib';

/**
 * @param {import('./document.js').EigenbelegDocument} doc
 * @param {{ creator?: string, producer?: string, logo?: boolean }} [o] logo: the chain's
 *   mark, small, beside the title (off unless asked for; @le-space/pdf's LOGOS)
 * @returns {Promise<Uint8Array>}
 */
export async function eigenbelegPdf(
	doc,
	{ creator = CREATOR, producer = PRODUCER, logo = false } = {}
) {
	const created = new Date(doc.issuedAt);
	const title = `Eigenbeleg ${doc.number}`;
	const subject = `${doc.layout === 'single' ? 'Eigenbelege' : 'Sammel-Eigenbeleg'} ${doc.chainName}, ${deDate(doc.period.from)} – ${deDate(doc.period.to)}`;
	const { pdf, fonts } = await createPdfA();
	const { regular, bold, mono } = fonts;
	const mark =
		logo && Object.hasOwn(LOGOS, doc.chain)
			? await pdf.embedPng(await asset(LOGOS[doc.chain]))
			: null;
	const M = 48;
	let pageNo = 1;
	let current = doc.number;
	const footerRight = `Daten: ${DATA_SOURCES[doc.chain] ?? doc.chainName} · Kurse: siehe Kursquelle`;

	const footer = (/** @type {import('./layout.js').Layout} */ l) => {
		const s = 7;
		regular.draw(l.page, `${current} · Seite ${pageNo}`, { x: M, y: M / 2, size: s, color: GREY });
		regular.draw(l.page, footerRight, {
			x: A4[0] - M - regular.width(footerRight, s),
			y: M / 2,
			size: s,
			color: GREY
		});
	};
	const l = pageLayout(pdf, fonts, {
		margin: M,
		leavePage: footer,
		enterPage: () => {
			pageNo++;
		}
	});
	const { text, gap, field, title: heading } = l;
	const width = l.width;

	/** @param {string} number @param {string} subtitle */
	function head(number, subtitle) {
		current = number;
		if (doc.testnet) {
			text(
				'TESTNET – keine echte Zahlung. Kurse des Mainnet-Assets nur zur Veranschaulichung; dieser Beleg ist kein Buchungsbeleg.',
				{ face: bold, size: 9, color: WARN }
			);
			gap(4);
		}
		heading('Eigenbeleg', { face: bold, size: 20 }, mark);
		text(`Nr. ${number}`, { face: bold, size: 12 });
		gap(2);
		text(subtitle, { size: 10 });
		gap(10);
		// payer | issue data, two columns
		const top = l.y;
		text('Zahlender und Aussteller', { face: bold, size: 8.5, color: GREY, max: width / 2 - 10 });
		text(doc.payer.name, { face: bold, size: 10, max: width / 2 - 10 });
		text(doc.payer.address, { size: 9.5, max: width / 2 - 10 });
		const leftEnd = l.y;
		l.y = top;
		const rx = M + width / 2 + 10;
		text('Ausgestellt am', { x: rx, face: bold, size: 8.5, color: GREY });
		text(`${deDate(doc.issuedAt)}, ${doc.issuedAt.slice(11, 16)} UTC`, { x: rx });
		gap(3);
		text('Empfänger', { x: rx, face: bold, size: 8.5, color: GREY });
		text(noInvoice(doc.chain, doc.chainName).recipient, { x: rx });
		l.y = Math.min(l.y, leftEnd);
		gap(8);
		text(doc.payer.addresses.length > 1 ? 'Eigene Zahlungsadressen' : 'Eigene Zahlungsadresse', {
			face: bold,
			size: 8.5,
			color: GREY
		});
		for (const a of doc.payer.addresses) text(a, { face: mono, size: 8 });
		gap(10);
		l.box(doc.note);
		gap(12);
	}

	const columns = [
		{ title: 'Bewegung', width: 150 },
		{ title: 'Menge', width: 118, right: true },
		{ title: 'Kurs EUR', width: 52, right: true },
		{ title: 'Wert EUR', width: 66, right: true },
		{ title: 'Auf dem Beleg', width: width - 386 }
	];

	/**
	 * One transaction: hash, who paid whom with full addresses, its QR code,
	 * and every movement it had, the ones not on the Eigenbeleg with the reason.
	 *
	 * @param {import('./document.js').Transaction} t @param {{ big?: boolean }} [o]
	 */
	function transaction(t, { big = false } = {}) {
		const side = big ? 96 : 58;
		const textMax = width - side - 12;
		l.ensure(big ? 150 : 120);
		const top = l.y;
		const title = `${big ? 'Zahlung' : `Position ${t.pos}`} · ${deDate(t.time)} ${t.time.slice(11, 19)} UTC`;
		text(title, { face: bold, size: 9.5, max: textMax });
		gap(2);
		field('Transaktion', t.hash, { face: mono, size: 7.5, max: textMax });
		field('Von', `${t.from.address} (${t.from.label})`, { face: mono, size: 7.5, max: textMax });
		field('An', t.to.label ? `${t.to.address} (${t.to.label})` : t.to.address, {
			face: mono,
			size: 7.5,
			max: textMax
		});
		field('Block-Explorer', t.explorerUrl, { face: mono, size: 6.5, max: textMax });
		const qrTop = top - 2;
		l.qr(t.explorerUrl, A4[0] - M - side, qrTop, side);
		l.y = Math.min(l.y, qrTop - side - 4);
		gap(3);
		l.row(
			columns,
			columns.map((c) => c.title),
			{ face: bold, color: GREY }
		);
		for (const m of t.movements) {
			const e = m.entry;
			l.row(
				columns,
				[
					`${m.what}${e.type === 'received' ? ' (Eingang)' : ''}`,
					`${deNumber(e.amount)} ${e.asset}`,
					e.eur ? deNumber(e.eur.rate) : '—',
					e.eur ? deEuro(e.eur.value, 4) : '—',
					m.onIt ? 'ja' : `nein – ${m.why}`
				],
				{ color: m.onIt ? BLACK : GREY }
			);
		}
		l.ensure(12);
		l.right(`Auf dem Beleg: ${deEuro(t.eurExact, 4)}`, A4[0] - M, 8.5, bold);
		l.y -= 14;
	}

	/** @param {{ why: string }[]} excluded @param {string[]} sources */
	function sourcesAndSignature(excluded, sources) {
		gap(6);
		text('Kursquelle', { face: bold, size: 8.5, color: GREY });
		text(sources.length ? `${sources.join('; ')} – jeweils für den Tag der Zahlung (UTC).` : '—', {
			size: 8.5
		});
		gap(6);
		if (excluded.length) {
			text('Nicht auf diesem Eigenbeleg', { face: bold, size: 8.5, color: GREY });
			/** @type {Record<string, number>} */
			const why = {};
			for (const x of excluded) why[x.why] = (why[x.why] ?? 0) + 1;
			for (const [w, n] of Object.entries(why)) text(`${n} × ${w}`, { size: 8.5 });
			text('Alle Bewegungen des Zeitraums stehen in der CSV-Datei zu diesem Eigenbeleg.', {
				size: 8.5,
				color: GREY
			});
			gap(6);
		}
		text(doc.notInvoice, { size: 8.5, color: GREY });
		gap(24);
		l.ensure(40);
		l.page.drawLine({
			start: { x: M, y: l.y },
			end: { x: M + 230, y: l.y },
			thickness: 0.6,
			color: BLACK
		});
		l.y -= 4;
		text('Ort, Datum, Unterschrift des Zahlenden', { size: 8, color: GREY });
	}

	/** @param {import('./document.js').Transaction[]} ts */
	const sourcesOf = (ts) => [
		...new Set(
			ts.flatMap((t) =>
				t.movements
					.filter((m) => m.onIt)
					.map((m) =>
						/** @type {any} */ (m.entry.eur).source
							.replace(/ \d{4}-\d{2}-\d{2}.*$/, '')
							.replace(/ vom$/, '')
					)
			)
		)
	];
	/** The amount line: a label on the left, the euro amount on the right. @param {string} label @param {string} total */
	const amountLine = (label, total) => {
		l.ensure(40);
		l.at(label, M, 10, bold);
		l.right(total, A4[0] - M, 11, bold);
		l.y -= 16;
	};
	const period = `${deDate(doc.period.from)} – ${deDate(doc.period.to)}`;

	if (doc.layout === 'single' && doc.transactions.length > 0) {
		doc.transactions.forEach((t, i) => {
			if (i > 0) {
				// Each Eigenbeleg starts on a page of its own, counted from 1.
				footer(l);
				l.page = pdf.addPage(A4);
				l.pages.push(l.page);
				pageNo = 1;
				l.y = A4[1] - M;
			}
			head(
				t.number,
				`Eigenbeleg für eine Zahlung auf ${doc.chainName} (${doc.network}) am ${deDate(t.time)}`
			);
			transaction(t, { big: true });
			const what = [...new Set(t.movements.filter((m) => m.onIt).map((m) => m.what))].join(', ');
			amountLine('Betrag', deEuro(t.eurExact, 2));
			if (round(t.eurExact, 2) === '0' && t.eurExact !== '0')
				text(`Ungerundet ${deEuro(t.eurExact, 8)} (unter einem Cent).`, { size: 8, color: GREY });
			gap(4);
			field('Was wurde bezahlt', `${what} an ${t.to.label || t.to.address}`);
			field('Warum kein Fremdbeleg', noInvoice(doc.chain, doc.chainName).why);
			sourcesAndSignature([], sourcesOf([t]));
		});
	} else {
		head(
			doc.number,
			`Sammel-Eigenbeleg für Zahlungen auf ${doc.chainName} (${doc.network}), Zeitraum ${period}`
		);
		if (doc.transactions.length === 0) {
			text('Keine Zahlungen an das Netzwerk in diesem Zeitraum.', { size: 10 });
		} else {
			for (const t of doc.transactions) {
				transaction(t);
				l.rule();
				gap(8);
			}
			const qty = Object.entries(doc.totals.quantities)
				.map(([a, q]) => `${deNumber(q)} ${a}`)
				.join(', ');
			const n = doc.transactions.length;
			amountLine(
				`Summe (${n} ${n === 1 ? 'Position' : 'Positionen'}): ${qty}`,
				deEuro(doc.totals.eur, 2)
			);
			const exact = /^0(\.0*)?$/.test(round(doc.totals.eurExact, 4))
				? deEuro(doc.totals.eurExact, 8)
				: deEuro(doc.totals.eurExact, 4);
			const subCent = doc.totals.eur === '0' && doc.totals.eurExact !== '0';
			text(
				`Ungerundet ${exact}${subCent ? ' (unter einem Cent)' : ''}; jede Position zum Tageskurs ihres Zahlungstages.`,
				{ size: 8, color: GREY }
			);
		}
		gap(4);
		sourcesAndSignature(doc.excluded, doc.sources);
	}
	footer(l);

	return savePdfA(pdf, {
		title,
		author: doc.payer.name,
		subject,
		creator,
		producer,
		created,
		seed: `${doc.number}|${doc.issuedAt}|${doc.payer.name}`
	});
}

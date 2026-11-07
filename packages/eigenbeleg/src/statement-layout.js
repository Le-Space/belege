// SPDX-License-Identifier: AGPL-3.0-or-later
// The layout of a statement Eigenbeleg (Belege's for Aleph and Akash, its
// travel statement): an A4 PDF/A-2b in Eigenbeleg's look (layout.js) – a head
// with the title, number, issuer and date, labelled fields, rules, headings,
// tables whose header repeats on a new page, and a line to sign; a running
// head on every further page and the page numbers at the foot. Pages as long
// as the content needs; text in any script (@le-space/pdf).
//
// Moved from Belege's app/src/lib/pdf/statement-layout.js; the same calls,
// now in Eigenbeleg's look and PDF/A.

import { createPdfA, savePdfA } from '@le-space/pdf';

import { deDate } from './document.js';
import { A4, BLACK, GREY, pageLayout } from './layout.js';

/** The label column of a field: wide enough for "Übernachtungspauschalen". */
const LABEL = 120;

/**
 * A new document and the means to fill it.
 *
 * @param {object} p
 * @param {string} p.title the PDF's title
 * @param {Date} p.created
 * @param {string} p.continuation printed on top of every further page
 * @param {string} [p.subject]
 * @param {string} [p.creator] what made it: `Belege` when not given
 */
export async function statementLayout({
	title,
	created,
	continuation,
	subject = '',
	creator = 'Belege'
}) {
	const { pdf, fonts } = await createPdfA();
	const { regular, bold, mono } = fonts;
	const M = 48;
	let number = '';
	let issuer = '';
	const l = pageLayout(pdf, fonts, {
		margin: M,
		enterPage: (p) => {
			p.at(continuation, M, 8, regular, GREY);
			p.y -= 20;
		}
	});
	const width = l.width;

	/**
	 * The title ("Eigenbeleg" unless another), its number, the issuer and the
	 * day it was made, a line under them.
	 *
	 * @param {string} no
	 * @param {string} by the issuer, '' when none is set
	 * @param {string} subtitle
	 * @param {string} [heading]
	 */
	function head(no, by, subtitle, heading = 'Eigenbeleg') {
		number = no;
		issuer = by;
		l.text(heading, { face: bold, size: 20 });
		l.text(`Nr. ${no}`, { face: bold, size: 12 });
		l.gap(2);
		l.text(subtitle, { size: 10 });
		l.gap(10);
		const top = l.y;
		const half = width / 2 - 10;
		l.text('Aussteller', { face: bold, size: 8.5, color: GREY, max: half });
		l.text(by || '—', { face: bold, size: 10, max: half });
		const leftEnd = l.y;
		l.y = top;
		const rx = M + width / 2 + 10;
		l.text('Erstellt am', { x: rx, face: bold, size: 8.5, color: GREY });
		l.text(`${deDate(created.toISOString())}, ${created.toISOString().slice(11, 16)} UTC`, {
			x: rx
		});
		l.y = Math.min(l.y, leftEnd);
		l.gap(8);
		rule();
	}

	/** @param {string} label @param {string} value @param {boolean | 'mono'} [style] */
	function field(label, value, style = false) {
		l.field(label, value, {
			face: style === 'mono' ? mono : style ? bold : regular,
			size: style === 'mono' ? 7.5 : 8.5,
			labelWidth: LABEL
		});
		l.gap(3);
	}

	function rule() {
		l.ensure(20);
		l.gap(2);
		l.rule();
		l.gap(10);
	}

	/** @param {string} t */
	function heading(t) {
		l.ensure(40);
		l.text(t, { face: bold, size: 10 });
		l.gap(3);
	}

	/**
	 * A table: columns by width and alignment; the header repeats on a new page.
	 *
	 * @param {import('./layout.js').Column[]} columns
	 * @param {string[][]} rows
	 */
	function table(columns, rows) {
		const header = () =>
			l.row(
				columns.map((c) => ({ ...c, mono: false })),
				columns.map((c) => c.title),
				{ face: bold, color: GREY }
			);
		l.ensure(30);
		header();
		for (const row of rows) l.row(columns, row, { header });
		l.gap(8);
	}

	function signature() {
		l.gap(24);
		l.ensure(40);
		l.page.drawLine({
			start: { x: M, y: l.y },
			end: { x: M + 230, y: l.y },
			thickness: 0.6,
			color: BLACK
		});
		l.y -= 4;
		l.text('Ort, Datum, Unterschrift', { size: 8, color: GREY });
	}

	async function save() {
		const n = l.pages.length;
		l.pages.forEach((p, i) => {
			const foot = `${number ? `${number} · ` : ''}Seite ${i + 1} von ${n}`;
			regular.draw(p, foot, { x: M, y: M / 2, size: 7, color: GREY });
			const made = `Erstellt mit ${creator}`;
			regular.draw(p, made, {
				x: A4[0] - M - regular.width(made, 7),
				y: M / 2,
				size: 7,
				color: GREY
			});
		});
		return savePdfA(pdf, {
			title,
			author: issuer,
			subject,
			creator,
			created,
			seed: `${number}|${created.toISOString()}|${title}`
		});
	}

	return { width, head, field, rule, heading, table, signature, save };
}

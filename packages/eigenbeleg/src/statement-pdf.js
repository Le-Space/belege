// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug as an A4 PDF/A-2b, laid out like a bank statement:
// holder and account in the head, per asset the opening balance, a table of
// bookings (date, text, debit, credit, running balance, EUR value), the
// closing balance with its check against the chain, and the sums a
// bookkeeper needs. German, for German bookkeeping. Aleph Cloud credits get
// the same layout titled »Verbrauchsauszug« (`st.title`).

import { rgb } from 'pdf-lib';
import { asset, createPdfA, LOGOS, savePdfA, wrapText } from '@le-space/pdf';
import { round } from '@le-space/ledger';

import { DATA_SOURCES, deDate, deEuro, deNumber } from './document.js';
import { CREATOR, PRODUCER } from './pdf.js';
import { isDust, reconciled } from './statement.js';
import { A4, BAND, BLACK, GREY, OK, RULE, WARN, pageLayout } from './layout.js';

const M = 44;
const DARK = { thickness: 0.8, color: rgb(0.2, 0.2, 0.2) };

const COLS = [
	{ title: 'Buchungstag', width: 52 },
	{ title: 'Vorgang', width: 175 },
	{ title: 'Soll', width: 72, right: true },
	{ title: 'Haben', width: 72, right: true },
	{ title: 'Saldo', width: 80, right: true },
	{ title: 'Wert EUR', width: 56, right: true }
];

/** Quantities in the table: at most 12 decimals, the CSV keeps them all. @param {string} q */
const qty = (q) => (q ? deNumber(round(q, 12)) : '');

/**
 * @param {import('./statement.js').Statement} st
 * @param {{ creator?: string, producer?: string, logo?: boolean }} [o] logo: the chain's
 *   mark, small, beside the title (off unless asked for; @le-space/pdf's LOGOS)
 * @returns {Promise<Uint8Array>}
 */
export async function statementPdf(
	st,
	{ creator = CREATOR, producer = PRODUCER, logo = false } = {}
) {
	const created = new Date(st.issuedAt);
	// Aleph credits: a Verbrauchsauszug in the same layout, valued by its own rule.
	const aleph = st.chain === 'aleph';
	const title = `${st.title} ${st.number}`;
	const subject = `${st.title} ${st.chainName} ${st.account}, ${deDate(st.period.from)} – ${deDate(st.period.to)}`;
	const { pdf, fonts } = await createPdfA();
	const { regular, bold, mono } = fonts;
	const mark =
		logo && Object.hasOwn(LOGOS, st.chain)
			? await pdf.embedPng(await asset(LOGOS[st.chain]))
			: null;
	const l = pageLayout(pdf, fonts, {
		margin: M,
		bottom: 16,
		enterPage: (p) => {
			p.at(`${st.title} ${st.number} · ${st.account}`, M, 8, regular, GREY);
			p.y -= 18;
		}
	});
	const { text } = l;
	const width = l.width;
	/** @param {number} y @param {{ thickness: number, color: import('pdf-lib').Color }} [o] */
	const line = (y, o = DARK) =>
		l.page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, ...o });

	// ---- head: like a bank's, with the holder's address window on the left
	if (st.testnet) {
		text('TESTNET – keine echten Werte. Kurse des Mainnet-Assets nur zur Veranschaulichung.', {
			face: bold,
			size: 8.5,
			color: WARN
		});
		l.y -= 4;
	}
	const top = l.y;
	text('Kontoinhaber', { face: bold, size: 7.5, color: GREY, max: 250 });
	text(st.holder.name, { face: bold, size: 10, max: 250 });
	text(st.holder.address, { size: 9.5, max: 250 });
	const leftEnd = l.y;
	l.y = top;
	const rx = M + 300;
	const facts = [
		// The label column is 72 pt wide: »Verbrauchsauszug« does not fit.
		[st.title === 'Kontoauszug' ? 'Kontoauszug' : 'Auszug-Nr.', st.number],
		['Zeitraum', `${deDate(st.period.from)} – ${deDate(st.period.to)}`],
		['Chain', `${st.chainName} (${st.network})`],
		['Erstellt am', `${deDate(st.issuedAt)}, ${st.issuedAt.slice(11, 16)} UTC`]
	];
	for (const [k, v] of facts) {
		bold.draw(l.page, k, { x: rx, y: l.y - 8.5, size: 8, color: GREY });
		regular.draw(l.page, v, { x: rx + 72, y: l.y - 8.5, size: 8.5 });
		l.y -= 12;
	}
	l.y = Math.min(l.y, leftEnd) - 14;
	l.title(st.title, { face: bold, size: 18 }, mark);
	text('Konto', { face: bold, size: 7.5, color: GREY });
	text(st.account, { face: mono, size: 9 });
	l.y -= 6;
	text(st.note, { size: 8, color: GREY });
	l.y -= 10;

	// ---- one section per asset
	for (const s of st.sections) {
		l.ensure(90);
		l.page.drawRectangle({ x: M, y: l.y - 18, width, height: 18, color: BAND });
		bold.draw(l.page, `${s.asset} · ${st.account}`, { x: M + 6, y: l.y - 12.5, size: 9.5 });
		l.y -= 24;
		// The month in sums, first (#24): what the books take as one booking each; the rows below are the proof.
		if (aleph) {
			const m = s.monthly;
			const lines = [m.usage, m.usageTotal, m.purchases, m.transfersIn, m.transfersOut]
				.flat()
				.filter((x) => x !== null);
			if (lines.length) {
				l.ensure(14 + lines.length * 11 + 8);
				l.at('Monatsübersicht', M, 8, bold, GREY);
				l.right('Credits', M + 371 - 4, 7.5, bold, GREY);
				l.right('Wert EUR', M + 507 - 4, 7.5, bold, GREY);
				l.y -= 12;
				for (const ml of lines) {
					const total = ml === m.usageTotal;
					const f = total ? bold : regular;
					l.at(ml.label, M + (total ? 0 : 8), 8, f);
					l.right(qty(ml.amount), M + 371 - 4, 8, f);
					l.right(
						ml.eur ? deEuro(ml.eur, 4).replace(' €', '') : '—',
						M + 507 - 4,
						8,
						f,
						ml.eur ? BLACK : GREY
					);
					l.y -= 11;
				}
				l.y -= 8;
			}
		}
		const head = () => {
			let x = M;
			for (const c of COLS) {
				if (c.right) l.right(c.title, x + c.width - 4, 7.5, bold, GREY);
				else l.at(c.title, x, 7.5, bold, GREY);
				x += c.width;
			}
			l.y -= 11;
			line(l.y);
			l.y -= 3;
		};
		head();
		// opening balance
		l.at(`Kontostand am ${deDate(st.period.from)} (Beginn)`, M + COLS[0].width, 8, bold);
		l.right(qty(s.opening), M + 451 - 4, 8, bold);
		l.y -= 13;
		for (const r of s.rows) {
			const detail = [
				r.counterparty && `${r.debit ? 'an' : 'von'} ${r.counterparty}`,
				r.hash && `${r.hashLabel} ${r.hash.slice(0, 10)}…${r.hash.slice(-6)}`,
				r.beleg && `Eigenbeleg ${r.beleg}`
			]
				.filter(Boolean)
				.join(' · ');
			const lines = wrapText(r.text, regular, 8, COLS[1].width - 6);
			const sub = wrapText(detail, regular, 6.5, COLS[1].width - 6);
			const h = lines.length * 10 + sub.length * 8.5 + 4;
			if (l.ensure(h)) head();
			const y = l.y;
			regular.draw(l.page, deDate(r.date), { x: M, y: y - 8, size: 8 });
			regular.draw(l.page, r.time, { x: M, y: y - 16.5, size: 6.5, color: GREY });
			lines.forEach((t, i) =>
				regular.draw(l.page, t, { x: M + COLS[0].width, y: y - 8 - i * 10, size: 8 })
			);
			sub.forEach((t, i) =>
				regular.draw(l.page, t, {
					x: M + COLS[0].width,
					y: y - 8 - lines.length * 10 - i * 8.5 + 1.5,
					size: 6.5,
					color: GREY
				})
			);
			let x = M + COLS[0].width + COLS[1].width;
			l.right(qty(r.debit), x + COLS[2].width - 4, 8, regular);
			x += COLS[2].width;
			l.right(qty(r.credit), x + COLS[3].width - 4, 8, regular);
			x += COLS[3].width;
			l.right(qty(r.balance), x + COLS[4].width - 4, 8, regular);
			x += COLS[4].width;
			l.right(
				r.eur ? deEuro(r.eur, 4).replace(' €', '') : '—',
				x + COLS[5].width - 4,
				8,
				regular,
				r.eur ? BLACK : GREY
			);
			l.y -= h;
			line(l.y + 1, { thickness: 0.25, color: RULE });
		}
		if (s.rows.length === 0) {
			l.at('Keine Buchungen in diesem Zeitraum.', M + COLS[0].width, 8, regular, GREY);
			l.y -= 13;
		}
		// sums and closing balance
		l.ensure(60);
		line(l.y);
		l.y -= 3;
		l.at('Summe', M + COLS[0].width, 8, bold);
		l.right(qty(s.debit), M + 299 - 4, 8, bold);
		l.right(qty(s.credit), M + 371 - 4, 8, bold);
		l.y -= 13;
		l.at(`Kontostand am ${deDate(st.period.to)} (Ende)`, M + COLS[0].width, 9, bold);
		l.right(`${qty(s.closing)} ${s.asset}`, M + 451 - 4, 9, bold);
		l.y -= 15;
		// the check
		if (st.method === 'archive' && s.reported !== null) {
			const ok = reconciled(s.difference) === true;
			const difference = /** @type {string} */ (s.difference);
			const when = st.at
				? ` (Block ${st.at.closing.height}, ${st.at.closing.time.slice(0, 19).replace('T', ' ')} UTC)`
				: '';
			text(
				ok && isDust(difference)
					? `Abgestimmt: Der Kontostand laut Chain nach dem Zeitraum${when} ist ${qty(s.reported)} ${s.asset}; die Differenz von ${deNumber(difference)} ${s.asset} liegt unter der dargestellten Genauigkeit (das 1 yoctoNEAR, das ein Token-Transfer als Sicherheit mitgibt, zählt nicht als Zahlung).`
					: ok
						? `Abgestimmt: Der Kontostand laut Chain nach dem Zeitraum${when} ist ${qty(s.reported)} ${s.asset} und stimmt mit Anfangsstand plus Buchungen überein.`
						: `Nicht abgestimmt: Der Kontostand laut Chain${when} ist ${qty(s.reported)} ${s.asset}; Differenz ${deNumber(difference)} ${s.asset} (Bewegungen, die der Leser nicht sieht, etwa Auszahlungen eines Staking-Pools).`,
				{ size: 7.5, color: ok ? OK : WARN }
			);
		} else {
			text(
				`Anfangs- und Endstand abgeleitet aus dem heutigen Kontostand abzüglich aller Bewegungen seither (${aleph ? 'die Aleph-API nennt den heutigen Stand und die Summen seither' : 'die Chain hält keine alten Kontostände vor'}).`,
				{ size: 7.5, color: GREY }
			);
		}
		l.y -= 4;
		text(
			aleph
				? `Ausgänge ${deEuro(s.eurOut)} · Eingänge ${deEuro(s.eurIn)} · davon Verbrauch (Aufwand) ${deEuro(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – Euro-Werte: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis) × EZB-Referenzkurs USD/EUR des Tages.`
				: `Ausgänge ${deEuro(s.eurOut)} · Eingänge ${deEuro(s.eurIn)} · davon Netzwerkgebühren (Aufwand) ${deEuro(s.eurFees)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – Euro-Werte zum Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken).`,
			{ size: 7.5, color: GREY }
		);
		l.y -= 12;
	}
	if (st.unlisted)
		text(
			`${st.unlisted} Bewegung(en) in Token ohne verlässlichen Kurs (oft Spam) sind nur in der CSV-Datei aufgeführt.`,
			{ size: 7.5, color: GREY }
		);

	// page numbers and footer on every page
	const data = `Daten: ${DATA_SOURCES[st.chain] ?? st.chainName} · kein Dokument eines Kreditinstituts`;
	l.pages.forEach((p, i) => {
		regular.draw(p, `${st.number} · Seite ${i + 1} von ${l.pages.length}`, {
			x: M,
			y: M / 2,
			size: 7,
			color: GREY
		});
		regular.draw(p, data, {
			x: A4[0] - M - regular.width(data, 7),
			y: M / 2,
			size: 7,
			color: GREY
		});
	});

	return savePdfA(pdf, {
		title,
		author: st.holder.name,
		subject,
		creator,
		producer,
		created,
		seed: `${st.number}|${st.issuedAt}|${st.account}`
	});
}

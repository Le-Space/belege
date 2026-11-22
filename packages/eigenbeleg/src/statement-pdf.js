// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug as an A4 PDF/A-2b, laid out like a bank statement:
// holder and account in the head, per asset the opening balance, a table of
// bookings (date, text, debit, credit, running balance, EUR value), the
// closing balance with its check against the chain, and the sums a
// bookkeeper needs. German, for German bookkeeping. Aleph Cloud credits get
// the same layout titled »Verbrauchsauszug« (`st.title`). Above each list of
// bookings a small diagram (#889, statement-chart.js): the balance over the
// period, or what was consumed per day.

import { asset, createPdfA, LOGOS, savePdfA, wrapText } from '@le-space/pdf';
import { round } from '@le-space/ledger';

import { DATA_SOURCES, conversionText, deDate, deFixed, deMoney, deNumber } from './document.js';
import { CREATOR, PRODUCER } from './pdf.js';
import { isDust, reconciled } from './statement.js';
import { drawScene, sceneMeasure } from './chart-pdf.js';
import { statementChart } from './statement-chart.js';
import { BLACK, GREY, INK, MARK_SIZE, TYPE, WARN, pageLayout } from './layout.js';

// The same frame as every other document of the package (layout.js).
const M = 48;

/** The table of bookings; its last column names the statement's currency. @param {string} currency */
const columns = (currency) => [
	{ title: 'Buchungstag', width: 52 },
	{ title: 'Vorgang', width: 167 },
	{ title: 'Soll', width: 72, right: true },
	{ title: 'Haben', width: 72, right: true },
	{ title: 'Saldo', width: 80, right: true },
	{ title: `Wert ${currency}`, width: 56, right: true }
];

/** Quantities in the table: at most 12 decimals, the CSV keeps them all. @param {string} q */
const qty = (q) => (q ? deNumber(round(q, 12)) : '');

/**
 * @param {import('./statement.js').Statement} st
 * @param {{ creator?: string, producer?: string, logo?: boolean, chart?: boolean }} [o] logo: the chain's
 *   mark, larger than on an Eigenbeleg, beside the title (off unless asked for; @le-space/pdf's LOGOS).
 *   chart: the diagram above each list of bookings (on unless switched off). A statement carries no
 *   issuer's logo: it shows what the account did, it is not the issuer's own receipt.
 * @returns {Promise<Uint8Array>}
 */
export async function statementPdf(
	st,
	{ creator = CREATOR, producer = PRODUCER, logo = false, chart = true } = {}
) {
	const created = new Date(st.issuedAt);
	// Aleph credits: a Verbrauchsauszug in the same layout, valued by its own rule.
	const aleph = st.chain === 'aleph';
	// Filecoin Pay: the same, in USDFC and by rail.
	const pay = st.chain === 'filecoin-pay';
	// The statement's currency (EUR unless another): its code in the column heads and sums.
	const cur = st.currency ?? 'EUR';
	const COLS = columns(cur);
	/** @param {string} amount */
	const money = (amount) => deMoney(amount, cur);
	/** What the values are: in euro as it always said, or how they became another currency. @param {string} eur @param {string} rate */
	const valued = (eur, rate) =>
		cur === 'EUR' ? `Euro-Werte ${eur}` : `Werte in ${cur}: ${rate}, ${conversionText(cur)}`;
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
			p.at(`${st.title} ${st.number} · ${st.account}`, M, TYPE.label, regular, GREY);
			p.y -= 18;
		}
	});
	const { text, label } = l;
	const width = l.width;
	/** Where each column ends, from the left margin: sums and balances stand under their columns. */
	const ends = COLS.reduce(
		(a, c) => [...a, (a[a.length - 1] ?? 0) + c.width],
		/** @type {number[]} */ ([])
	);
	/** The right edge of the figures in column `i`. @param {number} i */
	const edge = (i) => M + ends[i] - 4;
	const [DEBIT, CREDIT, BALANCE, VALUE] = [2, 3, 4, 5];

	// ---- head: the title first, as on every document; below the rule the holder and the facts
	if (st.testnet) {
		text('TESTNET – keine echten Werte. Kurse des Mainnet-Assets nur zur Veranschaulichung.', {
			face: bold,
			size: TYPE.table,
			color: WARN
		});
		l.y -= 6;
	}
	// The chain's mark, larger: a statement shows what the network's account did. The issuer's logo is
	// not on it: a statement is not the issuer's own receipt.
	l.head(st.title, { image: mark, mark: MARK_SIZE.large });
	const top = l.y;
	label('Kontoinhaber', { max: 250 });
	text(st.holder.name, { face: bold, size: TYPE.lead, max: 250 });
	text(st.holder.address, { max: 250 });
	const leftEnd = l.y;
	l.y = top;
	const rx = M + width / 2 + 10;
	const facts = [
		// The label column is 72 pt wide: »Verbrauchsauszug« does not fit.
		[st.title === 'Kontoauszug' ? 'Kontoauszug' : 'Auszug-Nr.', st.number],
		['Zeitraum', `${deDate(st.period.from)} – ${deDate(st.period.to)}`],
		['Chain', `${st.chainName} (${st.network})`],
		['Erstellt am', `${deDate(st.issuedAt)}, ${st.issuedAt.slice(11, 16)} UTC`]
	];
	for (const [k, v] of facts) {
		regular.draw(l.page, k, { x: rx, y: l.y - TYPE.body, size: TYPE.small, color: GREY });
		regular.draw(l.page, v, { x: rx + 72, y: l.y - TYPE.body, size: TYPE.body, color: INK });
		l.y -= 13;
	}
	l.y = Math.min(l.y, leftEnd) - 8;
	label('Konto');
	text(st.account, { face: mono, size: TYPE.body });
	l.y -= 10;
	l.note(st.note, TYPE.table);
	l.y -= 18;

	// ---- one section per asset
	for (const s of st.sections) {
		l.ensure(90);
		// A section: its head on a hairline. No band, no fill.
		text(`${s.asset} · ${st.account}`, { face: bold, size: TYPE.lead });
		l.y -= 3;
		l.rule();
		l.y -= 10;
		// The month in sums, first (#24): what the books take as one booking each; the rows below are the proof.
		if (aleph || pay) {
			const m = s.monthly;
			const lines = [m.usage, m.usageTotal, m.purchases, m.transfersIn, m.transfersOut]
				.flat()
				.filter((x) => x !== null);
			if (lines.length) {
				l.ensure(14 + lines.length * 11 + 8);
				l.at('Monatsübersicht', M, TYPE.label, regular, GREY);
				l.right(pay ? s.asset : 'Credits', edge(CREDIT), TYPE.label, regular, GREY);
				l.right(`Wert ${cur}`, edge(VALUE), TYPE.label, regular, GREY);
				l.y -= 11;
				l.strong();
				l.y -= 4;
				for (const ml of lines) {
					const total = ml === m.usageTotal;
					const f = total ? bold : regular;
					l.at(ml.label, M, TYPE.table, f);
					l.right(qty(ml.amount), edge(CREDIT), TYPE.table, f);
					l.right(
						ml.eur ? deFixed(ml.eur, 4) : '—',
						edge(VALUE),
						TYPE.table,
						f,
						ml.eur ? BLACK : GREY
					);
					l.y -= 12;
				}
				l.y -= 1;
				l.rule();
				l.y -= 14;
			}
		}
		// The diagram, above the list of bookings (#889); every figure in it is in the tables.
		const drawn = chart ? statementChart(st, s, { width, measure: sceneMeasure(fonts) }) : null;
		if (drawn) {
			l.ensure(drawn.scene.height + 40);
			drawScene(l.page, drawn.scene, { x: M, top: l.y, fonts });
			l.y -= drawn.scene.height + 14;
		}
		const head = () => {
			let x = M;
			for (const c of COLS) {
				if (c.right) l.right(c.title, x + c.width - 4, TYPE.label, regular, GREY);
				else l.at(c.title, x, TYPE.label, regular, GREY);
				x += c.width;
			}
			l.y -= 11;
			l.strong();
			l.y -= 4;
		};
		head();
		// opening balance
		l.at(`Kontostand am ${deDate(st.period.from)} (Beginn)`, M + COLS[0].width, 8, bold);
		l.right(qty(s.opening), edge(BALANCE), 8, bold);
		l.y -= 13;
		l.rule();
		l.y -= 2;
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
			const h = lines.length * 10 + sub.length * 8.5 + 6;
			if (l.ensure(h)) head();
			const y = l.y;
			regular.draw(l.page, deDate(r.date), { x: M, y: y - 8, size: 8, color: INK });
			regular.draw(l.page, r.time, { x: M, y: y - 16.5, size: 6.5, color: GREY });
			lines.forEach((t, i) =>
				regular.draw(l.page, t, { x: M + COLS[0].width, y: y - 8 - i * 10, size: 8, color: INK })
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
				r.eur ? deFixed(r.eur, 4) : '—',
				x + COLS[5].width - 4,
				8,
				regular,
				r.eur ? BLACK : GREY
			);
			l.y -= h;
			l.y += 1;
			l.rule();
			l.y -= 1;
		}
		if (s.rows.length === 0) {
			l.at('Keine Buchungen in diesem Zeitraum.', M + COLS[0].width, 8, regular, GREY);
			l.y -= 13;
		}
		// sums and closing balance
		// Between two strong rules, like the amount of an Eigenbeleg: the sums, then the balance to carry on.
		l.ensure(70);
		l.y += 1;
		l.strong();
		l.y -= 5;
		l.at('Summe', M + COLS[0].width, 8, regular);
		l.right(qty(s.debit), edge(DEBIT), 8, regular);
		l.right(qty(s.credit), edge(CREDIT), 8, regular);
		l.y -= 14;
		l.at(`Kontostand am ${deDate(st.period.to)} (Ende)`, M + COLS[0].width, TYPE.lead, bold);
		l.right(`${qty(s.closing)} ${s.asset}`, edge(BALANCE), TYPE.lead, bold);
		l.y -= 17;
		l.strong();
		l.y -= 8;
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
				// Reconciled is the normal case and reads as text; only a difference is a warning.
				{ size: TYPE.small, color: ok ? INK : WARN }
			);
		} else {
			text(
				`Anfangs- und Endstand abgeleitet aus dem heutigen Kontostand abzüglich aller Bewegungen seither (${aleph ? 'die Aleph-API nennt den heutigen Stand und die Summen seither' : pay ? 'der Zahlungsvertrag nennt nur den heutigen Stand' : 'die Chain hält keine alten Kontostände vor'}).`,
				{ size: TYPE.small, color: GREY }
			);
		}
		l.y -= 4;
		text(
			pay
				? `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Verbrauch (Aufwand) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${valued(`zum Tageskurs von USDC, an den US-Dollar gebunden wie ${s.asset} (Kurs 00:00 UTC: CoinGecko, sonst Kraken)`, `Tageskurs von USDC, an den US-Dollar gebunden wie ${s.asset} (Kurs 00:00 UTC: CoinGecko, sonst Kraken)`)}.`
				: aleph
					? `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Verbrauch (Aufwand) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${
							cur === 'EUR'
								? 'Euro-Werte: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis) × EZB-Referenzkurs USD/EUR des Tages'
								: `Werte in ${cur}: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis)${cur === 'USD' ? '' : `, ${conversionText(cur)}`}`
						}.`
					: `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Netzwerkgebühren (Aufwand) ${money(s.eurFees)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${valued('zum Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken)', 'Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken)')}.`,
			{ size: TYPE.small, color: GREY }
		);
		l.y -= 20;
	}
	if (st.unlisted)
		text(
			`${st.unlisted} Bewegung(en) in Token ohne verlässlichen Kurs (oft Spam) sind nur in der CSV-Datei aufgeführt.`,
			{ size: TYPE.small, color: GREY }
		);

	// page numbers and footer on every page
	const data = `Daten: ${DATA_SOURCES[st.chain] ?? st.chainName} · kein Dokument eines Kreditinstituts`;
	l.pages.forEach((p, i) => l.foot(p, `${st.number} · Seite ${i + 1} von ${l.pages.length}`, data));

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

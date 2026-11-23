// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg of a period as an A4 PDF/A-2b (@le-space/pdf): fonts
// embedded as subsets, text in any script, an sRGB output intent, XMP
// metadata that matches the document info, and a document id. PDF/A is what
// an archive for bookkeeping records expects.
//
// The text is German, the document being for German bookkeeping; in English
// when the document says so (`doc.language`, language.js).

import { asset, createPdfA, LOGOS, savePdfA } from '@le-space/pdf';
import { round } from '@le-space/ledger';

import {
	DATA_SOURCES,
	DATA_SOURCES_EN,
	conversionText,
	currencyPlaces,
	formats,
	noInvoice,
	sourceName
} from './document.js';
import { localizeSource, say } from './language.js';
import { A4, BLACK, GREY, MARK_SIZE, TYPE, WARN, embedIssuerLogo, pageLayout } from './layout.js';

/** What made the file, unless the caller says otherwise. */
export const CREATOR = 'eigenbeleg';
export const PRODUCER = 'eigenbeleg (Le Space UG), pdf-lib';

/**
 * @param {import('./document.js').EigenbelegDocument} doc
 * @param {{ creator?: string, producer?: string, logo?: boolean, issuerLogo?: Uint8Array | null }} [o] logo: the chain's
 *   mark, very small, beside the title (off unless asked for; @le-space/pdf's LOGOS). issuerLogo: the issuer's own
 *   logo, a PNG or JPEG file's bytes, large as a letterhead: top right, the text below it (none unless given; an
 *   ImageError of @le-space/pdf when the file is no small PNG or JPEG)
 * @returns {Promise<Uint8Array>}
 */
export async function eigenbelegPdf(
	doc,
	{ creator = CREATOR, producer = PRODUCER, logo = false, issuerLogo = null } = {}
) {
	const created = new Date(doc.issuedAt);
	// The document's language (German unless it says English) and its formats.
	const L = doc.language ?? 'de';
	/** @param {string} de @param {string} en */
	const t = (de, en) => say(L, de, en);
	// The same, where `t` is a transaction.
	const tr = t;
	const { number: deNumber, rate: deRate, money: fmtMoney, date: deDate } = formats(L);
	const title = `${t('Eigenbeleg', 'Self-Issued Receipt')} ${doc.number}`;
	const subject = `${doc.layout === 'single' ? t('Eigenbelege', 'Self-issued receipts') : t('Sammel-Eigenbeleg', 'Collective self-issued receipt')} ${doc.chainName}, ${deDate(doc.period.from)} – ${deDate(doc.period.to)}`;
	const { pdf, fonts } = await createPdfA();
	const { regular, bold, mono } = fonts;
	const mark =
		logo && Object.hasOwn(LOGOS, doc.chain)
			? await pdf.embedPng(await asset(LOGOS[doc.chain]))
			: null;
	const own = await embedIssuerLogo(pdf, issuerLogo);
	const M = 48;
	// The document's currency (EUR unless another): its code in the column heads, its decimals in the sums.
	const cur = doc.currency ?? 'EUR';
	const places = currencyPlaces(cur);
	/** @param {string} amount @param {number} [p] */
	const money = (amount, p = places) => fmtMoney(amount, cur, p);
	/** What a rounded amount of zero was below: a cent, or the currency's smallest unit. */
	const below =
		cur === 'EUR'
			? t('unter einem Cent', 'below one cent')
			: `${t('unter', 'below')} ${money(places ? `0.${'1'.padStart(places, '0')}` : '1')}`;
	let pageNo = 1;
	let current = doc.number;
	const footerRight = `${t('Daten', 'Data')}: ${doc.dataSource ?? (L === 'en' ? DATA_SOURCES_EN : DATA_SOURCES)[doc.chain] ?? doc.chainName} · ${t('Kurse: siehe Kursquelle', 'Rates: see rate source')}`;

	const footer = (/** @type {import('./layout.js').Layout} */ l) =>
		l.foot(l.page, `${current} · ${t('Seite', 'Page')} ${pageNo}`, footerRight);
	const l = pageLayout(pdf, fonts, {
		margin: M,
		leavePage: footer,
		enterPage: () => {
			pageNo++;
		}
	});
	const { text, gap, field, label } = l;
	const width = l.width;

	/** @param {string} number @param {string} subtitle */
	function head(number, subtitle) {
		current = number;
		// The issuer's logo as a letterhead, above everything else on the page.
		l.letterhead(own);
		if (doc.testnet) {
			text(
				t(
					'TESTNET – keine echte Zahlung. Kurse des Mainnet-Assets nur zur Veranschaulichung; dieser Beleg ist kein Buchungsbeleg.',
					'TESTNET – no real payment. Rates of the mainnet asset for illustration only; this is no accounting record.'
				),
				{ face: bold, size: TYPE.table, color: WARN }
			);
			gap(6);
		}
		// The chain's mark only small: the document is the issuer's, not the network's.
		l.head(t('Eigenbeleg', 'Self-Issued Receipt'), {
			number,
			subtitle,
			image: mark,
			mark: MARK_SIZE.small,
			numberLabel: t('Nr.', 'No.')
		});
		// payer | issue data, two columns
		const top = l.y;
		label(t('Zahlender und Aussteller', 'Payer and issuer'), { max: width / 2 - 10 });
		text(doc.payer.name, { face: bold, size: TYPE.lead, max: width / 2 - 10 });
		text(doc.payer.address, { max: width / 2 - 10 });
		const leftEnd = l.y;
		l.y = top;
		const rx = M + width / 2 + 10;
		label(t('Ausgestellt am', 'Issued on'), { x: rx });
		text(`${deDate(doc.issuedAt)}, ${doc.issuedAt.slice(11, 16)} UTC`, { x: rx });
		gap(5);
		label(t('Empfänger', 'Recipient'), { x: rx });
		text(noInvoice(doc.chain, doc.chainName, L).recipient, { x: rx });
		l.y = Math.min(l.y, leftEnd);
		gap(8);
		label(
			doc.payer.addresses.length > 1
				? t('Eigene Zahlungsadressen', 'Own payment addresses')
				: t('Eigene Zahlungsadresse', 'Own payment address')
		);
		for (const a of doc.payer.addresses) text(a, { face: mono, size: TYPE.table });
		gap(12);
		l.note(doc.note);
		gap(16);
	}

	const columns = [
		// Measured in the document's face, whose figures are wider than its letters: a rate of six
		// significant digits below a millionth (deRate; Aleph's credits) and a value of four digits
		// before the comma with a currency's code each stand on one line.
		{ title: t('Bewegung', 'Movement'), width: 143 },
		{ title: t('Menge', 'Amount'), width: 106, right: true },
		{ title: `${t('Kurs', 'Rate')} ${cur}`, width: 67, right: true },
		{ title: `${t('Wert', 'Value')} ${cur}`, width: 70, right: true },
		{ title: t('Auf dem Beleg', 'On the receipt'), width: width - 386 }
	];

	/**
	 * One transaction: hash, who paid whom with full addresses, its QR code,
	 * and every movement it had, the ones not on the Eigenbeleg with the reason.
	 *
	 * @param {import('./document.js').Transaction} t @param {{ big?: boolean }} [o]
	 */
	function transaction(t, { big = false } = {}) {
		// The code is a convenience beside the link, not the picture of the page.
		const side = big ? 72 : 50;
		const textMax = width - side - 16;
		l.ensure(big ? 150 : 120);
		const top = l.y;
		const title = `${big ? tr('Zahlung', 'Payment') : `Position ${t.pos}`} · ${deDate(t.time)} ${t.time.slice(11, 19)} UTC`;
		text(title, { face: bold, size: TYPE.lead, max: textMax });
		gap(3);
		const hash = { face: mono, size: TYPE.small, max: textMax, labelWidth: 76 };
		field(tr('Transaktion', 'Transaction'), t.hash, hash);
		field(tr('Von', 'From'), `${t.from.address} (${t.from.label})`, hash);
		field(tr('An', 'To'), t.to.label ? `${t.to.address} (${t.to.label})` : t.to.address, hash);
		field(tr('Block-Explorer', 'Block explorer'), t.explorerUrl, { ...hash, size: TYPE.label });
		l.qr(t.explorerUrl, A4[0] - M - side, top, side);
		l.y = Math.min(l.y, top - side);
		gap(10);
		l.tableHead(columns);
		for (const m of t.movements) {
			const e = m.entry;
			l.row(
				columns,
				[
					`${m.what}${e.type === 'received' ? tr(' (Eingang)', ' (incoming)') : ''}`,
					`${deNumber(e.amount)} ${e.asset}`,
					e.eur ? deRate(e.eur.rate) : '—',
					e.eur ? money(e.eur.value, 4) : '—',
					m.onIt ? tr('ja', 'yes') : `${tr('nein', 'no')} – ${m.why}`
				],
				{ color: m.onIt ? BLACK : GREY }
			);
		}
		l.ensure(14);
		l.y -= 1;
		l.rule();
		l.y -= 4;
		// Not bold: the amount below is the figure to read; this is how it came about.
		l.right(
			`${tr('Auf dem Beleg', 'On the receipt')}: ${money(t.eurExact, 4)}`,
			A4[0] - M,
			TYPE.table,
			regular
		);
		l.y -= 16;
	}

	/** @param {{ why: string }[]} excluded @param {string[]} sources */
	function sourcesAndSignature(excluded, sources) {
		gap(8);
		label(t('Kursquelle', 'Rate source'));
		text(
			sources.length
				? `${sources.join('; ')} – ${t('jeweils für den Tag der Zahlung (UTC).', 'each for the day of the payment (UTC).')}`
				: '—',
			{
				size: TYPE.table
			}
		);
		if (cur !== 'EUR' && sources.length)
			text(`${t('Werte in', 'Values in')} ${cur}: ${conversionText(cur, L)}.`, {
				size: TYPE.table
			});
		gap(8);
		if (excluded.length) {
			label(t('Nicht auf diesem Eigenbeleg', 'Not on this receipt'));
			/** @type {Record<string, number>} */
			const why = {};
			for (const x of excluded) why[x.why] = (why[x.why] ?? 0) + 1;
			for (const [w, n] of Object.entries(why)) text(`${n} × ${w}`, { size: TYPE.table });
			text(
				t(
					'Alle Bewegungen des Zeitraums stehen in der CSV-Datei zu diesem Eigenbeleg.',
					'Every movement of the period is in the CSV file of this receipt.'
				),
				{
					size: TYPE.table,
					color: GREY
				}
			);
			gap(8);
		}
		text(doc.notInvoice, { size: TYPE.table, color: GREY });
		l.signature(t('Ort, Datum, Unterschrift des Zahlenden', 'Place, date, signature of the payer'));
	}

	/** @param {import('./document.js').Transaction[]} ts */
	const sourcesOf = (ts) => [
		...new Set(
			ts.flatMap((t) =>
				t.movements
					.filter((m) => m.onIt)
					.map((m) => localizeSource(sourceName(/** @type {any} */ (m.entry.eur).source), L))
			)
		)
	];
	/** The amount line: a label on the left, the amount on the right. @param {string} label @param {string} total */
	const amountLine = (label, total) => l.total(label, total);
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
				tr(
					`Eigenbeleg für eine Zahlung auf ${doc.chainName} (${doc.network}) am ${deDate(t.time)}`,
					`Self-issued receipt for a payment on ${doc.chainName} (${doc.network}) on ${deDate(t.time)}`
				)
			);
			transaction(t, { big: true });
			const what = [...new Set(t.movements.filter((m) => m.onIt).map((m) => m.what))].join(', ');
			amountLine(tr('Betrag', 'Amount'), money(t.eurExact));
			if (round(t.eurExact, places) === '0' && t.eurExact !== '0')
				text(`${tr('Ungerundet', 'Unrounded')} ${money(t.eurExact, 8)} (${below}).`, {
					size: TYPE.table,
					color: GREY
				});
			gap(6);
			field(
				tr('Was wurde bezahlt', 'What was paid'),
				`${what} ${tr('an', 'to')} ${t.to.label || t.to.address}`
			);
			gap(2);
			field(
				tr('Warum kein Fremdbeleg', 'Why no invoice'),
				noInvoice(doc.chain, doc.chainName, L).why
			);
			sourcesAndSignature([], sourcesOf([t]));
		});
	} else {
		head(
			doc.number,
			t(
				`Sammel-Eigenbeleg für Zahlungen auf ${doc.chainName} (${doc.network}), Zeitraum ${period}`,
				`Collective self-issued receipt for payments on ${doc.chainName} (${doc.network}), period ${period}`
			)
		);
		if (doc.transactions.length === 0) {
			text(
				t(
					'Keine Zahlungen an das Netzwerk in diesem Zeitraum.',
					'No payments to the network in this period.'
				),
				{ size: TYPE.lead }
			);
		} else {
			for (const t of doc.transactions) {
				transaction(t);
				// Room between two positions; the rules belong to their tables.
				gap(8);
			}
			const qty = Object.entries(doc.totals.quantities)
				.map(([a, q]) => `${deNumber(q)} ${a}`)
				.join(', ');
			const n = doc.transactions.length;
			amountLine(
				`${t('Summe', 'Total')} (${n} ${n === 1 ? 'Position' : t('Positionen', 'positions')}): ${qty}`,
				money(doc.totals.eur)
			);
			const exact = /^0(\.0*)?$/.test(round(doc.totals.eurExact, 4))
				? money(doc.totals.eurExact, 8)
				: money(doc.totals.eurExact, 4);
			const subCent = doc.totals.eur === '0' && doc.totals.eurExact !== '0';
			text(
				`${t('Ungerundet', 'Unrounded')} ${exact}${subCent ? ` (${below})` : ''}; ${t('jede Position zum Tageskurs ihres Zahlungstages.', 'each position at the rate of its payment day.')}`,
				{ size: TYPE.table, color: GREY }
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

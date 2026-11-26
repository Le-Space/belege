// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Kontoauszug as an A4 PDF/A-2b, laid out like a bank statement:
// holder and account in the head, per asset the opening balance, a table of
// bookings (date, text, debit, credit, running balance, EUR value), the
// closing balance with its check against the chain, and the sums a
// bookkeeper needs. German, for German bookkeeping. Aleph Cloud credits get
// the same layout titled »Verbrauchsauszug« (`st.title`). Above each list of
// bookings a small diagram (#889, statement-chart.js): the balance over the
// period, or what was consumed per day. A token not in the chain's list (#93)
// is named by its contract, its symbol the contract's own claim; a section
// that does not fit on the rest of the page starts on a new one. A wallet's
// network fees of a month stand as one collective line (#1044), each fee in
// the annex after the sections with its time, hash, amount, value and rate.

import { asset, createPdfA, LOGOS, savePdfA, wrapText } from '@le-space/pdf';
import { round } from '@le-space/ledger';

import { DATA_SOURCES, DATA_SOURCES_EN, conversionText, formats } from './document.js';
import { localizeSource, say } from './language.js';
import { CREATOR, PRODUCER } from './pdf.js';
import { isDust, reconciled } from './statement.js';
import { drawScene, sceneMeasure } from './chart-pdf.js';
import { statementChart } from './statement-chart.js';
import { BLACK, GREY, INK, MARK_SIZE, TYPE, WARN, pageLayout } from './layout.js';

// The same frame as every other document of the package (layout.js).
const M = 48;

const MARKET_RATE = 'Tageskurs (Kurs 00:00 UTC: CoinGecko, sonst Kraken)';
const MARKET_RATE_EN = "the day's rate (rate at 00:00 UTC: CoinGecko, else Kraken)";

/**
 * What a section's values are at, for its note: the market rate of the day, a
 * reference value by its name, or both – as the EUR text (`zum …`) and the
 * rate's name for another currency.
 *
 * @param {{ marketRate?: boolean, referenceValues?: string[] }} s
 * @param {import('./language.js').DocumentLanguage} [language]
 * @returns {[string, string]}
 */
function marketOrReference({ marketRate = true, referenceValues = [] }, language = 'de') {
	const en = language === 'en';
	const names = [
		...(marketRate || !referenceValues.length ? [en ? MARKET_RATE_EN : MARKET_RATE] : []),
		...referenceValues.map((r) => localizeSource(r, language))
	];
	return en
		? [names.map((n) => `at ${n}`).join(' and '), names.join(' and ')]
		: [names.map((n) => `zum ${n}`).join(' und '), names.join(' und ')];
}

/** The table of bookings; its last column names the statement's currency. @param {string} currency @param {import('./language.js').DocumentLanguage} [language] */
const columns = (currency, language = 'de') =>
	language === 'en'
		? [
				{ title: 'Date', width: 52 },
				{ title: 'Transaction', width: 167 },
				{ title: 'Debit', width: 72, right: true },
				{ title: 'Credit', width: 72, right: true },
				{ title: 'Balance', width: 80, right: true },
				{ title: `Value ${currency}`, width: 56, right: true }
			]
		: [
				{ title: 'Buchungstag', width: 52 },
				{ title: 'Vorgang', width: 167 },
				{ title: 'Soll', width: 72, right: true },
				{ title: 'Haben', width: 72, right: true },
				{ title: 'Saldo', width: 80, right: true },
				{ title: `Wert ${currency}`, width: 56, right: true }
			];

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
	// The statement's language (German unless it says English) and its formats.
	const L = st.language ?? 'de';
	/** @param {string} de @param {string} en */
	const t = (de, en) => say(L, de, en);
	const {
		number: deNumber,
		fixed: deFixed,
		money: fmtMoney,
		date: deDate,
		rate: deRate
	} = formats(L);
	/** Quantities in the table: at most 12 decimals, the CSV keeps them all. @param {string} q */
	const qty = (q) => (q ? deNumber(round(q, 12)) : '');
	const COLS = columns(cur, L);
	/** @param {string} amount */
	const money = (amount) => fmtMoney(amount, cur);
	/** What the values are: in euro as it always said, or how they became another currency. @param {string} eur @param {string} rate */
	const valued = (eur, rate) =>
		cur === 'EUR'
			? `${t('Euro-Werte', 'Euro values')} ${eur}`
			: `${t('Werte in', 'Values in')} ${cur}: ${rate}, ${conversionText(cur, L)}`;
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
		text(
			t(
				'TESTNET – keine echten Werte. Kurse des Mainnet-Assets nur zur Veranschaulichung.',
				'TESTNET – no real values. Rates of the mainnet asset for illustration only.'
			),
			{
				face: bold,
				size: TYPE.table,
				color: WARN
			}
		);
		l.y -= 6;
	}
	// The chain's mark, larger: a statement shows what the network's account did. The issuer's logo is
	// not on it: a statement is not the issuer's own receipt.
	l.head(st.title, { image: mark, mark: MARK_SIZE.large });
	const top = l.y;
	label(t('Kontoinhaber', 'Account holder'), { max: 250 });
	text(st.holder.name, { face: bold, size: TYPE.lead, max: 250 });
	text(st.holder.address, { max: 250 });
	const leftEnd = l.y;
	l.y = top;
	const rx = M + width / 2 + 10;
	const facts = [
		// The label column is 72 pt wide: »Verbrauchsauszug« does not fit.
		[st.title === 'Kontoauszug' ? 'Kontoauszug' : t('Auszug-Nr.', 'Statement no.'), st.number],
		[t('Zeitraum', 'Period'), `${deDate(st.period.from)} – ${deDate(st.period.to)}`],
		['Chain', `${st.chainName} (${st.network})`],
		[t('Erstellt am', 'Made on'), `${deDate(st.issuedAt)}, ${st.issuedAt.slice(11, 16)} UTC`]
	];
	for (const [k, v] of facts) {
		regular.draw(l.page, k, { x: rx, y: l.y - TYPE.body, size: TYPE.small, color: GREY });
		regular.draw(l.page, v, { x: rx + 72, y: l.y - TYPE.body, size: TYPE.body, color: INK });
		l.y -= 13;
	}
	l.y = Math.min(l.y, leftEnd) - 8;
	label(t('Konto', 'Account'));
	text(st.account, { face: mono, size: TYPE.body });
	l.y -= 10;
	l.note(st.note, TYPE.table);
	l.y -= 18;

	/** A booking's two lines of text, and the height of its row. @param {import('./statement.js').StatementRow} r */
	const rowText = (r) => {
		const detail = r.collective
			? [
					`${t('Sammelposten', 'Collective line')} ${r.collective.label}`,
					t('jede Gebühr im Anhang', 'each fee in the annex')
				]
			: [
					r.counterparty && `${r.debit ? t('an', 'to') : t('von', 'from')} ${r.counterparty}`,
					r.hash && `${r.hashLabel} ${r.hash.slice(0, 10)}…${r.hash.slice(-6)}`,
					r.beleg && `${t('Eigenbeleg', 'Receipt')} ${r.beleg}`
				];
		const detailText = detail.filter(Boolean).join(' · ');
		const lines = wrapText(r.text, regular, 8, COLS[1].width - 6);
		const sub = wrapText(detailText, regular, 6.5, COLS[1].width - 6);
		return { lines, sub, h: lines.length * 10 + sub.length * 8.5 + 6 };
	};
	/** What a page holds below its running head, above the footer. */
	const pageRoom = l.page.getHeight() - 2 * M - 18 - 16;

	// ---- one section per asset
	for (const [i, s] of st.sections.entries()) {
		// What the table shows: each collective line of network fees in place of its fees (#1044).
		const shown = s.lines ?? s.rows;
		// The diagram, above the list of bookings (#889); every figure in it is in the tables.
		const drawn = chart ? statementChart(st, s, { width, measure: sceneMeasure(fonts) }) : null;
		const monthLines =
			aleph || pay
				? [s.monthly.usage, s.monthly.usageTotal, s.monthly.purchases, s.monthly.transfersIn]
						.concat([s.monthly.transfersOut])
						.flat()
						.filter((x) => x !== null).length
				: 0;
		// A section that does not fit on the rest of the page starts on a new one (#93: a wallet with
		// many tokens): its head never stands apart from its bookings. The first follows the head.
		const tall =
			(s.contract ? 70 : 40) +
			(monthLines ? 14 + monthLines * 12 + 15 : 0) +
			(drawn ? drawn.scene.height + 14 : 0) +
			30 +
			(shown.length ? shown.reduce((h, r) => h + rowText(r).h, 0) : 13) +
			110;
		if (i > 0 && l.y - (M + 16) < Math.min(tall, pageRoom)) l.newPage();
		else l.ensure(90);
		// A section: its head on a hairline. No band, no fill. A token not in the list is named by its
		// contract; what it calls itself is the contract's own claim.
		if (s.contract) {
			text(`${s.asset} (${t('laut Token-Vertrag', 'as the token contract says')})`, {
				face: bold,
				size: TYPE.lead
			});
			text(s.contract, { face: mono, size: TYPE.body });
		} else text(`${s.asset} · ${st.account}`, { face: bold, size: TYPE.lead });
		l.y -= 3;
		l.rule();
		l.y -= 10;
		if (s.contract) {
			text(
				t(
					`Token außerhalb der Liste geprüfter Token dieser Chain: Name »${s.asset}« und Nachkommastellen nennt der Vertrag selbst; maßgeblich ist seine Adresse oben.`,
					`A token outside this chain's list of checked tokens: its name "${s.asset}" and decimals are what the contract says of itself; its address above is what counts.`
				),
				{ size: TYPE.small, color: GREY }
			);
			l.y -= 6;
		}
		// The month in sums, first (#24): what the books take as one booking each; the rows below are the proof.
		if (aleph || pay) {
			const m = s.monthly;
			const lines = [m.usage, m.usageTotal, m.purchases, m.transfersIn, m.transfersOut]
				.flat()
				.filter((x) => x !== null);
			if (lines.length) {
				l.ensure(14 + lines.length * 11 + 8);
				l.at(t('Monatsübersicht', 'The month in sums'), M, TYPE.label, regular, GREY);
				l.right(pay ? s.asset : t('Credits', 'Credits'), edge(CREDIT), TYPE.label, regular, GREY);
				l.right(`${t('Wert', 'Value')} ${cur}`, edge(VALUE), TYPE.label, regular, GREY);
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
		l.at(
			t(
				`Kontostand am ${deDate(st.period.from)} (Beginn)`,
				`Balance on ${deDate(st.period.from)} (start)`
			),
			M + COLS[0].width,
			8,
			bold
		);
		l.right(qty(s.opening), edge(BALANCE), 8, bold);
		l.y -= 13;
		l.rule();
		l.y -= 2;
		for (const r of shown) {
			const { lines, sub, h } = rowText(r);
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
			l.at(
				t('Keine Buchungen in diesem Zeitraum.', 'No bookings in this period.'),
				M + COLS[0].width,
				8,
				regular,
				GREY
			);
			l.y -= 13;
		}
		// sums and closing balance
		// Between two strong rules, like the amount of an Eigenbeleg: the sums, then the balance to carry on.
		l.ensure(70);
		l.y += 1;
		l.strong();
		l.y -= 5;
		l.at(t('Summe', 'Total'), M + COLS[0].width, 8, regular);
		l.right(qty(s.debit), edge(DEBIT), 8, regular);
		l.right(qty(s.credit), edge(CREDIT), 8, regular);
		l.y -= 14;
		l.at(
			t(`Kontostand am ${deDate(st.period.to)} (Ende)`, `Balance on ${deDate(st.period.to)} (end)`),
			M + COLS[0].width,
			TYPE.lead,
			bold
		);
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
					? t(
							`Abgestimmt: Der Kontostand laut Chain nach dem Zeitraum${when} ist ${qty(s.reported)} ${s.asset}; die Differenz von ${deNumber(difference)} ${s.asset} liegt unter der dargestellten Genauigkeit (das 1 yoctoNEAR, das ein Token-Transfer als Sicherheit mitgibt, zählt nicht als Zahlung).`,
							`Reconciled: the balance the chain reports after the period${when} is ${qty(s.reported)} ${s.asset}; the difference of ${deNumber(difference)} ${s.asset} is below the precision shown (the 1 yoctoNEAR a token transfer attaches as its security deposit is no payment).`
						)
					: ok
						? t(
								`Abgestimmt: Der Kontostand laut Chain nach dem Zeitraum${when} ist ${qty(s.reported)} ${s.asset} und stimmt mit Anfangsstand plus Buchungen überein.`,
								`Reconciled: the balance the chain reports after the period${when} is ${qty(s.reported)} ${s.asset} and equals the opening balance plus the bookings.`
							)
						: t(
								`Nicht abgestimmt: Der Kontostand laut Chain${when} ist ${qty(s.reported)} ${s.asset}; Differenz ${deNumber(difference)} ${s.asset} (Bewegungen, die der Leser nicht sieht, etwa Auszahlungen eines Staking-Pools).`,
								`Not reconciled: the balance the chain reports${when} is ${qty(s.reported)} ${s.asset}; difference ${deNumber(difference)} ${s.asset} (movements the reader does not see, such as payouts of a staking pool).`
							),
				// Reconciled is the normal case and reads as text; only a difference is a warning.
				{ size: TYPE.small, color: ok ? INK : WARN }
			);
		} else {
			text(
				t(
					`Anfangs- und Endstand abgeleitet aus dem heutigen Kontostand abzüglich aller Bewegungen seither (${aleph ? 'die Aleph-API nennt den heutigen Stand und die Summen seither' : pay ? 'der Zahlungsvertrag nennt nur den heutigen Stand' : 'die Chain hält keine alten Kontostände vor'}).`,
					`Opening and closing balance derived from today's balance less every movement since (${aleph ? "the Aleph API names today's balance and the sums since" : pay ? "the payment contract names only today's balance" : 'the chain keeps no old balances'}).`
				),
				{ size: TYPE.small, color: GREY }
			);
		}
		l.y -= 4;
		text(
			L === 'en'
				? pay
					? `Out ${money(s.eurOut)} · in ${money(s.eurIn)} · of which usage (expense) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} booking(s) without a rate` : ''} – ${valued(`at the day's rate of USDC, pegged to the US dollar like ${s.asset} (rate at 00:00 UTC: CoinGecko, else Kraken)`, `the day's rate of USDC, pegged to the US dollar like ${s.asset} (rate at 00:00 UTC: CoinGecko, else Kraken)`)}.`
					: aleph
						? `Out ${money(s.eurOut)} · in ${money(s.eurIn)} · of which usage (expense) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} booking(s) without a rate` : ''} – ${
								cur === 'EUR'
									? 'Euro values: the USD price per credit (the last purchase on or before the day, else the list price) × the ECB reference rate USD/EUR of the day'
									: `Values in ${cur}: the USD price per credit (the last purchase on or before the day, else the list price)${cur === 'USD' ? '' : `, ${conversionText(cur, L)}`}`
							}.`
						: `Out ${money(s.eurOut)} · in ${money(s.eurIn)} · of which network fees (expense) ${money(s.eurFees)}${s.unvalued ? ` · ${s.unvalued} booking(s) without a rate` : ''} – ${
								!s.contract
									? valued(...marketOrReference(s, L))
									: s.sources?.length
										? valued(
												`at the rate by the contract's address: ${s.sources.map((x) => localizeSource(x, L)).join(' and ')}`,
												`rate by the contract's address: ${s.sources.map((x) => localizeSource(x, L)).join(' and ')}`
											)
										: 'no rate source names a rate for this token'
							}.`
				: pay
					? `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Verbrauch (Aufwand) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${valued(`zum Tageskurs von USDC, an den US-Dollar gebunden wie ${s.asset} (Kurs 00:00 UTC: CoinGecko, sonst Kraken)`, `Tageskurs von USDC, an den US-Dollar gebunden wie ${s.asset} (Kurs 00:00 UTC: CoinGecko, sonst Kraken)`)}.`
					: aleph
						? `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Verbrauch (Aufwand) ${money(s.eurUsage)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${
								cur === 'EUR'
									? 'Euro-Werte: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis) × EZB-Referenzkurs USD/EUR des Tages'
									: `Werte in ${cur}: USD-Preis je Credit (letzter Kauf am oder vor dem Tag, sonst Listenpreis)${cur === 'USD' ? '' : `, ${conversionText(cur)}`}`
							}.`
						: `Ausgänge ${money(s.eurOut)} · Eingänge ${money(s.eurIn)} · davon Netzwerkgebühren (Aufwand) ${money(s.eurFees)}${s.unvalued ? ` · ${s.unvalued} Buchung(en) ohne Kurs` : ''} – ${
								!s.contract
									? valued(...marketOrReference(s))
									: s.sources?.length
										? valued(
												`zum Kurs nach der Vertragsadresse: ${s.sources.join(' und ')}`,
												`Kurs nach der Vertragsadresse: ${s.sources.join(' und ')}`
											)
										: 'für diesen Token nennt keine Kursquelle einen Kurs'
							}.`,
			{ size: TYPE.small, color: GREY }
		);
		l.y -= 20;
	}
	// ---- the annex: every network fee of every collective line (#1044), each checkable on its own
	const groups = st.sections.flatMap((s) => (s.feeGroups ?? []).map((g) => ({ s, g })));
	if (groups.length) {
		const ANNEX = [
			{ title: t('Datum, Uhrzeit (UTC)', 'Date, time (UTC)'), width: 78 },
			{ title: t('Transaktions-Hash', 'Transaction hash'), width: 237 },
			{ title: t('Menge', 'Amount'), width: 70, right: true },
			{ title: `${t('Wert', 'Value')} ${cur}`, width: 54, right: true },
			{ title: `${t('Kurs', 'Rate')} ${cur}`, width: 60, right: true }
		];
		const annexEnds = ANNEX.reduce(
			(a, c) => [...a, (a[a.length - 1] ?? 0) + c.width],
			/** @type {number[]} */ ([])
		);
		const annexHead = () => {
			for (const [k, c] of ANNEX.entries()) {
				if (c.right) l.right(c.title, M + annexEnds[k] - 4, TYPE.label, regular, GREY);
				else l.at(c.title, M + (annexEnds[k - 1] ?? 0), TYPE.label, regular, GREY);
			}
			l.y -= 11;
			l.strong();
			l.y -= 4;
		};
		l.ensure(120);
		l.y -= 6;
		text(t('Anhang: Netzwerkgebühren', 'Annex: network fees'), {
			face: bold,
			size: TYPE.lead
		});
		l.y -= 3;
		l.rule();
		l.y -= 8;
		text(
			t(
				'Jede Gebühr einer Sammelzeile oben, einzeln über ihren Transaktions-Hash nachprüfbar. Der Wert ist der Tageskurs mal Menge; die Sammelzeile summiert die Werte ungerundet.',
				'Every fee of a collective line above, each checkable by its transaction hash. The value is the rate of the day times the amount; the collective line sums the values unrounded.'
			),
			{ size: TYPE.small, color: GREY }
		);
		l.y -= 8;
		for (const { s, g } of groups) {
			l.ensure(60);
			text(
				`${g.label} · ${s.asset} · ${g.count} ${t('Transaktionen', 'transactions')} · ${qty(g.amount)} ${s.asset}${g.eur ? ` · ${money(round(g.eur, 2))}` : ''}`,
				{ face: bold, size: TYPE.body }
			);
			l.y -= 4;
			annexHead();
			for (const r of g.rows) {
				if (l.ensure(12)) annexHead();
				l.at(`${deDate(r.date)} ${r.time}`, M, 7, regular);
				l.at(r.hash, M + annexEnds[0], 5.5, mono);
				l.right(qty(r.debit || r.credit), M + annexEnds[2] - 4, 7, regular);
				l.right(
					r.eur ? deFixed(r.eur, 4) : '—',
					M + annexEnds[3] - 4,
					7,
					regular,
					r.eur ? BLACK : GREY
				);
				const rate = r.eur ? (r.rate ?? '') : '';
				l.right(rate ? deRate(rate) : '—', M + annexEnds[4] - 4, 7, regular, rate ? BLACK : GREY);
				l.y -= 11;
			}
			l.y -= 1;
			l.rule();
			l.y -= 12;
		}
	}
	if (st.unlisted)
		text(
			t(
				`${st.unlisted} Bewegung(en) in Token ohne verlässlichen Kurs (oft Spam) sind nur in der CSV-Datei aufgeführt.`,
				`${st.unlisted} movement(s) in tokens without a reliable rate (often spam) are listed in the CSV file only.`
			),
			{ size: TYPE.small, color: GREY }
		);

	// page numbers and footer on every page
	const data = `${t('Daten', 'Data')}: ${st.dataSource ?? (L === 'en' ? DATA_SOURCES_EN : DATA_SOURCES)[st.chain] ?? st.chainName} · ${t('kein Dokument eines Kreditinstituts', 'no document of a bank')}`;
	l.pages.forEach((p, i) =>
		l.foot(
			p,
			`${st.number} · ${t('Seite', 'Page')} ${i + 1} ${t('von', 'of')} ${l.pages.length}`,
			data
		)
	);

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

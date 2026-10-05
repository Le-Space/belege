// Draws an Aleph consumption statement (aleph.js) as an A4 PDF: an
// Eigenbeleg in the look of receipts/eigenbeleg-pdf.js, with the balances,
// the top-ups, the consumption per day and resource, the resources with
// their full hashes, how the euro value was reached, and a line to sign.
// Pages as long as the month needs; every text goes through winAnsi.
// Loaded on first use.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { amount } from '../export/datev.js';
import { statementLayout } from '../pdf/statement-layout.js';

/** 1234567 → "1.234.567". @param {number} n */
const credits = (n) => Math.round(n).toLocaleString('de-DE');
/** @param {number | null} cents */
const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);
/** @param {string} iso */
const utc = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const KIND = /** @type {Record<string, string>} */ ({
	storage: 'Speicher (alle Stores)',
	execution: 'Instanz'
});

/**
 * @param {import('./aleph.js').StatementDocument} doc
 * @returns {Promise<Uint8Array>}
 */
export async function statementPdf(doc) {
	const s = doc.statement;
	const created = new Date(doc.createdAt);
	const { width, head, field, rule, heading, table, signature, save } = await statementLayout({
		title: `Eigenbeleg ${doc.number} – Aleph-Verbrauch ${s.month}`,
		created,
		continuation: `${doc.number} · Aleph-Verbrauch ${s.month} (Fortsetzung)`
	});

	head(doc.number, doc.issuer, 'Verbrauchsnachweis Aleph Cloud – Aleph stellt keine Rechnung aus.');

	field('Anbieter', 'Aleph Cloud (aleph.cloud), bezahlt in Aleph-Credits');
	field(
		'Konto',
		`${doc.accountName ? `${doc.accountName}\n` : ''}${s.address}`,
		doc.accountName ? false : 'mono'
	);
	field('Zeitraum', `${utc(s.from)} bis ${utc(s.until)}`);
	field('Verbrauch', `${credits(s.totals.usage)} Credits · ${euro(s.totals.eurCents)}`, true);
	rule();

	field('Anfangsbestand', `${credits(s.opening)} Credits`);
	field('+ Aufladungen', `${credits(s.totals.topUps)} Credits`);
	if (s.totals.transfersOut) field('− Übertragen', `${credits(s.totals.transfersOut)} Credits`);
	field('− Verbrauch', `${credits(s.totals.usage)} Credits`);
	field('= Endbestand', `${credits(s.closing)} Credits`, true);
	field(
		'Abgleich',
		s.difference === 0
			? 'Geht auf: Anfangsbestand + Aufladungen − Abgänge = Endbestand (laut Aleph).'
			: `Differenz ${credits(s.difference)} Credits: Aleph hat nicht alle Einträge geliefert.`
	);

	if (s.topUps.length || s.transfersOut.length) {
		rule();
		heading('Aufladungen und Überträge');
		table(
			[
				{ title: 'Zeitpunkt', width: 90 },
				{ title: 'Art', width: 90 },
				{ title: 'Credits', width: 70, right: true },
				{ title: 'USD/Credit', width: 70, right: true },
				{ title: 'Transaktion / Konto', width: width - 320, mono: true }
			],
			[
				...s.topUps.map((t) => [
					utc(t.time),
					t.how === 'purchase'
						? `Kauf${t.token ? ` (${t.token}${t.chain ? `, ${t.chain}` : ''})` : ''}`
						: 'Übertrag herein',
					credits(t.credits + t.bonus),
					t.price ?? '—',
					t.txHash ?? t.from ?? ''
				]),
				...s.transfersOut.map((t) => [
					utc(t.time),
					'Übertrag hinaus',
					`−${credits(t.credits)}`,
					'—',
					t.to
				])
			]
		);
	}

	rule();
	heading('Verbrauch je Tag');
	const nameOf = (/** @type {string | null} */ hash) => {
		if (!hash) return '';
		const r = s.resources[hash];
		return r?.name ? `${r.name} (${hash.slice(0, 10)}…)` : `${hash.slice(0, 10)}…`;
	};
	table(
		[
			{ title: 'Tag (UTC)', width: 62 },
			{ title: 'Ressource', width: width - 62 - 64 - 62 - 48 - 64 },
			{ title: 'Credits', width: 64, right: true },
			{ title: 'USD/Credit', width: 62, right: true },
			{ title: 'EUR/USD', width: 48, right: true },
			{ title: 'EUR', width: 64, right: true }
		],
		s.usage.map((u) => [
			formatDate(u.date, DOCUMENT_LOCALE),
			u.kind === 'storage'
				? `${KIND.storage}${u.resources ? `: ${u.resources} Stores` : ''}${u.sizeMib !== null ? `, ${u.sizeMib.toFixed(1).replace('.', ',')} MiB` : ''}`
				: `${KIND[u.kind] ?? u.kind}${u.resource ? ` ${nameOf(u.resource)}` : ''}`,
			credits(u.credits),
			u.usdPerCredit,
			u.eurPerUsd ?? '—',
			u.eurCents === null ? '—' : amount(u.eurCents)
		])
	);
	field('Summe', `${credits(s.totals.usage)} Credits · ${euro(s.totals.eurCents)}`, true);

	const hashes = Object.entries(s.resources);
	if (hashes.length) {
		rule();
		heading('Abgerechnete Instanzen');
		table(
			[
				{ title: 'Art', width: 70 },
				{ title: 'Name', width: 110 },
				{ title: 'Item-Hash', width: width - 180, mono: true }
			],
			hashes.map(([hash, r]) => [r.type || '—', r.name || '—', hash])
		);
	}

	rule();
	field(
		'Bewertung',
		`Credits sind in USD bepreist. Ein Tag wird zum Preis je Credit des letzten Credit-Kaufs bis zu diesem Tag bewertet, ohne einen Kauf zu Alephs Listenpreis (1 USD je 1.000.000 Credits), und mit dem Referenzkurs der EZB dieses Tages in EUR umgerechnet${s.rateSource && s.rateSource !== 'ecb' ? ` (Quelle: ${s.rateSource})` : ''}. Die Bewertung ist mit dem Steuerberater abzustimmen.`
	);
	field('Quelle', 'Öffentliche Aleph-API (Guthaben und Credit-Verlauf des Kontos), nur gelesen.');
	field('Warum kein Fremdbeleg', doc.reason);
	rule();
	field(
		'Erstellt',
		`${formatDate(doc.createdAt.slice(0, 10), DOCUMENT_LOCALE)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`
	);
	signature();

	return save();
}

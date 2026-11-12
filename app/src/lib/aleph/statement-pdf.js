// Draws an Aleph consumption statement (aleph.js) as an A4 PDF/A-2b: an
// Eigenbeleg in the layout of every statement Eigenbeleg (@le-space/eigenbeleg's
// statement-layout, in Eigenbeleg's look), with the balances, the top-ups,
// the month in sums (per resource, bought, in and out: what the books take as
// one booking each, in the words of @le-space/eigenbeleg's `monthly`), the
// consumption per day and resource, the resources with their full hashes,
// how the euro value was reached, and a line to sign.
// Pages as long as the month needs; text in any script (@le-space/pdf).
// Loaded on first use.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { amount } from '../export/datev.js';
import { monthly } from '@le-space/eigenbeleg/statement';
import { statementLayout } from '@le-space/eigenbeleg/statement-layout';

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

/** A resource by its name and the start of its hash. @param {import('../bridge/client.js').AlephStatement} s @param {string | null} hash */
function nameOf(s, hash) {
	if (!hash) return '';
	const r = s.resources[hash];
	return r?.name ? `${r.name} (${hash.slice(0, 10)}…)` : `${hash.slice(0, 10)}…`;
}

/**
 * The month in sums, as the Verbrauchsauszug of the Eigenbeleg API has it
 * (`monthly`, the same lines and words): consumption per resource and in all,
 * credits bought, transfers in and out. A top-up has no euro value here: its
 * payment is a booking of the wallet that paid it.
 *
 * @param {import('../bridge/client.js').AlephStatement} s
 */
export function monthlyLines(s) {
	/** @param {Partial<import('@le-space/eigenbeleg/statement').StatementRow>} over */
	const row = (over) => ({
		date: '',
		time: '',
		text: '',
		counterparty: '',
		hash: '',
		explorerUrl: '',
		debit: '',
		credit: '',
		balance: '',
		eur: '',
		beleg: '',
		fee: false,
		usage: false,
		purchase: false,
		label: '',
		hashLabel: 'Tx',
		...over
	});
	const m = monthly([
		...s.usage.map((u) =>
			row({
				usage: true,
				debit: String(u.credits),
				eur: u.eurCents === null ? '' : (u.eurCents / 100).toFixed(2),
				label: `Aleph Cloud (${u.kind === 'storage' ? 'storage' : nameOf(s, u.resource) || u.kind})`
			})
		),
		...s.topUps.map((t) =>
			row({ credit: String(t.credits + t.bonus), purchase: t.how === 'purchase' })
		),
		...s.transfersOut.map((t) => row({ debit: String(t.credits) }))
	]);
	return {
		lines: [...m.usage, m.usageTotal, m.purchases, m.transfersIn, m.transfersOut].filter(
			(l) => l !== null
		)
	};
}

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

	const month = monthlyLines(s);
	if (month.lines.length) {
		rule();
		heading('Monatsübersicht');
		table(
			[
				{ title: 'Posten', width: width - 60 - 80 - 80 },
				{ title: 'Zeilen', width: 60, right: true },
				{ title: 'Credits', width: 80, right: true },
				{ title: 'EUR', width: 80, right: true }
			],
			month.lines.map((l) => [
				l.label,
				String(l.rows),
				credits(Number(l.amount)),
				l.eur ? amount(Math.round(Number(l.eur) * 100)) : '—'
			])
		);
	}

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
				: `${KIND[u.kind] ?? u.kind}${u.resource ? ` ${nameOf(s, u.resource)}` : ''}`,
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

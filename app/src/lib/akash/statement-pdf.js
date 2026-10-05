// Draws the monthly Akash usage statement (statement.js) as an A4 PDF in the
// layout of every statement Eigenbeleg (pdf/statement-layout.js): the wallet,
// the month's totals, the network fees with their hashes, AKT burnt for ACT,
// the deployments' usage, how amounts were reached, and a line to sign.
// Loaded on first use.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { amount } from '../export/datev.js';
import { statementLayout } from '../pdf/statement-layout.js';

/** `0.123456` → `0,123456`. @param {string} d */
const num = (d) => String(d).replace('.', ',');
/** @param {number | null} cents */
const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);
/** @param {string} iso */
const day = (iso) => formatDate(String(iso).slice(0, 10), DOCUMENT_LOCALE);
/** @param {string} iso */
const utc = (iso) => `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;

/**
 * @param {import('./statement.js').AkashStatementDocument} doc
 * @returns {Promise<Uint8Array>}
 */
export async function akashStatementPdf(doc) {
	const s = doc.data;
	const { width, head, field, rule, heading, table, signature, save } = await statementLayout({
		title: `Eigenbeleg ${doc.number} – Akash-Verbrauch ${s.month}`,
		created: new Date(doc.createdAt),
		continuation: `${doc.number} · Akash-Verbrauch ${s.month} (Fortsetzung)`
	});

	head(
		doc.number,
		doc.issuer,
		'Verbrauchsnachweis Akash Network – Akash stellt keine Rechnung aus.'
	);
	field(
		'Anbieter',
		'Akash Network (akash.network): dezentrale Rechenleistung, bezahlt auf der Chain'
	);
	field(
		'Wallet',
		`${doc.walletName ? `${doc.walletName}\n` : ''}${s.address}`,
		doc.walletName ? false : 'mono'
	);
	field('Zeitraum', `${day(`${s.month}-01`)} bis Monatsende (UTC)`);
	field(
		'Netzwerkgebühren',
		`${s.fees.length} Transaktionen · ${num(s.totals.feesAkt)} AKT · ${euro(s.totals.feesEurCents)}`,
		true
	);
	if (s.topUps.length) field('Aufladung (AKT → ACT)', `${num(s.totals.topUpsAkt)} AKT verbrannt`);
	field(
		'Verbrauch der Deployments',
		`${num(s.totals.usageAct)} ACT · ${euro(s.totals.usageEurCents)}`
	);

	if (s.fees.length) {
		rule();
		heading('Netzwerkgebühren');
		table(
			[
				{ title: 'Tag', width: 58 },
				{ title: 'Vorgang', width: 104 },
				{ title: 'AKT', width: 58, right: true },
				{ title: 'EUR', width: 46, right: true },
				{ title: 'Transaktion', width: width - 266, mono: true }
			],
			s.fees.map((f) => [day(f.date), f.memo || '—', num(f.akt), amount(f.eurCents), f.hash])
		);
		field(
			'Summe',
			`${num(s.totals.feesAkt)} AKT · ${euro(s.totals.feesEurCents)} (wie gebucht, zum Kurs des Tages)`,
			true
		);
	}

	if (s.topUps.length) {
		rule();
		heading('Aufladung: AKT für ACT verbrannt (Burn-Mint)');
		table(
			[
				{ title: 'Tag', width: 58 },
				{ title: 'AKT', width: 70, right: true },
				{ title: 'ACT', width: 70, right: true },
				{ title: 'EUR', width: 56, right: true },
				{ title: 'Transaktion', width: width - 254, mono: true }
			],
			s.topUps.map((u) => [
				day(u.date),
				num(u.akt),
				u.act ? num(u.act) : 'unbekannt',
				amount(u.eurCents),
				u.hash
			])
		);
	}

	rule();
	heading('Verbrauch der Deployments');
	if (s.usage.length) {
		table(
			[
				{ title: 'Deployment (dseq)', width: 92, mono: true },
				{ title: 'Laufzeit', width: width - 92 - 70 - 54 - 70 },
				{ title: 'ACT gesamt', width: 70, right: true },
				{ title: 'Anteil', width: 54, right: true },
				{ title: 'ACT im Monat', width: 70, right: true }
			],
			s.usage.map((u) => [
				u.dseq,
				`${utc(u.from)} – ${utc(u.until)}${u.state === 'active' ? ' (läuft)' : ''}`,
				num(u.total),
				`${Math.round(u.share * 100)} %`,
				num(u.inMonth)
			])
		);
	}
	field('Summe', `${num(s.totals.usageAct)} ACT · ${euro(s.totals.usageEurCents)}`, true);

	rule();
	field(
		'Bewertung',
		`Netzwerkgebühren und Aufladungen in EUR wie gebucht, zum Kurs des AKT an ihrem Tag. ACT ist Akashs Rechenguthaben zu etwa 1 USD (Burn-Mint); der Verbrauch ist mit 1 ACT = 1 USD und dem Referenzkurs der EZB ${s.rateDate ? `vom ${day(s.rateDate)} (${num(s.eurPerUsd ?? '')} EUR je USD)` : '(nicht verfügbar)'} umgerechnet. Die Bewertung ist mit dem Steuerberater abzustimmen.`
	);
	field(
		'Verbrauch je Monat',
		'Die Chain führt je Deployment nur, was es insgesamt an die Anbieter gezahlt hat. Der Betrag ist gleichmäßig über die Laufzeit von der Erstellung bis zur letzten Abrechnung verteilt; gezählt ist der Anteil dieses Monats.'
	);
	field(
		'Quelle',
		'Buchungen der Wallet in Belege; Deployments und Escrow-Konten vom Akash-Knoten, Blockzeiten vom Akash-Console-Indexer, nur gelesen.'
	);
	field('Warum kein Fremdbeleg', doc.reason);
	rule();
	field('Erstellt', `${day(doc.createdAt)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`);
	signature();
	return save();
}

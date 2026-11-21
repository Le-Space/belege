// Draws a Filecoin Pay usage statement (filecoin-pay.js) as an A4 PDF/A-2b:
// an Eigenbeleg in the layout of every statement Eigenbeleg
// (@le-space/eigenbeleg's statement-layout), with the balance before and
// after, what was paid in and taken out, the month by rail, every
// settlement (when, which rail, up to when it paid, the amount and its euro
// value), how each was split and its transaction, the rails with their
// providers' full addresses, how the euro value was reached, where the
// numbers come from and what they leave out, and a line to sign.
// Loaded on first use.

/* eslint-disable belege/no-german -- a PDF for German bookkeeping stays German (#192) */

import { formatDate } from '../bank/format.js';
import { DOCUMENT_LOCALE } from '../i18n/index.js';
import { amount } from '../export/datev.js';
import { statementLayout } from '@le-space/eigenbeleg/statement-layout';
import { byRail, shortAmount } from './filecoin-pay.js';

/** The payment contract, as @le-space/chains names it (public, like a BIC). */
const CONTRACT = '0x23b1e018f08bb982348b15a86ee926eebf7f4daa';

/** @param {number | null} cents */
const euro = (cents) => (cents === null ? '—' : `${amount(cents)} EUR`);
/** @param {string} iso */
const utc = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
/** @param {string} a */
const short = (a) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
/** @param {string} v */
const usdfc = (v) => `${shortAmount(v)} USDFC`;

/**
 * @param {import('./filecoin-pay.js').FilecoinPayDocument} doc
 * @param {{ issuerLogo?: Uint8Array | null }} [o] issuerLogo: the company's own logo (settings/issuer-logo.js), top right in the head
 * @returns {Promise<Uint8Array>}
 */
export async function filecoinPayPdf(doc, { issuerLogo = null } = {}) {
	const s = doc.statement;
	const created = new Date(doc.createdAt);
	const { width, head, field, rule, heading, table, signature, save } = await statementLayout({
		title: `Eigenbeleg ${doc.number} – Filecoin Pay ${s.month}`,
		created,
		continuation: `${doc.number} · Filecoin Pay ${s.month} (Fortsetzung)`,
		issuerLogo
	});

	head(
		doc.number,
		doc.issuer,
		'Verbrauchsnachweis Filecoin Pay – für den Speicher stellt niemand eine Rechnung aus.'
	);

	field(
		'Anbieter',
		`Filecoin Onchain Cloud: Speicheranbieter, bezahlt in ${s.asset} über den Zahlungsvertrag Filecoin Pay (${CONTRACT})`
	);
	field(
		'Zahler',
		`${doc.walletName ? `${doc.walletName}\n` : ''}${s.filecoinAddress}\n${s.address}`,
		doc.walletName ? false : 'mono'
	);
	field('Zeitraum', `${utc(s.from)} bis ${utc(s.until)}`);
	field('Abgerechnet', `${usdfc(s.totals.usage)} · ${euro(s.totals.eurCents)}`, true);
	rule();

	field('Anfangsbestand', usdfc(s.opening));
	field('+ Eingezahlt', usdfc(s.totals.deposits));
	field('− Ausgezahlt', usdfc(s.totals.withdrawals));
	field('− Abgerechnet', usdfc(s.totals.usage));
	field('= Endbestand', usdfc(s.closing), true);
	field(
		'Bestand jetzt',
		`${usdfc(s.now.funds)}, davon ${usdfc(s.now.lockedUp)} für laufende Rails gebunden (${utc(s.now.at)}). Anfangs- und Endbestand sind von diesem Stand aus zurückgerechnet.`
	);

	const rails = byRail(s);
	if (rails.length) {
		rule();
		heading('Monatsübersicht je Rail');
		table(
			[
				{ title: 'Rail', width: 40 },
				{ title: 'Dienst', width: 120 },
				{ title: 'Anbieter', width: width - 40 - 120 - 60 - 90 - 70, mono: true },
				{ title: 'Anzahl', width: 60, right: true },
				{ title: s.asset, width: 90, right: true },
				{ title: 'EUR', width: 70, right: true }
			],
			rails.map((r) => [
				r.railId,
				r.service || '—',
				short(r.payee),
				String(r.lines),
				shortAmount(r.amount),
				r.eurCents === null ? '—' : amount(r.eurCents)
			])
		);
	}

	if (s.deposits.length || s.withdrawals.length) {
		rule();
		heading('Ein- und Auszahlungen');
		table(
			[
				{ title: 'Zeitpunkt', width: 90 },
				{ title: 'Art', width: 70 },
				{ title: s.asset, width: 80, right: true },
				{ title: 'Von / an', width: 100, mono: true },
				{ title: 'Transaktion', width: width - 340, mono: true }
			],
			[
				...s.deposits.map((d) => [
					utc(d.time),
					'Einzahlung',
					shortAmount(d.amount),
					d.other === s.address ? 'Zahler selbst' : short(d.other),
					d.txHash
				]),
				...s.withdrawals.map((w) => [
					utc(w.time),
					'Auszahlung',
					`−${shortAmount(w.amount)}`,
					w.other === s.address ? 'Zahler selbst' : short(w.other),
					w.txHash
				])
			]
		);
	}

	rule();
	heading('Abrechnungen');
	if (s.usage.length) {
		table(
			[
				{ title: 'Abgerechnet (UTC)', width: 92 },
				{ title: 'Rail', width: 34 },
				{ title: 'Dienst', width: width - 92 - 34 - 82 - 80 - 56 - 60 },
				{ title: 'Bezahlt bis', width: 82 },
				{ title: s.asset, width: 80, right: true },
				{ title: `EUR/${s.asset}`, width: 56, right: true },
				{ title: 'EUR', width: 60, right: true }
			],
			s.usage.map((u) => [
				utc(u.time),
				u.railId,
				u.service || '—',
				u.paidUntil ? formatDate(u.paidUntil.slice(0, 10), DOCUMENT_LOCALE) : 'Einmalzahlung',
				shortAmount(u.amount),
				u.eurPerUnit?.replace('.', ',') ?? '—',
				u.eurCents === null ? '—' : amount(u.eurCents)
			])
		);
		field('Summe', `${usdfc(s.totals.usage)} · ${euro(s.totals.eurCents)}`, true);

		rule();
		heading('Aufteilung und Transaktionen');
		table(
			[
				{ title: 'Rail', width: 34 },
				{ title: 'an Anbieter', width: 76, right: true },
				{ title: 'Provision', width: 66, right: true },
				{ title: 'Netzwerkgebühr', width: 70, right: true },
				{ title: 'Transaktion', width: width - 246, mono: true }
			],
			s.usage.map((u) => [
				u.railId,
				shortAmount(u.toPayee),
				shortAmount(u.commission),
				shortAmount(u.networkFee),
				u.txHash
			])
		);

		rule();
		heading('Rails und Anbieter');
		table(
			[
				{ title: 'Rail', width: 34 },
				{ title: 'Dienst', width: 120 },
				{ title: 'Provision', width: 56, right: true },
				{ title: 'Seit', width: 62 },
				{ title: 'Anbieter (Zahlungsempfänger)', width: width - 272, mono: true }
			],
			Object.values(s.rails).map((r) => [
				r.id,
				r.service || '—',
				`${(r.commissionBps / 100).toString().replace('.', ',')} %`,
				formatDate(r.createdAt.slice(0, 10), DOCUMENT_LOCALE),
				r.payee
			])
		);
	} else {
		field('', 'In diesem Monat wurde nichts abgerechnet.');
	}

	rule();
	field(
		'Bewertung',
		`${s.asset} ist ein an den US-Dollar gebundener Token. Jede Abrechnung ist mit dem Kurs ihres Tages in EUR umgerechnet${s.rateSource ? ` (Quelle: ${s.rateSource})` : ''}; Beträge sind auf sechs Nachkommastellen gekürzt gezeigt. Die Bewertung ist mit dem Steuerberater abzustimmen.`
	);
	field(
		'Quelle',
		`${
			s.source === 'index'
				? 'Abrechnungen und Bestand: der öffentliche Index der Filecoin-Pay-Macher (Subgraph bei Goldsky).'
				: 'Abrechnungen und Bestand: die Ereignisse des Zahlungsvertrags bei Blockscout (der Index hat nicht geantwortet).'
		} ${
			s.movementsFrom === 'transfers'
				? 'Ein- und Auszahlungen: die USDFC-Überweisungen zwischen Zahler und Vertrag laut Filfox. Was eine andere Adresse auf dieses Guthaben eingezahlt hat, fehlt darin; Anfangs- und Endbestand weichen dann um diesen Betrag ab.'
				: 'Ein- und Auszahlungen: die Ereignisse des Zahlungsvertrags bei Blockscout.'
		} Nur gelesen.`
	);
	field(
		'Grenzen',
		'Gelesen wird nur USDFC. Eine Abrechnung bezahlt den Speicher bis zu dem Zeitpunkt, den sie nennt, und wird ausgelöst, wenn jemand sie anstößt: Die Abrechnungen eines Monats decken darum nicht genau diesen Monat, und was seit der letzten Abrechnung aufgelaufen ist, steht nicht darin. Was der Zahler selbst über Rails einnimmt, ist nicht gelesen; die Bestände wären um diesen Betrag zu niedrig.'
	);
	field('Warum kein Fremdbeleg', doc.reason);
	rule();
	field(
		'Erstellt',
		`${formatDate(doc.createdAt.slice(0, 10), DOCUMENT_LOCALE)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`
	);
	signature();

	return save();
}

// "Uebersicht_<YYYY-MM>.csv" in the ZIP: every booking of the month in one
// table a person reads (UTF-8 with a byte order mark, so a spreadsheet opens
// the umlauts right; ";" and a decimal comma, as German spreadsheets expect).
// It says how each receipt was linked (receipts/origin.js) and what is not
// in the Buchungsstapel and why. Pure.

import { accountLabel, formatDate } from '../bank/format.js';
import { t } from '../i18n/index.js';
import { coverageBadge } from '../matching/view.js';
import { foundByAi, matchOrigin } from '../receipts/origin.js';
import { amount } from './datev.js';

/** @typedef {Record<string, any>} Rec */

/** The byte order mark that tells a spreadsheet the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

export const OVERVIEW_COLUMNS = Object.freeze([
	'Datum',
	'Betrag',
	'Gegenpartei',
	'Bankkonto',
	'Konto',
	'Gegenkonto',
	'BU-Schlüssel',
	'Belegnummer',
	'Belege',
	'Herkunft',
	'Hinweis'
]);

/** @param {unknown} v */
function cell(v) {
	const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
	return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** -12,50 / 119,00: signed, decimal comma. @param {number} cents */
const signed = (cents) => `${cents < 0 ? '-' : ''}${amount(cents)}`;

/**
 * How a booking's receipt came to it, in the app's words.
 *
 * @param {Rec | null} match
 * @param {Rec | null} receipt
 * @param {Rec} tx
 * @param {Record<string, any>} classifications
 */
export function originText(match, receipt, tx, classifications) {
	const o = matchOrigin(match);
	if (o && receipt) {
		const base = t(`belege.origin.badge.${o.kind}`, { score: o.score ?? 0 });
		return foundByAi(receipt) ? `${base} · ${t('belege.origin.ai')}` : base;
	}
	const cover = coverageBadge(/** @type {any} */ (tx), classifications);
	return cover ? t(`matching.badge.${cover}`) : t('export.overview.noReceipt');
}

/**
 * @param {import('./plan.js').MonthPlan} plan
 * @param {{ accounts: Rec[], classifications: Record<string, any> }} context
 * @returns {string}
 */
export function overviewCsv(plan, { accounts, classifications }) {
	const bank = (/** @type {Rec} */ tx) => {
		const a = accounts.find((x) => x.id === tx.accountId);
		return a ? `${accountLabel(a)}` : '';
	};
	/** @type {string[][]} */
	const rows = [];
	for (const l of plan.lines) {
		const files = l.receipts.map((r) => plan.numbers.get(r.id) ?? '').filter(Boolean);
		const notes = [
			l.transferWith
				? t('export.overview.transferLine', { date: formatDate(l.transferWith.bookedOn) })
				: '',
			...l.receipts
				.filter((r) => !plan.receipts.some((z) => z.id === r.id))
				.map((r) => t('export.overview.noFile', { number: plan.numbers.get(r.id) ?? '' }))
		].filter(Boolean);
		rows.push([
			formatDate(l.tx.bookedOn),
			signed(l.line.amountCents),
			l.line.text,
			bank(l.tx),
			l.line.account,
			l.line.contra,
			l.line.taxKey,
			l.line.receiptNumber,
			files.join(', '),
			originText(l.match, l.receipts[0] ?? null, l.tx, classifications),
			notes.join(' · ')
		]);
	}
	for (const { tx, other } of plan.transferSides) {
		rows.push([
			formatDate(tx.bookedOn),
			signed(Number(tx.amountCents ?? 0)),
			String(tx.counterparty ?? ''),
			bank(tx),
			'',
			String(tx.booking?.account ?? ''),
			String(tx.booking?.taxKey ?? ''),
			'',
			'',
			originText(null, null, tx, classifications),
			t('export.overview.transferSide', { date: formatDate(other.bookedOn), bank: bank(other) })
		]);
	}
	return BOM + [OVERVIEW_COLUMNS, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

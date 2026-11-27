// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg as CSV, for a German spreadsheet or bookkeeping import:
// semicolons, decimal commas, UTF-8 with BOM, CRLF. Every entry of the
// period is a line, the ones not on the Eigenbeleg too, with the reason; a
// monthly consumption Eigenbeleg's usage entries under its number.
//
// A cell that starts like a formula (= + - @) is prefixed with ' so a
// spreadsheet shows it as text: account names and memos come from the chain,
// where anyone can write anything.
//
// In English (`doc.language`, language.js): English heads and words, decimal
// points; still semicolons, since texts hold commas.
//
// A wallet's network fees of a month that the statement folds into one
// collective line (#1044) stay a line each here; the last column names that
// collective line (`NG-<month>-<asset>`, as the statement and its annex do).

import { round } from '@le-space/ledger';
import { currencyPlaces, kindText } from './document.js';
import { localizeLabel, localizeSource } from './language.js';
import { feeGroupsOf } from './statement.js';

/** The head; rate and value name the document's currency. @param {string} currency */
const header = (currency) => [
	'Belegnummer',
	'Position',
	'Datum (UTC)',
	'Uhrzeit (UTC)',
	'Chain',
	'Netz',
	'Eigene Adresse',
	'Art',
	'Richtung',
	'Gegenpartei',
	'Asset',
	'Token-Contract',
	'Menge',
	`Kurs ${currency}`,
	`Wert ${currency}`,
	'Kursquelle',
	'Transaktions-Hash',
	'Explorer',
	'Auf Eigenbeleg',
	'Hinweis',
	'Sammelposten'
];

/** The head in English. @param {string} currency */
const headerEn = (currency) => [
	'Receipt number',
	'Position',
	'Date (UTC)',
	'Time (UTC)',
	'Chain',
	'Network',
	'Own address',
	'Kind',
	'Direction',
	'Counterparty',
	'Asset',
	'Token contract',
	'Amount',
	`Rate ${currency}`,
	`Value ${currency}`,
	'Rate source',
	'Transaction hash',
	'Explorer',
	'On receipt',
	'Note',
	'Group'
];

const DIRECTION = { sent: 'Ausgang', received: 'Eingang', fee: 'Gebühr' };
const DIRECTION_EN = { sent: 'out', received: 'in', fee: 'fee' };

/** `-0.5` → `-0,5` (a plain number for a spreadsheet: no grouping). @param {string} s */
const num = (s) => String(s).replace('.', ',');

/** @param {unknown} v */
function cell(v) {
	let s = String(v ?? '');
	if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([,.]\d+)?$/.test(s)) s = `'${s}`;
	return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {import('./document.js').EigenbelegDocument} doc
 * @param {{ collectFees?: boolean }} [o] collectFees: name each network fee's collective line in the
 *   last column, as the statement folds them (#1044); on unless switched off, as the statement's own
 * @returns {string}
 */
export function eigenbelegCsv(doc, { collectFees = true } = {}) {
	const currency = doc.currency ?? 'EUR';
	const en = doc.language === 'en';
	/** A plain number in the document's language: a decimal comma, or a point. @param {string} x */
	const n = (x) => (en ? String(x) : num(x));
	const yes = en ? 'yes' : 'ja';
	/** @type {unknown[][]} */
	const rows = [(en ? headerEn : header)(currency)];
	const places = currencyPlaces(currency);
	const numberOf = (/** @type {number | string} */ pos) =>
		doc.layout === 'single' ? (doc.transactions[Number(pos) - 1]?.number ?? '') : doc.number;
	// The collective lines of the statement (#1044): each account's network fees of a month, from two on.
	/** @type {Map<import('./value.js').ValuedEntry, string>} */
	const groupOf = new Map();
	if (collectFees) {
		const all = [...doc.positions.map((p) => p.entry), ...doc.excluded.map((x) => x.entry)];
		/** @type {Map<string, import('./value.js').ValuedEntry[]>} */
		const byAccount = new Map();
		for (const e of all)
			byAccount.set(`${e.chain}|${e.network}|${e.account}`, [
				...(byAccount.get(`${e.chain}|${e.network}|${e.account}`) ?? []),
				e
			]);
		for (const list of byAccount.values()) {
			// In time order, as the statement reads them.
			const sorted = [...list].sort((a, b) => String(a.time).localeCompare(String(b.time)));
			for (const [i, label] of feeGroupsOf(sorted)) groupOf.set(sorted[i], label);
		}
	}
	/** @param {import('./value.js').ValuedEntry} e @param {string | number} pos @param {boolean} on @param {string} why */
	const line = (e, pos, on, why) => [
		on ? numberOf(pos) : '',
		pos,
		e.date,
		e.time.slice(11, 19),
		e.chain,
		e.network,
		e.account,
		kindText(e, doc.language),
		(en ? DIRECTION_EN : DIRECTION)[e.type],
		e.counterpartyLabel
			? `${localizeLabel(e.counterpartyLabel, doc.language)} (${e.counterparty})`
			: e.counterparty,
		e.asset,
		e.contract,
		n(e.amount),
		e.eur ? n(e.eur.rate) : '',
		e.eur ? n(e.eur.value) : '',
		localizeSource(e.eur?.source ?? '', doc.language),
		e.hash,
		e.explorerUrl,
		on ? yes : en ? 'no' : 'nein',
		why,
		groupOf.get(e) ?? ''
	];
	for (const p of doc.positions) rows.push(line(p.entry, p.pos, true, ''));
	// A month's consumption (consumption.js): every usage entry it sums, under its own number; the position is its line.
	for (const r of doc.consumption ?? [])
		r.lines.forEach((l, i) => {
			for (const e of l.entries) {
				const row = line(e, i + 1, true, '');
				row[0] = r.number;
				row[19] = e.eur
					? ''
					: en
						? 'no reliable rate: not in the amount'
						: 'kein verlässlicher Kurs: nicht im Betrag';
				rows.push(row);
			}
		});
	for (const x of doc.excluded) rows.push(line(x.entry, '', false, x.why));
	rows.push([]);
	rows.push([
		doc.layout === 'single' ? '' : doc.number,
		en ? 'Total' : 'Summe',
		'',
		'',
		doc.chain,
		doc.network,
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		'',
		n(round(`-${doc.totals.eurExact}`, places)),
		en
			? `${currency === 'EUR' ? 'rounded to cents' : places ? `rounded to ${places} decimals` : 'rounded to whole amounts'}, unrounded ${doc.totals.eurExact === '0' ? '0' : '-' + doc.totals.eurExact}`
			: `${currency === 'EUR' ? 'gerundet auf Cent' : places ? `gerundet auf ${places} Nachkommastellen` : 'gerundet auf ganze Beträge'}, ungerundet ${doc.totals.eurExact === '0' ? '0' : '-' + num(doc.totals.eurExact)}`,
		'',
		'',
		yes,
		'',
		''
	]);
	return '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

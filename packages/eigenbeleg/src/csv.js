// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg as CSV, for a German spreadsheet or bookkeeping import:
// semicolons, decimal commas, UTF-8 with BOM, CRLF. Every entry of the
// period is a line, the ones not on the Eigenbeleg too, with the reason.
//
// A cell that starts like a formula (= + - @) is prefixed with ' so a
// spreadsheet shows it as text: account names and memos come from the chain,
// where anyone can write anything.

import { round } from '@le-space/ledger';
import { kindText } from './document.js';

const HEADER = [
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
	'Kurs EUR',
	'Wert EUR',
	'Kursquelle',
	'Transaktions-Hash',
	'Explorer',
	'Auf Eigenbeleg',
	'Hinweis'
];

const DIRECTION = { sent: 'Ausgang', received: 'Eingang', fee: 'Gebühr' };

/** `-0.5` → `-0,5` (a plain number for a spreadsheet: no grouping). @param {string} s */
const num = (s) => String(s).replace('.', ',');

/** @param {unknown} v */
function cell(v) {
	let s = String(v ?? '');
	if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
	return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {import('./document.js').EigenbelegDocument} doc
 * @returns {string}
 */
export function eigenbelegCsv(doc) {
	/** @type {unknown[][]} */
	const rows = [HEADER];
	const numberOf = (/** @type {number | string} */ pos) =>
		doc.layout === 'single' ? (doc.transactions[Number(pos) - 1]?.number ?? '') : doc.number;
	/** @param {import('./value.js').ValuedEntry} e @param {string | number} pos @param {boolean} on @param {string} why */
	const line = (e, pos, on, why) => [
		on ? numberOf(pos) : '',
		pos,
		e.date,
		e.time.slice(11, 19),
		e.chain,
		e.network,
		e.account,
		kindText(e),
		DIRECTION[e.type],
		e.counterpartyLabel ? `${e.counterpartyLabel} (${e.counterparty})` : e.counterparty,
		e.asset,
		e.contract,
		num(e.amount),
		e.eur ? num(e.eur.rate) : '',
		e.eur ? num(e.eur.value) : '',
		e.eur?.source ?? '',
		e.hash,
		e.explorerUrl,
		on ? 'ja' : 'nein',
		why
	];
	for (const p of doc.positions) rows.push(line(p.entry, p.pos, true, ''));
	for (const x of doc.excluded) rows.push(line(x.entry, '', false, x.why));
	rows.push([]);
	rows.push([
		doc.layout === 'single' ? '' : doc.number,
		'Summe',
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
		num(round(`-${doc.totals.eurExact}`, 2)),
		`gerundet auf Cent, ungerundet ${doc.totals.eurExact === '0' ? '0' : '-' + num(doc.totals.eurExact)}`,
		'',
		'',
		'ja',
		''
	]);
	return '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

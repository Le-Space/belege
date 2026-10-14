// A company credit card's statement, from the card issuer's CSV export
// (issue #382). Read in the browser: the file goes no further than this page.
//
// Card issuers name their columns differently; the usual German and English
// names are recognised (DETECT), and what is not can be assigned by hand
// before the import (a mapping kept on the card's account). Each line becomes
// a booking of the card's account, as a bank line does:
//
//   date         the purchase's day (Belegdatum, Umsatzdatum …); else the
//                posting day (Buchungsdatum)
//   description  the merchant – as the counterparty, for the matching
//   amount       in euros, the card's currency; or debit and credit apart
//   original     an amount in another currency with its currency (and rate):
//                the receipt's euros come from the line (receipts/view.js euroOf)
//
// Charges are money out. Many issuers list them as positive amounts: the sign
// is turned round where no debit/credit columns say otherwise and most lines
// are positive (`invert`, shown and changeable before the import). The line
// that settles the card from the bank (a credit: "Zahlung erhalten",
// "Lastschrift" …) is kept with its booking type `Kartenausgleich`.
//
// Pure.

import { splitCsvLine } from '../booking/chart.js';

/** @typedef {import('./import.js').IncomingTransaction} IncomingTransaction */

export const FIELDS = /** @type {const} */ ([
	'date',
	'postingDate',
	'description',
	'amount',
	'debit',
	'credit',
	'currency',
	'originalAmount',
	'originalCurrency',
	'rate',
	'reference'
]);

/** @typedef {typeof FIELDS[number]} Field */
/** @typedef {Partial<Record<Field, number>>} Mapping column index by field */

/**
 * The names a column goes by, lower case, umlauts as ae/oe/ue, in the order
 * fields are assigned (the specific before the general: "Originalbetrag"
 * before "Betrag").
 *
 * @type {[Field, string[]][]}
 */
const DETECT = [
	[
		'originalAmount',
		[
			'originalbetrag',
			'ursprunglicher betrag',
			'urspruenglicher betrag',
			'betrag in fremdwaehrung',
			'fremdwaehrungsbetrag',
			'original amount',
			'foreign amount',
			'amount in original currency'
		]
	],
	[
		'originalCurrency',
		['originalwaehrung', 'fremdwaehrung', 'original currency', 'foreign currency']
	],
	['rate', ['wechselkurs', 'umrechnungskurs', 'kurs', 'exchange rate', 'fx rate', 'rate']],
	['debit', ['soll', 'belastung', 'debit']],
	['credit', ['haben', 'gutschrift', 'credit']],
	[
		'postingDate',
		['buchungsdatum', 'buchungstag', 'posting date', 'booking date', 'wertstellung', 'valuta']
	],
	[
		'date',
		[
			'belegdatum',
			'umsatzdatum',
			'transaktionsdatum',
			'kaufdatum',
			'transaction date',
			'purchase date',
			'datum',
			'date'
		]
	],
	['amount', ['betrag', 'umsatz in eur', 'amount', 'umsatz']],
	['currency', ['waehrung', 'currency']],
	[
		'description',
		[
			'beschreibung',
			'haendler',
			'verwendungszweck',
			'umsatzbeschreibung',
			'buchungstext',
			'text',
			'description',
			'merchant',
			'payee',
			'details',
			'empfaenger'
		]
	],
	[
		'reference',
		['referenznummer', 'referenz', 'belegnummer', 'reference', 'transaction id', 'transaktions-id']
	]
];

/** `Betrag (EUR)` → `betrag eur`. @param {string} s */
const norm = (s) =>
	s
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9-]+/g, ' ')
		.trim();

/**
 * Whether a column's name is one of a field's. A long name anywhere in it
 * ("Transaction Date"); a short one alone or with a currency after it
 * ("Betrag", "Betrag (EUR)", "Amount in EUR") – never as one word among
 * others ("Credit card number" is no credit column).
 *
 * @param {string} header normalised
 * @param {string} name
 */
const named = (header, name) =>
	name.length >= 8
		? header.includes(name)
		: header === name || new RegExp(`^${name} (in )?[a-z]{3}$`).test(header);

/**
 * The fields recognised in a header row.
 *
 * @param {string[]} header
 * @returns {Mapping}
 */
export function detectMapping(header) {
	const names = header.map(norm);
	/** @type {Mapping} */
	const out = {};
	const used = new Set();
	for (const [field, synonyms] of DETECT) {
		for (const synonym of synonyms) {
			const i = names.findIndex((h, j) => !used.has(j) && named(h, synonym));
			if (i >= 0) {
				out[field] = i;
				used.add(i);
				break;
			}
		}
	}
	return out;
}

/** The separator of a line: the one most often outside quotes. @param {string} line */
function separatorOf(line) {
	/** @type {Record<string, number>} */
	const counts = { ';': 0, '\t': 0, ',': 0 };
	let quoted = false;
	for (const c of line) {
		if (c === '"') quoted = !quoted;
		else if (!quoted && c in counts) counts[c]++;
	}
	const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return best[1] ? best[0] : ';';
}

/**
 * The table of a card statement: its header row (the first that names at
 * least a date and an amount – issuers put lines about the card above it),
 * the rows below, and the fields recognised.
 *
 * @param {string} text the file, decoded
 * @returns {{ header: string[], rows: string[][], mapping: Mapping }}
 */
export function readCardCsv(text) {
	const lines = String(text ?? '')
		.replace(/^\uFEFF/, '')
		.split(/\r\n|\n|\r/)
		.filter((l) => l.trim());
	for (let i = 0; i < Math.min(lines.length, 30); i++) {
		const sep = separatorOf(lines[i]);
		const header = splitCsvLine(lines[i], sep);
		const mapping = detectMapping(header);
		const dated = mapping.date !== undefined || mapping.postingDate !== undefined;
		const amounted =
			mapping.amount !== undefined || (mapping.debit !== undefined && mapping.credit !== undefined);
		if (dated && amounted) {
			const rows = lines
				.slice(i + 1)
				.map((l) => splitCsvLine(l, sep))
				.filter((r) => r.some((c) => c));
			return { header, rows, mapping };
		}
	}
	throw new Error('No card statement: no row names a date and an amount.');
}

/**
 * Cents of an amount as issuers write it: `1.234,56`, `1,234.56`, `-12,30`,
 * `12,30-`, `(12.30)`, `12,30 EUR`, `+5`. Null for anything else.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function parseAmount(text) {
	let s = String(text ?? '')
		.replace(/[A-Za-z€$£\s\u00a0]/g, '')
		.trim();
	if (!s) return null;
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	if (s.endsWith('-')) {
		negative = !negative;
		s = s.slice(0, -1);
	}
	if (/^[+-]/.test(s)) {
		if (s[0] === '-') negative = !negative;
		s = s.slice(1);
	}
	// The last separator followed by one or two digits is the decimal one.
	const m = /^(\d{1,3}(?:[.,']\d{3})*|\d+)(?:([.,])(\d{1,2}))?$/.exec(s);
	if (!m) return null;
	const whole = Number(m[1].replace(/[.,']/g, ''));
	const cents = whole * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
	if (!Number.isSafeInteger(cents)) return null;
	return negative ? -cents : cents;
}

/**
 * A day as issuers write it: `31.05.2026`, `31.05.26`, `2026-05-31`,
 * `31/05/2026`; a time after it is ignored. Null for anything else.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function parseDay(text) {
	const s = String(text ?? '').trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
	/** @type {[number, number, number] | null} */
	let ymd = m ? [+m[1], +m[2], +m[3]] : null;
	if (!ymd) {
		m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\b/.exec(s);
		if (m) ymd = [m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]];
	}
	if (!ymd) return null;
	const [y, mo, d] = ymd;
	const date = new Date(Date.UTC(y, mo - 1, d));
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
		return null;
	return date.toISOString().slice(0, 10);
}

/** What issuers call the bank's payment that settles the card. */
const SETTLEMENT =
	/zahlung erhalten|zahlungseingang|lastschrift|ausgleich|abbuchung|einzug|payment received|thank you|direct debit/i;

/** `123456` cents → `1234.56`. @param {number} cents */
const decimal = (cents) => {
	const abs = Math.abs(cents);
	return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/**
 * Whether charges come as positive amounts: no debit/credit columns, and most
 * lines positive.
 *
 * @param {{ rows: string[][], mapping: Mapping }} table
 */
export function chargesPositive({ rows, mapping }) {
	if (mapping.debit !== undefined || mapping.amount === undefined) return false;
	const amounts = rows
		.map((r) => parseAmount(r[/** @type {number} */ (mapping.amount)] ?? ''))
		.filter((c) => c !== null && c !== 0);
	return amounts.filter((c) => /** @type {number} */ (c) > 0).length > amounts.length / 2;
}

/**
 * The lines of a card statement as bookings of the card's account.
 *
 * @param {{ rows: string[][], mapping: Mapping }} table
 * @param {{ invert?: boolean, currency?: string }} [options] invert: charges come positive
 * @returns {{ lines: IncomingTransaction[], skipped: { row: number, why: 'date' | 'amount' | 'currency' }[] }}
 */
export function cardLines({ rows, mapping }, { invert = false, currency = 'EUR' } = {}) {
	/** @type {IncomingTransaction[]} */
	const lines = [];
	/** @type {{ row: number, why: 'date' | 'amount' | 'currency' }[]} */
	const skipped = [];
	const cell = (/** @type {string[]} */ r, /** @type {Field} */ f) =>
		mapping[f] === undefined ? '' : String(r[/** @type {number} */ (mapping[f])] ?? '').trim();
	rows.forEach((r, row) => {
		const date = parseDay(cell(r, 'date')) ?? parseDay(cell(r, 'postingDate'));
		if (!date) return skipped.push({ row, why: 'date' });
		let cents;
		if (mapping.debit !== undefined || mapping.credit !== undefined) {
			const debit = parseAmount(cell(r, 'debit'));
			const credit = parseAmount(cell(r, 'credit'));
			cents =
				debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
		} else {
			const amount = parseAmount(cell(r, 'amount'));
			cents = amount === null ? null : invert ? -amount : amount;
		}
		if (cents === null || cents === 0) return skipped.push({ row, why: 'amount' });
		const billed = cell(r, 'currency').toUpperCase();
		if (billed && billed !== currency) return skipped.push({ row, why: 'currency' });
		const description = cell(r, 'description');
		const reference = cell(r, 'reference');
		const originalCurrency = cell(r, 'originalCurrency').toUpperCase();
		const originalCents = parseAmount(cell(r, 'originalAmount'));
		const rate = cell(r, 'rate').replace(',', '.');
		const original =
			/^[A-Z]{3}$/.test(originalCurrency) && originalCurrency !== currency && originalCents
				? {
						amount: decimal(originalCents),
						currency: originalCurrency,
						...(/^\d+(\.\d+)?$/.test(rate) ? { rate } : {})
					}
				: null;
		lines.push({
			sourceId: reference ? `card:${reference}` : null,
			date,
			valueDate: parseDay(cell(r, 'postingDate')) ?? date,
			amountCents: cents,
			currency,
			counterpartyName: description,
			purpose: [description, reference].filter(Boolean).join(' · '),
			...(cents > 0 && SETTLEMENT.test(description) ? { bookingType: 'Kartenausgleich' } : {}),
			...(original ? { original } : {})
		});
	});
	return { lines, skipped };
}

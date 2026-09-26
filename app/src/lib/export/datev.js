// The DATEV "Buchungsstapel" (EXTF CSV, format 700, category 21, format
// version 13) that MonkeyOffice and DATEV import. Everything about the
// format is in this one module, so an adjustment is one place. Pure.
//
// Sources: the field list and order follow the open-source Ruby gem
// ledermann/datev (lib/datev/base/header.rb, booking.rb and its
// examples/EXTF_Buchungsstapel.csv, format version 13), which follows
// DATEV's developer documentation; DATEV's own pages were not readable
// here. So:
//   - line 1: 31 header fields; line 2: the 125 column headings; then one
//     line per booking with 125 fields
//   - fields separated by ";", lines by CRLF, text in double quotes with
//     inner quotes doubled, empty fields left completely empty
//   - amounts positive with a decimal comma and no thousands separator;
//     S/H refers to the field "Konto" (here: the bank's ledger account), so
//     money in is S and money out is H
//   - Belegdatum as DDMM (DATEV takes the year from the fiscal year),
//     Belegfeld 1 at most 36 characters of [A-Za-z0-9$&%*+-/], Buchungstext
//     at most 60, Bezeichnung at most 30
//   - Windows-1252 (cp1252.js); the file is written in export/build.js
// Two headings are named as in the task that asked for this export
// ("Basis-Umsatz", "WKZ Basis-Umsatz"; the gem writes "Basisumsatz"). DATEV
// reads the fields by position, not by heading. See docs/export.md.

/** The column headings of format version 13, in order. */
export const COLUMNS = Object.freeze([
	'Umsatz (ohne Soll/Haben-Kz)',
	'Soll/Haben-Kennzeichen',
	'WKZ Umsatz',
	'Kurs',
	'Basis-Umsatz',
	'WKZ Basis-Umsatz',
	'Konto',
	'Gegenkonto (ohne BU-Schlüssel)',
	'BU-Schlüssel',
	'Belegdatum',
	'Belegfeld 1',
	'Belegfeld 2',
	'Skonto',
	'Buchungstext',
	'Postensperre',
	'Diverse Adressnummer',
	'Geschäftspartnerbank',
	'Sachverhalt',
	'Zinssperre',
	'Beleglink',
	'Beleginfo – Art 1',
	'Beleginfo – Inhalt 1',
	'Beleginfo – Art 2',
	'Beleginfo – Inhalt 2',
	'Beleginfo – Art 3',
	'Beleginfo – Inhalt 3',
	'Beleginfo – Art 4',
	'Beleginfo – Inhalt 4',
	'Beleginfo – Art 5',
	'Beleginfo – Inhalt 5',
	'Beleginfo – Art 6',
	'Beleginfo – Inhalt 6',
	'Beleginfo – Art 7',
	'Beleginfo – Inhalt 7',
	'Beleginfo – Art 8',
	'Beleginfo – Inhalt 8',
	'KOST1 – Kostenstelle',
	'KOST2 – Kostenstelle',
	'Kost Menge',
	'EU-Land u. USt-IdNr.',
	'EU-Steuersatz',
	'Abw. Versteuerungsart',
	'Sachverhalt L+L',
	'Funktionsergänzung L+L',
	'BU 49 Hauptfunktionstyp',
	'BU 49 Hauptfunktionsnummer',
	'BU 49 Funktionsergänzung',
	'Zusatzinformation – Art 1',
	'Zusatzinformation – Inhalt 1',
	'Zusatzinformation – Art 2',
	'Zusatzinformation – Inhalt 2',
	'Zusatzinformation – Art 3',
	'Zusatzinformation – Inhalt 3',
	'Zusatzinformation – Art 4',
	'Zusatzinformation – Inhalt 4',
	'Zusatzinformation – Art 5',
	'Zusatzinformation – Inhalt 5',
	'Zusatzinformation – Art 6',
	'Zusatzinformation – Inhalt 6',
	'Zusatzinformation – Art 7',
	'Zusatzinformation – Inhalt 7',
	'Zusatzinformation – Art 8',
	'Zusatzinformation – Inhalt 8',
	'Zusatzinformation – Art 9',
	'Zusatzinformation – Inhalt 9',
	'Zusatzinformation – Art 10',
	'Zusatzinformation – Inhalt 10',
	'Zusatzinformation – Art 11',
	'Zusatzinformation – Inhalt 11',
	'Zusatzinformation – Art 12',
	'Zusatzinformation – Inhalt 12',
	'Zusatzinformation – Art 13',
	'Zusatzinformation – Inhalt 13',
	'Zusatzinformation – Art 14',
	'Zusatzinformation – Inhalt 14',
	'Zusatzinformation – Art 15',
	'Zusatzinformation – Inhalt 15',
	'Zusatzinformation – Art 16',
	'Zusatzinformation – Inhalt 16',
	'Zusatzinformation – Art 17',
	'Zusatzinformation – Inhalt 17',
	'Zusatzinformation – Art 18',
	'Zusatzinformation – Inhalt 18',
	'Zusatzinformation – Art 19',
	'Zusatzinformation – Inhalt 19',
	'Zusatzinformation – Art 20',
	'Zusatzinformation – Inhalt 20',
	'Stück',
	'Gewicht',
	'Zahlweise',
	'Forderungsart',
	'Veranlagungsjahr',
	'Zugeordnete Fälligkeit',
	'Skontotyp',
	'Auftragsnummer',
	'Buchungstyp',
	'USt-Schlüssel (Anzahlungen)',
	'EU-Mitgliedstaat (Anzahlungen)',
	'Sachverhalt L+L (Anzahlungen)',
	'EU-Steuersatz (Anzahlungen)',
	'Erlöskonto (Anzahlungen)',
	'Herkunft-Kz',
	'Leerfeld',
	'KOST-Datum',
	'SEPA-Mandatsreferenz',
	'Skontosperre',
	'Gesellschaftername',
	'Beteiligtennummer',
	'Identifikationsnummer',
	'Zeichnernummer',
	'Postensperre bis',
	'Bezeichnung',
	'Kennzeichen',
	'Festschreibung',
	'Leistungsdatum',
	'Datum Zuord.',
	'Fälligkeit',
	'Generalumkehr',
	'Steuersatz',
	'Land',
	'Abrechnungsreferent',
	'BVV-Position',
	'EU-Mitgliedstaat u. UStID (Ursprung)',
	'EU-Steuersatz (Ursprung)',
	'Abw. Skontokonto'
]);

/** Fields in the header line of format version 13. */
export const HEADER_FIELDS = 31;

/** Belegfeld 1: what DATEV accepts, and how long. */
export const RECEIPT_FIELD = /^[A-Za-z0-9$&%*+\-/]{0,36}$/;

/**
 * A text field: in double quotes, inner quotes doubled, line breaks as
 * spaces, cut to `max` characters; empty stays completely empty.
 *
 * @param {unknown} value
 * @param {number} [max]
 */
export function text(value, max = 255) {
	const s = String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()
		.slice(0, max)
		.trim();
	return s ? `"${s.replace(/"/g, '""')}"` : '';
}

/**
 * 1234,56 – positive, decimal comma, no thousands separator.
 *
 * @param {number} cents
 */
export function amount(cents) {
	const abs = Math.abs(Math.round(cents));
	return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** `2026-09-05` → `0509`. @param {string} iso */
export function ddmm(iso) {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) throw new Error(`Not a date: ${iso}`);
	return `${m[3]}${m[2]}`;
}

/** `2026-09-05` → `20260905`. @param {string} iso */
const yyyymmdd = (iso) => iso.slice(0, 10).replace(/-/g, '');

/** @param {number} n @param {number} [w] */
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * YYYYMMDDHHMMSSFFF, in UTC.
 *
 * @param {Date} d
 */
export function timestamp(d) {
	return (
		`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
		pad(d.getUTCMilliseconds(), 3)
	);
}

/**
 * The first and the last day of a month, and the start of its fiscal year.
 *
 * @param {string} month YYYY-MM
 * @param {number} [fiscalYearStartMonth] 1–12
 * @returns {{ from: string, to: string, fiscalYearStart: string }} YYYY-MM-DD
 */
export function monthRange(month, fiscalYearStartMonth = 1) {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m) throw new Error(`Not a month: ${month}`);
	const year = Number(m[1]);
	const mon = Number(m[2]);
	const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
	const fyYear = mon >= fiscalYearStartMonth ? year : year - 1;
	return {
		from: `${month}-01`,
		to: `${month}-${pad(last)}`,
		fiscalYearStart: `${fyYear}-${pad(fiscalYearStartMonth)}-01`
	};
}

/**
 * Line 1.
 *
 * @param {object} params
 * @param {import('../booking/settings.js').DatevSettings} params.settings
 * @param {string} params.month YYYY-MM
 * @param {Date} params.created
 * @param {string} params.label Bezeichnung, at most 30 characters
 */
export function headerLine({ settings, month, created, label }) {
	const { from, to, fiscalYearStart } = monthRange(month, settings.fiscalYearStartMonth);
	const fields = [
		'"EXTF"', // 1 DATEV-Format-KZ
		'700', // 2 Versionsnummer
		'21', // 3 Datenkategorie: Buchungsstapel
		'"Buchungsstapel"', // 4 Formatname
		'13', // 5 Formatversion
		timestamp(created), // 6 Erzeugt am
		'', // 7 Importiert: set by the import
		'""', // 8 Herkunft
		'""', // 9 Exportiert von
		'', // 10 Importiert von: set by the import
		settings.consultantNumber, // 11 Beraternummer
		settings.clientNumber, // 12 Mandantennummer
		yyyymmdd(fiscalYearStart), // 13 WJ-Beginn
		String(settings.accountLength), // 14 Sachkontenlänge
		yyyymmdd(from), // 15 Datum vom
		yyyymmdd(to), // 16 Datum bis
		text(label, 30) || '""', // 17 Bezeichnung
		'""', // 18 Diktatkürzel
		'1', // 19 Buchungstyp: Finanzbuchführung
		'0', // 20 Rechnungslegungszweck: unabhängig
		'0', // 21 Festschreibung: nein
		'"EUR"' // 22 WKZ
	];
	while (fields.length < HEADER_FIELDS) fields.push(''); // 23–31: reserviert, SKR, …
	return fields.join(';');
}

/**
 * @typedef {object} BookingLine
 * @property {number} amountCents signed, from the bank account's view
 * @property {string} [currency]
 * @property {string} account Konto: the bank's ledger account
 * @property {string} contra Gegenkonto: the booking's account
 * @property {string} taxKey BU-Schlüssel, '' for none
 * @property {string} date YYYY-MM-DD, the booking date
 * @property {string} receiptNumber Belegfeld 1, '' for none
 * @property {string} text Buchungstext
 * @property {string} [costCentre] KOST1, '' or absent for none
 */

/** The column of KOST1 (Kostenstelle). */
const KOST1 = COLUMNS.indexOf('KOST1 – Kostenstelle');

/**
 * One booking.
 *
 * @param {BookingLine} b
 */
export function bookingLine(b) {
	if (!RECEIPT_FIELD.test(b.receiptNumber)) {
		throw new Error(`Belegfeld 1 takes 36 characters of A-Z 0-9 $&%*+-/: ${b.receiptNumber}`);
	}
	const fields = [
		amount(b.amountCents), // Umsatz
		b.amountCents >= 0 ? '"S"' : '"H"', // Soll/Haben, of "Konto"
		b.currency && b.currency !== 'EUR' ? text(b.currency, 3) : '', // WKZ Umsatz (header: EUR)
		'', // Kurs
		'', // Basis-Umsatz
		'', // WKZ Basis-Umsatz
		b.account, // Konto
		b.contra, // Gegenkonto (ohne BU-Schlüssel)
		text(b.taxKey, 4), // BU-Schlüssel
		ddmm(b.date), // Belegdatum
		text(b.receiptNumber, 36), // Belegfeld 1
		'', // Belegfeld 2
		'', // Skonto
		text(b.text, 60) // Buchungstext
	];
	while (fields.length < COLUMNS.length) fields.push('');
	if (b.costCentre) fields[KOST1] = text(b.costCentre, 36);
	return fields.join(';');
}

/**
 * The whole Buchungsstapel as text, CRLF after every line.
 *
 * @param {object} params
 * @param {import('../booking/settings.js').DatevSettings} params.settings
 * @param {string} params.month YYYY-MM
 * @param {Date} params.created
 * @param {string} [params.label]
 * @param {BookingLine[]} params.lines
 */
export function buchungsstapel({ settings, month, created, label, lines }) {
	return (
		[
			headerLine({ settings, month, created, label: label ?? `Belege ${month}` }),
			COLUMNS.join(';'),
			...lines.map(bookingLine)
		].join('\r\n') + '\r\n'
	);
}

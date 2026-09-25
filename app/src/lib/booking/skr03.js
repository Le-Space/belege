// A small SKR 03 catalogue: the accounts a small company books most, with
// their names, to pick from in "Konto". Any other number can be typed in.
//
// The numbers and names were compared with the public SKR 03 account pages
// of buchungssatz.de (September 2026), not with DATEV's own chart, which is
// not public. Which account a booking belongs on is the tax adviser's call:
// the catalogue is a starting point, to be checked with them (docs/export.md).
//
// `automatic`: an "Automatikkonto" (AM) in SKR 03 – DATEV computes the VAT
// from the account itself, so a booking on it carries no BU key (see
// tax-keys.js). Also to be checked with the tax adviser.

/**
 * @typedef {object} CatalogueAccount
 * @property {string} number
 * @property {string} name
 * @property {'expense' | 'income' | 'neutral' | 'private'} kind
 * @property {19 | 7} [automatic] the VAT rate of an Automatikkonto
 */

/** @type {readonly CatalogueAccount[]} */
export const SKR03_ACCOUNTS = Object.freeze([
	{ number: '1360', name: 'Geldtransit', kind: 'neutral' },
	{ number: '1800', name: 'Privatentnahmen allgemein', kind: 'private' },
	{ number: '1890', name: 'Privateinlagen', kind: 'private' },
	{ number: '4210', name: 'Miete (unbewegliche Wirtschaftsgüter)', kind: 'expense' },
	{ number: '4360', name: 'Versicherungen', kind: 'expense' },
	{ number: '4600', name: 'Werbekosten', kind: 'expense' },
	{ number: '4650', name: 'Bewirtungskosten', kind: 'expense' },
	{ number: '4660', name: 'Reisekosten Arbeitnehmer', kind: 'expense' },
	{ number: '4670', name: 'Reisekosten Unternehmer', kind: 'expense' },
	{
		number: '4800',
		name: 'Reparaturen und Instandhaltung von technischen Anlagen und Maschinen',
		kind: 'expense'
	},
	{ number: '4806', name: 'Wartungskosten für Hard- und Software', kind: 'expense' },
	{ number: '4900', name: 'Sonstige betriebliche Aufwendungen', kind: 'expense' },
	{ number: '4910', name: 'Porto', kind: 'expense' },
	{ number: '4920', name: 'Telefon', kind: 'expense' },
	{ number: '4925', name: 'Telefax und Internetkosten', kind: 'expense' },
	{ number: '4930', name: 'Bürobedarf', kind: 'expense' },
	{ number: '4940', name: 'Zeitschriften, Bücher (Fachliteratur)', kind: 'expense' },
	{ number: '4950', name: 'Rechts- und Beratungskosten', kind: 'expense' },
	{ number: '4955', name: 'Buchführungskosten', kind: 'expense' },
	{
		number: '4964',
		name: 'Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)',
		kind: 'expense'
	},
	{ number: '4970', name: 'Nebenkosten des Geldverkehrs', kind: 'expense' },
	{ number: '8300', name: 'Erlöse 7 % USt', kind: 'income', automatic: 7 },
	{ number: '8400', name: 'Erlöse 19 % USt', kind: 'income', automatic: 19 }
]);

/** Own transfers between our accounts (classify.js `own-transfer`). */
export const TRANSFER_ACCOUNT = '1360';
/** Bank fees (classify.js `bank-fee`). */
export const FEE_ACCOUNT = '4970';

/** @param {unknown} v */
const digits = (v) => String(v ?? '').trim();

/**
 * Whether a text is an account number: 4 to 8 digits (DATEV's Sachkonten).
 *
 * @param {unknown} v
 */
export function isAccountNumber(v) {
	return /^\d{4,8}$/.test(digits(v));
}

/**
 * The catalogue entry of a number, or null for a number of the person's own.
 *
 * @param {unknown} number
 * @returns {CatalogueAccount | null}
 */
export function catalogueAccount(number) {
	const n = digits(number);
	return SKR03_ACCOUNTS.find((a) => a.number === n) ?? null;
}

/**
 * "4930 Bürobedarf", or the number alone.
 *
 * @param {unknown} number
 */
export function accountLabel(number) {
	const a = catalogueAccount(number);
	return a ? `${a.number} ${a.name}` : digits(number);
}

/**
 * The catalogue filtered by a search: number prefix or words of the name.
 * Income first for money in, expenses first for money out.
 *
 * @param {string} query
 * @param {{ income?: boolean }} [options]
 * @returns {CatalogueAccount[]}
 */
export function searchAccounts(query, { income = false } = {}) {
	const q = query.trim().toLowerCase();
	const hits = SKR03_ACCOUNTS.filter(
		(a) => !q || a.number.startsWith(q) || a.name.toLowerCase().includes(q)
	);
	const rank = (/** @type {CatalogueAccount} */ a) =>
		a.kind === (income ? 'income' : 'expense') ? 0 : 1;
	return [...hits].sort((a, b) => rank(a) - rank(b) || (a.number < b.number ? -1 : 1));
}

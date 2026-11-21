// What a BU key (DATEV "BU-Schlüssel") means, in words: shown beside the key
// wherever the app shows one, because a number alone tells a person who does
// not book every day nothing.
//
// Two sources, in this order:
//   1. the books' own keys (settings.js `taxKeys`): a key the tax adviser set
//      for a role means that role here, whatever DATEV's standard says;
//   2. DATEV's standard keys, the same in SKR 03 and SKR 04, as far as they are
//      listed below. Not the whole list: only keys whose meaning is not in
//      doubt. A key that is not listed gets no words, not a guess.
// The chart of accounts a person reads in carries account names, no keys.
import { t } from '../i18n/index.js';
import { DEFAULT_TAX_KEYS } from './settings.js';

/** DATEV's standard keys that have words here (`booking.taxKeyName.<key>`). */
export const STANDARD_TAX_KEYS = Object.freeze([
	'2',
	'3',
	'8',
	'9',
	'11',
	'18',
	'19',
	'40',
	'91',
	'94'
]);

/** The roles of settings.js `taxKeys`, in the order they are offered. */
const ROLES = /** @type {const} */ (['input19', 'input7', 'output19', 'output7', 'reverseCharge']);

/**
 * @param {unknown} key
 * @param {import('./settings.js').TaxKeys} [keys] the books' keys
 * @returns {string} '' for no key or one without words
 */
export function taxKeyName(key, keys = DEFAULT_TAX_KEYS) {
	const k = String(key ?? '').trim();
	if (!k) return '';
	const role = ROLES.find((r) => String(keys?.[r] ?? '') === k);
	if (role) return t(`booking.taxKeyRole.${role}`);
	return STANDARD_TAX_KEYS.includes(k) ? t(`booking.taxKeyName.${k}`) : '';
}

/**
 * "9 – Vorsteuer 19 %", or the key alone.
 *
 * @param {unknown} key
 * @param {import('./settings.js').TaxKeys} [keys]
 */
export function taxKeyLabel(key, keys = DEFAULT_TAX_KEYS) {
	const k = String(key ?? '').trim();
	const name = taxKeyName(k, keys);
	return name ? `${k} – ${name}` : k;
}

/**
 * The keys the "BU-Schlüssel" field offers: the books' own first, then the
 * standard ones not among them.
 *
 * @param {import('./settings.js').TaxKeys} [keys]
 * @returns {string[]}
 */
export function offeredTaxKeys(keys = DEFAULT_TAX_KEYS) {
	const own = ROLES.map((r) => String(keys?.[r] ?? '')).filter(Boolean);
	return [...new Set([...own, ...STANDARD_TAX_KEYS])];
}

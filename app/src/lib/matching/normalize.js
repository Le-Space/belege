// Text and date helpers for matching. Pure.
//
// Invoice and customer numbers are compared with every separator stripped:
// pdf.js turns `ZIVYFQIJ-0002` into `ZIVYFQIJ 0002`, and a bank writes
// `RE 2026/004` where the invoice says `RE-2026-004` (docs/phase-0.md).

/**
 * Lower case, accents folded, only letters and digits left.
 *
 * @param {unknown} s
 */
export function normalizeRef(s) {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]/g, '');
}

/** Legal forms and filler words that say nothing about who a vendor is. */
export const STOP_WORDS = new Set([
	'gmbh',
	'mbh',
	'ag',
	'se',
	'sa',
	'sas',
	'sarl',
	'bv',
	'nv',
	'inc',
	'llc',
	'ltd',
	'limited',
	'plc',
	'pbc',
	'corp',
	'co',
	'kg',
	'ohg',
	'gbr',
	'ug',
	'eg',
	'ev',
	'haftungsbeschrankt',
	'und',
	'and',
	'the',
	'der',
	'die',
	'das',
	'fur',
	'von',
	'online',
	'services',
	'service',
	'germany',
	'deutschland',
	'europe',
	'international',
	'group',
	'holding',
	'www',
	'com',
	'de',
	'net',
	'org',
	'rechnung',
	'invoice',
	'lastschrift',
	'kartenzahlung',
	'zahlung'
]);

/**
 * The words that name a vendor: lower case, accents folded, legal forms and
 * fillers dropped, at least three characters.
 *
 * @param {unknown} s
 * @returns {string[]}
 */
export function vendorWords(s) {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/ß/g, 'ss')
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * How much two names overlap: the share of the shorter name's words found in
 * the other, 0 … 1.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function nameOverlap(a, b) {
	const wa = [...new Set(vendorWords(a))];
	const wb = [...new Set(vendorWords(b))];
	if (!wa.length || !wb.length) return 0;
	const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
	return short.filter((w) => long.has(w)).length / short.length;
}

/** `YYYY-MM-DD` → days since the epoch, or null. */
export function dayNumber(/** @type {unknown} */ iso) {
	if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
	const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
	return Number.isFinite(t) ? Math.round(t / 864e5) : null;
}

/** A compact, upper-case IBAN, or '' when it does not look like one. */
export function compactIban(/** @type {unknown} */ s) {
	const c = String(s ?? '')
		.replace(/\s/g, '')
		.toUpperCase();
	return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(c) ? c : '';
}

/**
 * Whether two names name the same vendor: half the shorter name's words in
 * the other, and – when the shorter name has several – either two shared
 * words or the leading word of one of them ("Stromwerk Test AG" is not
 * "Kaffeerösterei Test").
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameVendor(a, b) {
	const wa = [...new Set(vendorWords(a))];
	const wb = [...new Set(vendorWords(b))];
	if (!wa.length || !wb.length) return false;
	const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
	const inLong = new Set(long);
	const shared = short.filter((w) => inLong.has(w));
	if (shared.length / short.length < 0.5) return false;
	if (short.length === 1 || shared.length >= 2) return true;
	return shared.includes(short[0]) || shared.includes(long[0]);
}

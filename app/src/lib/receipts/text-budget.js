// How much of a receipt's text goes to the bridge (#975). A statement or a
// contract of many pages, a long OCR text, can outgrow what one request to
// the bridge's node takes (sync/bridge-limit.js), and the bridge hands the
// model at most MAX_TEXT characters anyway. The fields "Auslesen" looks for
// (vendor, number, date, kind at the top; totals and VAT at the bottom) sit
// on the first and the last page, so a text too long keeps its head and its
// tail, with a marker where the middle was left out. Pure.

/** What the bridge hands the model at most (bridge/src/llm/extract.js MAX_TEXT). */
export const MAX_TEXT = 30_000;
/** Where text was left out: no words, so it reads the same in every language. */
export const OMITTED = '\n[…]\n';
/** The head's share of what is kept; the tail gets the rest. */
const HEAD_SHARE = 2 / 3;

const encoder = new TextEncoder();
/** @param {string} s */
const bytes = (s) => encoder.encode(s).length;

/**
 * The longest start of `s` within `max` bytes of UTF-8, not cutting a
 * character (a surrogate pair stays whole).
 *
 * @param {string} s @param {number} max
 */
function headBytes(s, max) {
	let lo = 0;
	let hi = Math.min(s.length, max);
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (bytes(s.slice(0, mid)) <= max) lo = mid;
		else hi = mid - 1;
	}
	return wholeEnd(s, lo);
}

/** @param {string} s @param {number} max the longest end of `s` within `max` bytes */
function tailBytes(s, max) {
	let lo = 0;
	let hi = Math.min(s.length, max);
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (bytes(s.slice(s.length - mid)) <= max) lo = mid;
		else hi = mid - 1;
	}
	let n = lo;
	// Not starting on the second half of a surrogate pair.
	if (n > 0 && n < s.length && isLow(s.charCodeAt(s.length - n))) n -= 1;
	return s.slice(s.length - n);
}

/** @param {number} c */
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;
/** @param {string} s @param {number} n `s.slice(0, n)`, without half a surrogate pair at its end */
const wholeEnd = (s, n) =>
	n > 0 && n < s.length && isLow(s.charCodeAt(n)) ? s.slice(0, n - 1) : s.slice(0, n);

/**
 * The text as it goes: whole when it fits, else its head and tail.
 *
 * @param {string} text
 * @param {{ maxBytes: number, maxChars?: number }} budget `maxBytes` of UTF-8, `maxChars`
 *   characters (MAX_TEXT without it)
 * @returns {{ text: string, shortened: boolean }}
 */
export function fitText(text, { maxBytes, maxChars = MAX_TEXT }) {
	const s = String(text ?? '');
	if (s.length <= maxChars && bytes(s) <= maxBytes) return { text: s, shortened: false };
	const room = Math.max(0, maxBytes - bytes(OMITTED));
	const chars = Math.max(0, maxChars - OMITTED.length);
	const headChars = Math.floor(chars * HEAD_SHARE);
	const headRoom = Math.floor(room * HEAD_SHARE);
	const head = headBytes(wholeEnd(s, headChars), headRoom);
	const rest = s.slice(head.length);
	const tail = tailBytes(
		rest.slice(Math.max(0, rest.length - (chars - head.length))),
		room - bytes(head)
	);
	return { text: `${head}${OMITTED}${tail}`, shortened: true };
}

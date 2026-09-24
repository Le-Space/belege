// What the Belege page shows of a receipt record: its date, vendor, amount,
// status, source; grouping by month; search. Pure, so it is tested without a
// database or a browser.

import { formatMonth } from '../bank/format.js';

/**
 * @typedef {object} ReceiptLike
 * @property {string} id
 * @property {string} [source]
 * @property {string | null} [receivedAt]
 * @property {string | null} [documentDate] from the extraction
 * @property {string | null} [vendor] from the extraction
 * @property {number | null} [amountCents]
 * @property {string | null} [currency]
 * @property {string | null} [from]
 * @property {string | null} [subject]
 * @property {string | null} [fileName]
 * @property {string | null} [mime]
 * @property {string} [status]
 * @property {any} [extraction]
 */

/**
 * The day a receipt belongs to: the document's own date once read, else the
 * day the mail arrived; an upload not yet read has none.
 *
 * @param {ReceiptLike} r
 * @returns {string | null} YYYY-MM-DD
 */
export function receiptDate(r) {
	const d = r.documentDate ?? (r.source === 'mail' ? r.receivedAt : null);
	return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** The mail's display name without the address, `Wolkenfabrik <a@b>` → `Wolkenfabrik`. */
function senderName(/** @type {string | null | undefined} */ from) {
	if (!from) return null;
	const m = /^(.*?)\s*<[^>]*>$/.exec(from);
	return (m ? m[1] : from).replace(/^"|"$/g, '').trim() || from;
}

/** @param {ReceiptLike} r */
export function receiptVendor(r) {
	return r.vendor || senderName(r.from) || r.fileName || '—';
}

/**
 * Receipts by month, newest first, newest first inside a month; the ones
 * without a date last, as "Ohne Datum".
 *
 * @template {ReceiptLike} T
 * @param {T[]} receipts
 * @returns {{ month: string, label: string, items: T[] }[]}
 */
export function groupReceiptsByMonth(receipts) {
	/** @type {Map<string, T[]>} */
	const groups = new Map();
	for (const r of receipts) {
		const month = receiptDate(r)?.slice(0, 7) ?? 'ohne';
		const list = groups.get(month) ?? [];
		list.push(r);
		groups.set(month, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a === 'ohne' ? 1 : b === 'ohne' ? -1 : a < b ? 1 : a > b ? -1 : 0))
		.map(([month, items]) => ({
			month,
			label: month === 'ohne' ? 'Ohne Datum' : formatMonth(month),
			items: items.sort((x, y) => {
				const dx = receiptDate(x) ?? '';
				const dy = receiptDate(y) ?? '';
				if (dx !== dy) return dx < dy ? 1 : -1;
				return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
			})
		}));
}

/**
 * @param {ReceiptLike[]} receipts
 * @returns {{ all: number, mail: number, upload: number, folder: number }}
 */
export function sourceCounts(receipts) {
	const counts = { all: receipts.length, mail: 0, upload: 0, folder: 0 };
	for (const r of receipts) {
		if (r.source === 'mail' || r.source === 'upload' || r.source === 'folder') counts[r.source]++;
	}
	return counts;
}

/**
 * Vendor, sender, subject, file name, invoice number, amount (`119,00`,
 * `119.00`, `119`) and date (`15.08.2026`, `2026-08-15`).
 *
 * @param {ReceiptLike} r
 * @param {string} query
 */
export function matchesReceiptSearch(r, query) {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const date = receiptDate(r);
	const cents = typeof r.amountCents === 'number' ? Math.abs(r.amountCents) : null;
	const haystack = [
		r.vendor,
		r.from,
		r.subject,
		r.fileName,
		r.extraction?.invoice_number,
		r.extraction?.summary,
		date,
		date ? date.split('-').reverse().join('.') : null,
		cents !== null ? (cents / 100).toFixed(2) : null,
		cents !== null ? (cents / 100).toFixed(2).replace('.', ',') : null,
		cents !== null
			? new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(cents / 100)
			: null
	]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();
	return haystack.includes(q.replace(/^-/, ''));
}

const STATUS_KEYS = /** @type {Record<string, string>} */ ({
	neu: 'new',
	ausgelesen: 'unassigned',
	rückfrage: 'question',
	zugeordnet: 'assigned',
	ignoriert: 'ignored'
});

/** Status → the badge key under `belege.status`. Read but not matched yet: "Nicht zugeordnet". */
export function statusKey(/** @type {ReceiptLike} */ r) {
	return STATUS_KEYS[r.status ?? 'neu'] ?? 'new';
}

/**
 * The months "E-Mails abrufen" offers: this month and the one before by
 * default, as `since` (first day) and `until` (first day after the last
 * month; left open when that is in the future, see bridge/src/mail/mime.js).
 *
 * @param {string} from YYYY-MM
 * @param {string} to YYYY-MM
 * @param {Date} [now]
 * @returns {{ since: string, until: string | null }}
 */
export function mailWindow(from, to, now = new Date()) {
	const [a, b] = from <= to ? [from, to] : [to, from];
	const [y, m] = b.split('-').map(Number);
	const after = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
	return { since: `${a}-01`, until: new Date(`${after}T00:00:00Z`) > now ? null : after };
}

/** @param {Date} [now] @returns {{ from: string, to: string }} */
export function defaultMailMonths(now = new Date()) {
	const to = now.toISOString().slice(0, 7);
	const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	return { from: prev.toISOString().slice(0, 7), to };
}

// Pure helpers for reading mails: the parts of a MIME tree, what a part's
// first bytes say it is, a plain-text excerpt, the ids the API hands out, the
// spellings of an amount, date windows. No IMAP here, so all of it is tested
// without a server.

/**
 * @typedef {object} PartInfo
 * @property {string} part IMAP part number, e.g. `2` or `1.2`
 * @property {string} name
 * @property {string} type the declared MIME type (often wrong for PDFs)
 * @property {number} size encoded size on the server
 * @property {string | null} disposition
 * @property {boolean} candidate worth sniffing: may be a PDF or an image receipt
 */

/**
 * Every named or `attachment` part of a body structure, in order.
 *
 * About half of the PDFs arrive as `application/octet-stream` or named
 * `.PDF` (docs/phase-0.md), so the declared type only decides what is worth
 * a look; the bytes decide what it is (see `sniff`). Inline images without
 * `attachment` disposition are signature logos, not receipts.
 *
 * @param {any} node imapflow's `bodyStructure`
 * @param {PartInfo[]} [out]
 * @returns {PartInfo[]}
 */
export function attachmentParts(node, out = []) {
	if (!node) return out;
	const name = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
	const type = String(node.type ?? '').toLowerCase();
	if (!type.startsWith('multipart/') && (name || node.disposition === 'attachment')) {
		const lower = String(name ?? '').toLowerCase();
		const pdfish =
			type === 'application/pdf' ||
			type === 'application/octet-stream' ||
			type === 'application/x-pdf' ||
			lower.endsWith('.pdf');
		const imageish = type.startsWith('image/') && node.disposition === 'attachment';
		out.push({
			part: String(node.part ?? '1'),
			name: name ?? '(ohne Namen)',
			type,
			size: Number(node.size ?? 0),
			disposition: node.disposition ?? null,
			candidate: pdfish || imageish
		});
	}
	for (const child of node.childNodes ?? []) attachmentParts(child, out);
	return out;
}

/**
 * The part to take the text excerpt from: the first text/plain that is not
 * an attachment, else the first text/html.
 *
 * @param {any} node
 * @returns {{ part: string, html: boolean } | null}
 */
export function textPart(node) {
	/** @type {{ part: string, html: boolean } | null} */
	let html = null;
	/** @param {any} n @returns {{ part: string, html: boolean } | null} */
	const walk = (n) => {
		if (!n) return null;
		const type = String(n.type ?? '').toLowerCase();
		const isAttachment = n.disposition === 'attachment';
		if (!isAttachment && type === 'text/plain') return { part: String(n.part ?? '1'), html: false };
		if (!isAttachment && type === 'text/html' && !html)
			html = { part: String(n.part ?? '1'), html: true };
		for (const c of n.childNodes ?? []) {
			const found = walk(c);
			if (found) return found;
		}
		return null;
	};
	return walk(node) ?? html;
}

/**
 * @param {Uint8Array} bytes the first bytes of a part
 * @returns {{ kind: 'pdf' | 'image' | 'other', mime: string | null }}
 */
export function sniff(bytes) {
	const b = bytes ?? new Uint8Array();
	const starts = (/** @type {number[]} */ sig, offset = 0) =>
		b.length >= sig.length + offset && sig.every((x, i) => b[i + offset] === x);
	// %PDF- may follow a few bytes of junk; pdf.js accepts it within the first 1 KB.
	const head = Buffer.from(b.subarray(0, 1024)).toString('latin1');
	if (head.indexOf('%PDF-') > -1 && head.indexOf('%PDF-') < 1024) {
		return { kind: 'pdf', mime: 'application/pdf' };
	}
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return { kind: 'image', mime: 'image/png' };
	if (starts([0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
	if (starts([0x47, 0x49, 0x46, 0x38])) return { kind: 'image', mime: 'image/gif' };
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
		return { kind: 'image', mime: 'image/webp' };
	}
	return { kind: 'other', mime: null };
}

const ENTITIES = /** @type {Record<string, string>} */ ({
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	euro: '€',
	auml: 'ä',
	ouml: 'ö',
	uuml: 'ü',
	Auml: 'Ä',
	Ouml: 'Ö',
	Uuml: 'Ü',
	szlig: 'ß',
	eacute: 'é',
	ndash: '–',
	mdash: '—',
	shy: ''
});

/** @param {number} n */
const codePoint = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/** HTML → text: no tags, no scripts or styles, entities for the common cases. */
export function htmlToText(/** @type {string} */ html) {
	return (
		String(html ?? '')
			.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			// A tag cut off at the end (a mail cut to size) has no `>`.
			.replace(/<[a-zA-Z/!][^>]*$/, ' ')
			.replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m)
			.replace(/&#(\d{1,7});/g, (_, n) => codePoint(Number(n)))
			.replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => codePoint(parseInt(n, 16)))
	);
}

/**
 * @param {string} text
 * @param {number} [max] characters
 */
export function excerpt(text, max = 2000) {
	const clean = String(text ?? '')
		.replace(/\r/g, '')
		.replace(/[ \t ]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * An opaque id for one mail: folder, UIDVALIDITY and UID. The UIDVALIDITY
 * makes an id from before a mailbox was rebuilt fail instead of pointing at
 * another mail.
 *
 * @param {{ folder: string, uidValidity: bigint | number | string, uid: number }} ref
 */
export function encodeMailId({ folder, uidValidity, uid }) {
	return Buffer.from(JSON.stringify([folder, String(uidValidity), uid]), 'utf8').toString(
		'base64url'
	);
}

/**
 * @param {string} id
 * @returns {{ folder: string, uidValidity: string, uid: number } | null}
 */
export function decodeMailId(id) {
	if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,700}$/.test(id)) return null;
	try {
		const value = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
		if (!Array.isArray(value) || value.length !== 3) return null;
		const [folder, uidValidity, uid] = value;
		if (typeof folder !== 'string' || !folder || folder.length > 200) return null;
		if (typeof uidValidity !== 'string' || !/^\d{1,20}$/.test(uidValidity)) return null;
		if (!Number.isSafeInteger(uid) || uid < 1) return null;
		return { folder, uidValidity, uid };
	} catch {
		return null;
	}
}

/** An IMAP part number: `1`, `2.1`, … */
export function isPartNumber(/** @type {unknown} */ part) {
	return typeof part === 'string' && /^\d{1,3}(\.\d{1,3}){0,6}$/.test(part);
}

/**
 * "52,59" → the spellings a mail may use: 52,59 · 52.59, and with thousands
 * 1.190,00 · 1,190.00 · 1190,00 · 1190.00.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function amountVariants(input) {
	const digits = String(input ?? '')
		.replace(/[^\d.,]/g, '')
		.replace(/[.,](?=\d{3}(\D|$))/g, '');
	if (!/\d/.test(digits)) return [];
	const [int, dec = '00'] = digits.split(/[.,]/);
	const cents = dec.padEnd(2, '0').slice(0, 2);
	const grouped = (/** @type {string} */ sep) => int.replace(/\B(?=(\d{3})+$)/g, sep);
	return [
		...new Set([
			`${int},${cents}`,
			`${int}.${cents}`,
			`${grouped('.')},${cents}`,
			`${grouped(',')}.${cents}`
		])
	];
}

/** `YYYY-MM-DD` that is a real day */
export function isIsoDay(/** @type {unknown} */ value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * IMAP search dates for a window. imapflow turns SINCE/BEFORE into
 * YOUNGER/OLDER seconds where the server has WITHIN, and Dovecot rejects
 * `OLDER 0`: a window that reaches into the future leaves its end open.
 *
 * @param {Date} since
 * @param {Date | null} before exclusive
 * @param {Date} [now]
 * @returns {{ since: Date, before?: Date }}
 */
export function searchWindow(since, before, now = new Date()) {
	return before && before <= now ? { since, before } : { since };
}

/**
 * ±days around a day (default: around today).
 *
 * @param {string | null} around YYYY-MM-DD
 * @param {number} days
 */
export function aroundWindow(around, days) {
	const center = around ? new Date(`${around}T00:00:00Z`) : new Date();
	return {
		since: new Date(center.getTime() - days * 864e5),
		before: new Date(center.getTime() + (days + 1) * 864e5)
	};
}

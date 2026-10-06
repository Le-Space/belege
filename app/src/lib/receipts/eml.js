// The text of a mail kept as received (RFC 822, `.eml`, #288): what the
// receipt preview and the monthly ZIP's PDF show of a receipt that is the
// mail itself. The plain-text part where there is one, else the HTML part
// turned into text – never the HTML itself: no remote content is loaded, no
// markup is rendered. Pure; the bytes come from the sealed blob store.
//
// Enough MIME for a receipt mail: nested multiparts, base64 and
// quoted-printable, the charsets TextDecoder knows (UTF-8 where it knows
// none). Attachments are skipped; a mail without any text part gives ''.

/** @typedef {{ headers: Map<string, string>, body: string }} Part a part's body as latin1 text: one char per byte */

/** @param {string} raw latin1 text of a part */
function splitPart(raw) {
	const at = raw.search(/\r?\n\r?\n/);
	const head = at < 0 ? raw : raw.slice(0, at);
	const body = at < 0 ? '' : raw.slice(at).replace(/^\r?\n\r?\n/, '');
	/** @type {Map<string, string>} */
	const headers = new Map();
	for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon > 0)
			headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
	}
	return { headers, body };
}

/**
 * `text/plain; charset="utf-8"` → type and parameters.
 *
 * @param {string | undefined} value
 */
function contentType(value) {
	const [type, ...rest] = String(value || 'text/plain').split(';');
	/** @type {Record<string, string>} */
	const params = {};
	for (const p of rest) {
		const m = /^\s*([\w-]+)\s*=\s*"?([^";]*)"?/.exec(p);
		if (m) params[m[1].toLowerCase()] = m[2];
	}
	return { type: type.trim().toLowerCase(), params };
}

/** @param {string} latin1 @returns {Uint8Array} */
const bytesOf = (latin1) => Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff);

/**
 * A part's body decoded to text: transfer encoding first, then its charset.
 *
 * @param {Part} part
 */
function decode(part) {
	const encoding = String(part.headers.get('content-transfer-encoding') ?? '').toLowerCase();
	let bytes;
	if (encoding === 'base64') {
		try {
			bytes = bytesOf(atob(part.body.replace(/[^A-Za-z0-9+/=]/g, '')));
		} catch {
			bytes = new Uint8Array();
		}
	} else if (encoding === 'quoted-printable') {
		bytes = bytesOf(
			part.body
				.replace(/=\r?\n/g, '')
				.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		);
	} else {
		bytes = bytesOf(part.body);
	}
	const charset = contentType(part.headers.get('content-type')).params.charset || 'utf-8';
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

/** Named entities a receipt mail uses; others stay as written. */
/* eslint-disable belege/no-german -- an HTML entity table, not words */
const ENTITIES = /** @type {Record<string, string>} */ ({
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	euro: '€',
	auml: '\u00e4',
	ouml: '\u00f6',
	uuml: '\u00fc',
	Auml: '\u00c4',
	Ouml: '\u00d6',
	Uuml: '\u00dc',
	szlig: '\u00df',
	eacute: 'é',
	egrave: 'è',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	copy: '©',
	reg: '®'
});
/* eslint-enable belege/no-german */

/**
 * An HTML part as text: scripts, styles and the head dropped, block ends as
 * line breaks, tags removed, entities decoded.
 *
 * @param {string} html
 */
export function htmlText(html) {
	return html
		.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
		.replace(/<(td|th)\b[^>]*>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
		.replace(/[ \t]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * The text parts of a part, in order, with their type; attachments skipped.
 *
 * @param {Part} part
 * @param {number} depth
 * @returns {{ type: string, text: string }[]}
 */
function textParts(part, depth = 0) {
	const { type, params } = contentType(part.headers.get('content-type'));
	if (type.startsWith('multipart/') && params.boundary && depth < 10) {
		const marker = `--${params.boundary}`;
		const pieces = part.body.split(marker).slice(1);
		/** @type {{ type: string, text: string }[]} */
		const out = [];
		for (const piece of pieces) {
			if (piece.startsWith('--')) break;
			out.push(...textParts(splitPart(piece.replace(/^\r?\n/, '')), depth + 1));
		}
		// One of the alternatives is enough: the plain text, else the HTML.
		if (type === 'multipart/alternative') {
			const plain = out.find((p) => p.type === 'text/plain');
			return plain ? [plain] : out.slice(0, 1);
		}
		return out;
	}
	if (/^attachment\b/i.test(String(part.headers.get('content-disposition') ?? ''))) return [];
	if (type === 'text/plain' || type === 'text/html') return [{ type, text: decode(part) }];
	return [];
}

/**
 * The text of a mail kept as received.
 *
 * @param {Uint8Array} bytes the `.eml`
 * @returns {string} '' when it has no text part
 */
export function emlText(bytes) {
	const raw = new TextDecoder('latin1').decode(bytes ?? new Uint8Array());
	const parts = textParts(splitPart(raw));
	const plain = parts.filter((p) => p.type === 'text/plain');
	const chosen = plain.length ? plain : parts.filter((p) => p.type === 'text/html');
	return chosen
		.map((p) => (p.type === 'text/html' ? htmlText(p.text) : p.text.replace(/\r\n?/g, '\n').trim()))
		.filter(Boolean)
		.join('\n\n');
}

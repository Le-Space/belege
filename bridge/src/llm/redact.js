// What is blacked out before any text goes to the LLM. Moved here from the
// phase-0 spike (spikes/llm/extract.mjs), unchanged in its rules:
//
//   - every term in `terms` (own name, family names on tickets), any spacing
//   - IBANs, with or without spaces; the last four characters stay, because
//     they tell which of our accounts a direct debit hits. SEPA creditor ids
//     (DE98ZZZ…) look alike but are the vendor's and not secret: they stay.
//   - e-mail addresses of our own domains
//   - postcode + town, street + house number (vendors' too: the VAT id
//     identifies a vendor, the street is not needed)
//   - links: every http(s) URL becomes `[LINK host]`. Links in mails carry
//     sign-in, unsubscribe and tracking tokens; the host is enough to read
//     who wrote.
//   - streets without a suffix ("Lichtenberg 44"), recognised by position:
//     the line right above a postcode line in an address block
//
// Station names stay: travel expenses need them.
//
// One change from the spike: a town or a street no longer runs on across a
// line break. pdf.js puts each line of an address block on its own line, and
// `\s` let "12345 Town" swallow the capitalised words of the next line too
// ("IBAN", a vendor's name).
//
// The bridge applies this itself on every /extract, so the browser cannot
// forget it.

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} input
 * @param {{ terms?: string[], ownDomains?: string[] }} [options]
 * @returns {{ text: string, count: number, counts: RedactionCounts }}
 */
export function redact(input, { terms = [], ownDomains = [] } = {}) {
	/** @type {RedactionCounts} */
	const counts = emptyCounts();
	/**
	 * @param {keyof RedactionCounts} kind
	 * @param {string} s
	 * @param {RegExp} re
	 * @param {string | ((...m: string[]) => string)} rep
	 */
	const sub = (kind, s, re, rep) =>
		s.replace(re, (...m) => {
			counts[kind]++;
			return typeof rep === 'function' ? rep(...m) : rep;
		});
	let t = String(input ?? '');
	// Longest first, so "Maria Muster" goes before "Muster" would split it.
	const sorted = [...new Set(terms.map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort(
		(a, b) => b.length - a.length
	);
	for (const term of sorted) {
		t = sub('terms', t, new RegExp(escape(term).replace(/\s+/g, '\\s+'), 'gi'), '[NAME]');
	}
	t = sub('iban', t, /\b[A-Z]{2} ?\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => {
		if (/ZZZ/.test(m)) {
			counts.iban--;
			return m;
		}
		return `[IBAN …${m.replace(/\s/g, '').slice(-4)}]`;
	});
	t = sub('link', t, /\bhttps?:\/\/[^\s<>"'\])]+/gi, (m) => {
		let host = '';
		try {
			host = new URL(m).hostname;
		} catch {}
		return host ? `[LINK ${host}]` : '[LINK]';
	});
	for (const domain of new Set(
		ownDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
	)) {
		t = sub('email', t, new RegExp(`[\\w.+-]+@${escape(domain)}`, 'gi'), '[EMAIL]');
	}
	t = sub(
		'postcode',
		t,
		/\b\d{5}[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ(][\wäöüß.\-)]*){0,3}/g,
		'[PLZ ORT]'
	);
	t = sub(
		'street',
		t,
		/\b[A-ZÄÖÜ][\wäöüß.\-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee)[ \t]+\d+[a-z]?\b/gi,
		'[STRASSE]'
	);
	t = sub(
		'street',
		t,
		/^[A-ZÄÖÜ][\wäöüß.\- ]{1,40}? \d{1,4}[a-z]?(?=\s*\n(?:D-)?\[PLZ ORT\])/gim,
		'[STRASSE]'
	);
	return { text: t, count: sumCounts(counts), counts };
}

/**
 * How many places were blacked out, by kind. `postcode` is a postcode with its
 * town, `street` a street with its number.
 *
 * @typedef {{ terms: number, iban: number, email: number, street: number, postcode: number, link: number }} RedactionCounts
 */

/** @returns {RedactionCounts} */
export function emptyCounts() {
	return { terms: 0, iban: 0, email: 0, street: 0, postcode: 0, link: 0 };
}

/** @param {RedactionCounts} c */
export function sumCounts(c) {
	return c.terms + c.iban + c.email + c.street + c.postcode + c.link;
}

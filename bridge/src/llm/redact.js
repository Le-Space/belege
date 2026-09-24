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
 * @returns {{ text: string, count: number }}
 */
export function redact(input, { terms = [], ownDomains = [] } = {}) {
	let count = 0;
	/**
	 * @param {string} s
	 * @param {RegExp} re
	 * @param {string | ((...m: string[]) => string)} rep
	 */
	const sub = (s, re, rep) =>
		s.replace(re, (...m) => {
			count++;
			return typeof rep === 'function' ? rep(...m) : rep;
		});
	let t = String(input ?? '');
	// Longest first, so "Maria Muster" goes before "Muster" would split it.
	const sorted = [...new Set(terms.map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort(
		(a, b) => b.length - a.length
	);
	for (const term of sorted) {
		t = sub(t, new RegExp(escape(term).replace(/\s+/g, '\\s+'), 'gi'), '[NAME]');
	}
	t = sub(t, /\b[A-Z]{2} ?\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => {
		if (/ZZZ/.test(m)) {
			count--;
			return m;
		}
		return `[IBAN …${m.replace(/\s/g, '').slice(-4)}]`;
	});
	for (const domain of new Set(
		ownDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
	)) {
		t = sub(t, new RegExp(`[\\w.+-]+@${escape(domain)}`, 'gi'), '[EMAIL]');
	}
	t = sub(
		t,
		/\b\d{5}[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ(][\wäöüß.\-)]*){0,3}/g,
		'[PLZ ORT]'
	);
	t = sub(
		t,
		/\b[A-ZÄÖÜ][\wäöüß.\-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee)[ \t]+\d+[a-z]?\b/gi,
		'[STRASSE]'
	);
	t = sub(
		t,
		/^[A-ZÄÖÜ][\wäöüß.\- ]{1,40}? \d{1,4}[a-z]?(?=\s*\n(?:D-)?\[PLZ ORT\])/gim,
		'[STRASSE]'
	);
	return { text: t, count };
}

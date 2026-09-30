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
// Since #226, the cheap gaps:
//   - names after a salutation or a label (Herr, Frau, z. Hd., Ansprechpartner:,
//     Reisende:, Bewirtete Personen:, "Hallo …")
//   - phone numbers (after a label, with a country code, German mobile numbers)
//   - dates of birth, personal tax ids and tax numbers, after their label
//   - 16-digit card numbers (the last four stay, like an IBAN's)
//   - e-mail addresses of others: the domain stays, it says who wrote
//   - a four-digit postcode with its town (Austria, Switzerland), where it is a
//     line of its own or carries the country's prefix
//   - terms the app adds for one call (`withExtraTerms`): the company's names
//     from Einstellungen. They become `[FIRMA]`, not `[NAME]`: on an invoice of
//     our own the model then names `[FIRMA]` as the vendor, and the app puts the
//     name back, so an own invoice is still recognised
//
// This limits what leaves; it does not make a text anonymous. A name no label
// announces and no list holds gets through, and so does what a receipt is
// about. Whoever wants nothing to leave sets a model on this machine.
//
// What stays on purpose, because reading a receipt and matching it need it:
// the vendor and its VAT ID, amounts, dates, invoice and customer numbers.
// Station names stay: travel expenses need them.
//
// What this is not: anonymisation. A name in running text that no list and no
// label gives away is sent, and so is an address in another country's form.
// test/redact-scorecard.test.js says what is hidden, what stays, and which
// gaps are known.
//
// One change from the spike: a town or a street no longer runs on across a
// line break. pdf.js puts each line of an address block on its own line, and
// `\s` let "12345 Town" swallow the capitalised words of the next line too
// ("IBAN", a vendor's name).
//
// The bridge applies this itself on every /extract, so the browser cannot
// forget it.

import { AsyncLocalStorage } from 'node:async_hooks';

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terms added for the call that is running: the app sends its company names with each. */
const extra = new AsyncLocalStorage();

/** At most this many terms from the app, each of a sane length. */
export const MAX_EXTRA_TERMS = 20;

/** What a term from the app becomes; the app puts the name back in an answer. */
export const COMPANY_MARK = '[FIRMA]';

/**
 * What the app may add to the list for one call: strings of 2 to 80
 * characters, at most MAX_EXTRA_TERMS. Anything else is dropped.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function cleanExtraTerms(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((t) => typeof t === 'string')
		.map((t) => t.trim())
		.filter((t) => t.length >= 2 && t.length <= 80)
		.slice(0, MAX_EXTRA_TERMS);
}

/**
 * Run `fn` with more terms to black out: every `redact` inside it, however
 * deep, takes them too.
 *
 * @template T
 * @param {unknown} terms
 * @param {() => T} fn
 * @returns {T}
 */
export const withExtraTerms = (terms, fn) => extra.run(cleanExtraTerms(terms), fn);

/** A capitalised word, as a name is written. */
const NAME_WORD = '[A-ZÄÖÜ][\\wäöüßéèáàâôûç\\-]+\\.?';
/** Up to three of them, with titles before. */
const NAME = `(?:(?:Dr|Prof|Dipl|Ing|Mag)\\.[ \\t]*(?:[a-z]+\\.[ \\t]*)?)*${NAME_WORD}(?:[ \\t]+${NAME_WORD}){0,2}`;
/** What announces a person's name. The label stays, the name goes. */
const NAME_LABEL =
	'(?:Herrn?|Frau|Hr\\.|Fr\\.|Mr\\.?|Mrs\\.?|Ms\\.?|z\\.[ \\t]?H(?:d|dn)?\\.|zu Händen(?: von)?|' +
	'Ansprechpartner(?:in)?:|Sachbearbeiter(?:in)?:|Kontakt(?:person)?:|Reisender?:|Mitreisender?:|' +
	'Bewirtete Personen?:|Teilnehmer(?:in)?:|Bedienung:|Es bediente Sie:?|Kassierer(?:in)?:|Attn\\.?:?|Contact:|' +
	'Hallo|Hi|Liebe[rs]?|Dear|Moin|Servus|Guten Tag)';

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
	const own = terms.map((x) => String(x).trim().toLowerCase());
	const company = /** @type {string[]} */ (extra.getStore() ?? []).filter(
		(x) => !own.includes(x.toLowerCase())
	);
	const all = [...terms, ...company];
	const sorted = [...new Set(all.map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort(
		(a, b) => b.length - a.length
	);
	for (const term of sorted) {
		t = sub(
			'terms',
			t,
			new RegExp(escape(term).replace(/\s+/g, '\\s+'), 'gi'),
			company.includes(term) ? COMPANY_MARK : '[NAME]'
		);
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
	// Anyone else's address: who it is goes, where it is from stays.
	t = sub('email', t, /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g, (_m, domain) => `[EMAIL @${domain}]`);
	// Names a label gives away. Several after one label ("A, B und C") go one by one.
	const named = new RegExp(
		`(\\b${NAME_LABEL}[ \\t]+)(${NAME})((?:[ \\t]*(?:,|und|and|&)[ \\t]*${NAME})*)`,
		'g'
	);
	t = t.replace(named, (m, label, _first, rest) => {
		// Already a placeholder, or a greeting without a name ("Hallo zusammen" is lower case and does not match).
		if (/^\[/.test(m.slice(label.length))) return m;
		counts.terms++;
		const more = String(rest ?? '').replace(new RegExp(NAME, 'g'), () => {
			counts.terms++;
			return '[NAME]';
		});
		return `${label}[NAME]${more}`;
	});
	t = sub(
		'phone',
		t,
		/((?:Tel(?:efon)?|Fon|Phone|Mobil(?:telefon)?|Handy|Mobile|Fax)\.?:?[ \t]*)(\+?\(?\d[\d \t/().-]{5,}\d)/gi,
		(_m, label) => `${label}[TELEFON]`
	);
	t = sub(
		'phone',
		t,
		/(?<![\w.,])\+\d{1,3}[ \t/-]?\(?\d{1,5}\)?[ \t/-]?\d[\d \t/-]{3,}\d/g,
		'[TELEFON]'
	);
	t = sub('phone', t, /(?<![\w.,])01[5-7]\d[ \t/-]?\d{3,}[ \t/-]?\d{2,}(?!\d)/g, '[TELEFON]');
	t = sub(
		'id',
		t,
		/((?:geb\.|geboren(?: am)?|Geburtsdatum:?|date of birth:?|DOB:?)[ \t]*)\d{1,2}\.[ \t]?\d{1,2}\.[ \t]?\d{2,4}/gi,
		(_m, label) => `${label}[GEBURTSDATUM]`
	);
	t = sub(
		'id',
		t,
		/((?:Steuer-?ID|Steueridentifikationsnummer|Steuer-?IdNr\.?|TIN)[ \t:]*(?:ist|lautet)?[ \t:]*)\d{2}[ \t]?\d{3}[ \t]?\d{3}[ \t]?\d{3}/gi,
		(_m, label) => `${label}[STEUER-ID]`
	);
	t = sub(
		'id',
		t,
		/((?:Steuernummer|Steuer-?Nr\.?|St\.-?[ \t]?Nr\.?)[ \t:]*)\d{2,3}[ \t]?\/[ \t]?\d{3,4}[ \t]?\/[ \t]?\d{4,5}/gi,
		(_m, label) => `${label}[STEUERNR]`
	);
	t = sub('id', t, /\b\d{4}([ -])\d{4}\1\d{4}\1(\d{4})\b/g, (_m, _sep, last) => `[KARTE …${last}]`);
	t = sub(
		'postcode',
		t,
		/\b\d{5}[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ(][\wäöüß.\-)]*){0,3}/g,
		'[PLZ ORT]'
	);
	// Four digits (Austria, Switzerland): only with the country's prefix, or as a
	// line of its own in an address block – "2026 Hosting" in a sentence is a year.
	t = sub('postcode', t, /\b(?:A|CH|AT)-\d{4}[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+/g, '[PLZ ORT]');
	t = sub(
		'postcode',
		t,
		/^[ \t]*\d{4}[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ(][\wäöüß.\-)]*){0,2}[ \t]*$/gm,
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
 * `terms` counts names: the list's, the app's and the ones a label gave away;
 * `phone` phone numbers; `id` dates of birth, tax ids, tax numbers and card numbers.
 *
 * @typedef {{ terms: number, iban: number, email: number, street: number, postcode: number, link: number, phone: number, id: number }} RedactionCounts
 */

/** @returns {RedactionCounts} */
export function emptyCounts() {
	return { terms: 0, iban: 0, email: 0, street: 0, postcode: 0, link: 0, phone: 0, id: 0 };
}

/** @param {RedactionCounts} c */
export function sumCounts(c) {
	return c.terms + c.iban + c.email + c.street + c.postcode + c.link + (c.phone ?? 0) + (c.id ?? 0);
}

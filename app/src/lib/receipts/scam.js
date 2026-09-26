// Signs that a receipt mail may be a scam: an invoice that imitates a known
// vendor, comes from elsewhere, or asks to pay to a new account. Pure and
// deterministic; each sign names its reason. A hint for a person, never a
// verdict: nothing is deleted, hidden or blocked. A suspicious receipt is not
// linked automatically (matching/engine.js makes it a question), and a
// person's "Ist in Ordnung" (`scamCleared`) ends the hint for that receipt.
//
// Strong signs: the sender check failed; the sender's domain looks like a
// known vendor's domain but is not; a vendor that wrote from other domains
// before; an IBAN this vendor was never paid to. Weak signs: a free-mail
// sender for an invoice; pressure in the wording; links to other hosts. A
// strong sign, or two weak ones, is "Verdacht".

import { findPartner, mailDomain, txAlias } from '../matching/partners.js';

/** Free-mail domains: a company invoice rarely comes from one. */
export const FREE_MAIL = new Set([
	'gmail.com',
	'googlemail.com',
	'gmx.de',
	'gmx.net',
	'gmx.com',
	'web.de',
	'outlook.com',
	'hotmail.com',
	'hotmail.de',
	'live.com',
	'yahoo.com',
	'yahoo.de',
	'icloud.com',
	'me.com',
	'aol.com',
	't-online.de',
	'freenet.de',
	'protonmail.com',
	'proton.me',
	'mail.com',
	'mail.ru',
	'yandex.com'
]);

const PRESSURE =
	/\b(sofort|umgehend|dringend|unverzüglich|letzte mahnung|gesperrt|sperrung|innerhalb von 24 stunden|urgent|immediately|final notice|suspended|verify your account|konto bestätigen)\b/i;

/**
 * The domain a person would call the sender's: the last two labels, three
 * for a country's second level (`example.co.uk`).
 *
 * @param {string} domain
 */
export function registrable(domain) {
	const labels = String(domain).toLowerCase().split('.').filter(Boolean);
	if (labels.length <= 2) return labels.join('.');
	const [sld, tld] = labels.slice(-2);
	const cut = tld.length === 2 && /^(co|com|org|net|gov|ac|or|ne)$/.test(sld) ? 3 : 2;
	return labels.slice(-cut).join('.');
}

/** The name part of a registrable domain (`hetzner` of `hetzner.com`). @param {string} d */
const nameOf = (d) => registrable(d).split('.')[0];

/** Letters that pass for others: `rn` for `m`, digits for letters. @param {string} s */
const skeleton = (s) =>
	s
		.replace(/rn/g, 'm')
		.replace(/vv/g, 'w')
		.replace(/0/g, 'o')
		.replace(/[1l|]/g, 'i')
		.replace(/5/g, 's')
		.replace(/3/g, 'e')
		.replace(/-/g, '');

/** @param {string} a @param {string} b */
function editDistance(a, b) {
	/** @type {number[]} */
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
}

/**
 * Whether `domain` imitates `known`: another domain whose name looks the
 * same – one or two letters off, letters that pass for others, or the same
 * name under another ending.
 *
 * @param {string} domain
 * @param {string} known
 */
export function imitates(domain, known) {
	const d = registrable(domain);
	const k = registrable(known);
	if (!d || !k || d === k) return false;
	const a = nameOf(d);
	const b = nameOf(k);
	if (a === b) return true; // hetzner.co against hetzner.com
	if (skeleton(a) === skeleton(b)) return true;
	return Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 2;
}

/**
 * @typedef {object} ScamContext
 * @property {Record<string, any>[]} partners learned vendors (matching/partners.js)
 * @property {Set<string>} knownDomains registrable domains of learned vendors' receipts – only
 *   those a person linked or confirmed (partners.js): a scam's own lookalike domain passes
 *   SPF too, so a passing check alone must not make a domain known
 * @property {Map<string, Set<string>>} ibansByAlias counterparty alias → last four of the IBANs paid to
 * @property {Set<string>} ownLast4 last four of our own accounts: a direct-debit invoice names
 *   the account it is debited from, which is ours, not the vendor's
 */

/**
 * @param {{ partners?: Record<string, any>[], transactions?: Record<string, any>[], accounts?: Record<string, any>[] }} books
 * @returns {ScamContext}
 */
export function scamContext({ partners = [], transactions = [], accounts = [] }) {
	const knownDomains = new Set();
	for (const p of partners) {
		if (p.deleted) continue;
		for (const d of p.senderDomains ?? []) knownDomains.add(registrable(d));
	}
	/** @type {Map<string, Set<string>>} */
	const ibansByAlias = new Map();
	for (const t of transactions) {
		const iban = String(t.counterpartyIban ?? '')
			.replace(/\s/g, '')
			.toUpperCase();
		if (t.deleted || iban.length < 8) continue;
		const alias = txAlias(t);
		if (!alias) continue;
		ibansByAlias.set(alias, (ibansByAlias.get(alias) ?? new Set()).add(iban.slice(-4)));
	}
	const ownLast4 = new Set(
		accounts
			.map((a) => String(a.ibanLast4 ?? '').toUpperCase())
			.filter((l) => /^[A-Z0-9]{4}$/.test(l))
	);
	return { partners, knownDomains, ibansByAlias, ownLast4 };
}

/**
 * @typedef {{ code: 'auth-fail' | 'lookalike' | 'other-domain' | 'new-iban' | 'free-mail' | 'pressure' | 'foreign-links', strong: boolean, detail: string }} ScamSign
 */

/**
 * The signs a receipt shows, and whether they add up to a suspicion.
 *
 * @param {Record<string, any>} receipt
 * @param {ScamContext} ctx
 * @returns {{ signs: ScamSign[], suspicious: boolean }}
 */
export function scamSigns(receipt, ctx) {
	/** @type {ScamSign[]} */
	const signs = [];
	if (receipt.source !== 'mail' || receipt.outgoing || receipt.scamCleared) {
		return { signs, suspicious: false };
	}
	const sender = mailDomain(receipt.from) ?? '';
	const domain = sender ? registrable(sender) : '';
	const x = receipt.extraction ?? {};
	const isInvoice = x.document_type && x.document_type !== 'none';

	// A sender a person released ("Absender freigeben") is not held against it again.
	if (receipt.authVerdict === 'fail' && receipt.confirmedByUser !== true) {
		signs.push({ code: 'auth-fail', strong: true, detail: sender });
	}

	const vendor = String(receipt.vendor ?? x.vendor ?? '').trim();
	const partner = vendor ? findPartner(ctx.partners, vendor) : null;
	const partnerDomains = new Set((partner?.senderDomains ?? []).map(registrable));

	if (domain && !ctx.knownDomains.has(domain)) {
		const imitated = [...ctx.knownDomains, ...partnerDomains].find((k) => imitates(domain, k));
		if (imitated)
			signs.push({ code: 'lookalike', strong: true, detail: `${domain} ~ ${imitated}` });
	}
	if (
		domain &&
		partnerDomains.size &&
		!partnerDomains.has(domain) &&
		!signs.some((s) => s.code === 'lookalike')
	) {
		signs.push({
			code: 'other-domain',
			strong: true,
			detail: `${domain} ≠ ${[...partnerDomains].join(', ')}`
		});
	}

	const last4 = String(x.iban_last4 ?? '')
		.toUpperCase()
		.trim();
	if (partner && /^[A-Z0-9]{4}$/.test(last4) && !ctx.ownLast4.has(last4)) {
		/** @type {Set<string>} */
		const paid = new Set();
		for (const alias of partner.aliases ?? []) {
			for (const l of ctx.ibansByAlias.get(alias) ?? []) paid.add(l);
		}
		if (paid.size && !paid.has(last4)) {
			signs.push({ code: 'new-iban', strong: true, detail: `···${last4}` });
		}
	}

	if (isInvoice && domain && FREE_MAIL.has(domain)) {
		signs.push({ code: 'free-mail', strong: false, detail: domain });
	}
	const words = PRESSURE.exec(`${receipt.subject ?? ''} ${receipt.excerpt ?? ''}`);
	if (words) signs.push({ code: 'pressure', strong: false, detail: words[0] });

	const hosts = [...String(receipt.extractionSent ?? '').matchAll(/\[LINK ([^\]\s]+)\]/g)]
		.map((m) => registrable(m[1]))
		.filter((h) => h && h !== domain && !ctx.knownDomains.has(h));
	const foreign = [...new Set(hosts)];
	if (domain && foreign.length) {
		signs.push({ code: 'foreign-links', strong: false, detail: foreign.slice(0, 3).join(', ') });
	}

	const suspicious = signs.some((s) => s.strong) || signs.filter((s) => !s.strong).length >= 2;
	return { signs, suspicious };
}

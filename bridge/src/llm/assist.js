// "Mit KI weitersuchen": the private-mailbox search in two LLM steps, only on
// a person's click, only when the plain search found no clear receipt.
//
//   1. terms  the booking's counterparty and purpose (redacted) → up to four
//             search words and three sender domains the vendor's receipts
//             likely come from ("Anthropic* Claude Sub" → "Anthropic",
//             "Claude", mail.anthropic.com, stripe.com)
//   2. pick   the hits of those searches, as metadata only – subject, sender
//             domain, attachment names, day received, redacted – → which one
//             is the receipt, how sure, and why in a few German words
//
// No mail text, no attachment and no address other than a domain goes to the
// LLM. What was sent is returned, so the app can show it.

import { redact } from './redact.js';

export const MAX_TERMS = 4;
export const MAX_DOMAINS = 3;
export const MAX_CANDIDATES = 15;

export const TERMS_SYSTEM = `You help find the receipt for a bank booking of a German company in its mailbox.
You get the booking's counterparty and purpose as the bank shows them (card and PayPal lines are often abbreviated).
Answer with one JSON object and nothing else:
{
  "vendor": string | null,   // the company that most likely issued the receipt
  "terms": [string],         // 1–4 words or short phrases to search mails for (vendor and brand names, no amounts, no dates)
  "domains": [string]        // 0–3 mail domains its receipts or invoices likely come from, e.g. "mail.example.com" or a payment provider's
}
Never invent a person's name. Use only what the booking suggests.`;

export const PICK_SYSTEM = `You pick the mail that carries the receipt or invoice for a bank booking of a German company.
You get the booking and numbered candidate mails, each with subject, sender domain, attachment names and the day it arrived.
Answer with one JSON object and nothing else:
{
  "best": number | null,              // the candidate's number, null when none is the receipt
  "confidence": "high" | "medium" | "low",
  "reason": string                    // why, at most 20 words, German
}
Sign-in links, newsletters, shipping notices and marketing are never the receipt.`;

const TERM = /^[^"\\\r\n@]{2,40}$/;
const DOMAIN = /^(?=.{4,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** @param {any} data */
export function checkTerms(data) {
	/** @type {string[]} */
	const problems = [];
	if (!data || typeof data !== 'object' || Array.isArray(data)) return ['not an object'];
	if (
		!Array.isArray(data.terms) ||
		!data.terms.some((t) => typeof t === 'string' && TERM.test(t.trim()))
	)
		problems.push('no usable term');
	if (data.domains !== undefined && !Array.isArray(data.domains))
		problems.push('domains is not a list');
	return problems;
}

/**
 * The usable part of an answer: plain terms without digit runs, lower-case
 * domains that look like domains, each list capped.
 *
 * @param {any} data a checked answer
 * @param {string[]} [known] domains the app already knows for this vendor
 */
export function cleanTerms(data, known = []) {
	const terms = [
		...new Set(
			(data.terms ?? [])
				.filter((/** @type {unknown} */ t) => typeof t === 'string')
				.map((/** @type {string} */ t) => t.trim())
				.filter((/** @type {string} */ t) => TERM.test(t) && !/\d{4,}/.test(t))
		)
	].slice(0, MAX_TERMS);
	const domains = [
		...new Set(
			[...known, ...(Array.isArray(data.domains) ? data.domains : [])]
				.filter((d) => typeof d === 'string')
				.map((d) => d.trim().toLowerCase().replace(/^@/, ''))
				.filter((d) => DOMAIN.test(d))
		)
	].slice(0, MAX_DOMAINS);
	const vendor =
		typeof data.vendor === 'string' && TERM.test(data.vendor.trim()) ? data.vendor.trim() : null;
	return { vendor, terms, domains };
}

/**
 * @param {any} data
 * @param {number} count how many candidates there were
 */
export function checkPick(data, count) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return ['not an object'];
	/** @type {string[]} */
	const problems = [];
	if (data.best !== null && !(Number.isInteger(data.best) && data.best >= 1 && data.best <= count))
		problems.push('best is not a candidate');
	if (!['high', 'medium', 'low'].includes(data.confidence))
		problems.push('confidence is not high/medium/low');
	if (typeof data.reason !== 'string') problems.push('reason missing');
	return problems;
}

/** @param {string} address */
const domainOf = (address) =>
	String(address ?? '')
		.toLowerCase()
		.split('@')[1] ?? '';

/**
 * The candidates as the LLM sees them: numbered metadata lines, redacted.
 *
 * @param {{ counterparty: string, amount: string | null, around: string | null }} booking
 * @param {import('../mail/imap.js').MailMessage[]} hits
 * @param {{ terms?: string[], ownDomains?: string[] }} options redaction
 */
export function pickMessage(booking, hits, options) {
	const lines = [
		`Buchung: ${booking.counterparty}${booking.amount ? ` · ${booking.amount} EUR` : ''}${booking.around ? ` · ${booking.around}` : ''}`,
		'Kandidaten:'
	];
	hits.forEach((h, i) => {
		const files =
			h.attachments
				.map((a) => a.name)
				.filter(Boolean)
				.join(', ') || 'keine';
		lines.push(
			`${i + 1}. Betreff: ${h.subject} | Absender-Domain: ${domainOf(h.from.address)} | Anhänge: ${files} | Eingang: ${String(h.receivedAt ?? '').slice(0, 10)}`
		);
	});
	return redact(lines.join('\n'), options);
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {{ search: (q: any) => Promise<import('../mail/imap.js').MailMessage[]> }} deps.mail
 * @param {{ terms?: string[], ownDomains?: string[] }} deps.redaction
 */
export function createMailAssist({ llm, mail, redaction }) {
	return {
		/**
		 * @param {{ counterparty: string, purpose?: string, amount?: string | null, around?: string | null, days?: number, knownDomains?: string[] }} query
		 */
		async search({
			counterparty,
			purpose = '',
			amount = null,
			around = null,
			days = 14,
			knownDomains = []
		}) {
			const asked = redact(
				`Gegenpartei: ${counterparty}${purpose ? `\nVerwendungszweck: ${purpose.slice(0, 300)}` : ''}`,
				redaction
			);
			const first = await llm.json({
				system: TERMS_SYSTEM,
				content: asked.text,
				check: checkTerms
			});
			const { vendor, terms, domains } = cleanTerms(first.data, knownDomains);

			/** @type {Map<string, import('../mail/imap.js').MailMessage>} */
			const merged = new Map();
			const searches = [
				...terms.map((text) => ({ text, from: [] })),
				...(domains.length ? [{ text: null, from: domains }] : [])
			];
			for (const s of searches) {
				for (const m of await mail.search({ ...s, around, days })) {
					const seen = merged.get(m.id);
					merged.set(
						m.id,
						seen
							? { ...seen, matched: [...new Set([...(seen.matched ?? []), ...(m.matched ?? [])])] }
							: m
					);
				}
			}
			const messages = [...merged.values()].sort((a, b) =>
				String(b.receivedAt).localeCompare(String(a.receivedAt))
			);
			const candidates = messages.slice(0, MAX_CANDIDATES);
			/** @type {{ id: string, confidence: string, reason: string } | null} */
			let pick = null;
			/** @type {any} */
			let second = null;
			let sentPick = null;
			if (candidates.length) {
				const content = pickMessage(
					{ counterparty: asked.text.split('\n')[0].replace(/^Gegenpartei: /, ''), amount, around },
					candidates,
					redaction
				);
				sentPick = content.text;
				second = await llm.json({
					system: PICK_SYSTEM,
					content: content.text,
					check: (d) => checkPick(d, candidates.length)
				});
				const best = second.data.best;
				if (best !== null) {
					pick = {
						id: candidates[best - 1].id,
						confidence: second.data.confidence,
						reason: String(second.data.reason).slice(0, 200)
					};
				}
			}
			return {
				vendor,
				terms,
				domains,
				messages,
				pick,
				llm: {
					calls: [first, ...(second ? [second] : [])].map((c) => ({
						model: c.model,
						ms: c.ms,
						usage: c.usage
					})),
					// Exactly what left this machine, already redacted.
					sent: [asked.text, ...(sentPick ? [sentPick] : [])]
				}
			};
		}
	};
}

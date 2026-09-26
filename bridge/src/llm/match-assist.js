// "✦ KI-Vorschlag" under "Beleg zuordnen": when no receipt has points enough
// to be suggested, the LLM picks among the candidates the app sends – their
// read fields only (vendor, amount, date, invoice number, a short summary),
// which came from the LLM in the first place, and the booking's
// counterparty, purpose, amount and day, all redacted here. The pick is a
// suggestion; the person links.

import { redact } from './redact.js';

export const MAX_RECEIPT_CANDIDATES = 25;

export const RECEIPT_PICK_SYSTEM = `You match a bank booking of a German company to one of its receipts.
You get the booking (counterparty and purpose as the bank shows them, amount, day) and numbered receipts with vendor, amount, currency, date, invoice number and a short summary.
Answer with one JSON object and nothing else:
{
  "best": number | null,              // the receipt's number, null when none fits
  "confidence": "high" | "medium" | "low",
  "reason": string                    // why, at most 20 words, German
}
Card and PayPal lines abbreviate vendor names; amounts in another currency may differ by the exchange rate and fees. A receipt that clearly belongs to another purchase is no match.`;

/**
 * @param {any} data
 * @param {number} count
 */
export function checkReceiptPick(data, count) {
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

/**
 * @typedef {{ id: string, vendor?: string, amount?: string, currency?: string, date?: string, number?: string, summary?: string }} ReceiptCandidate
 * @typedef {{ counterparty?: string, purpose?: string, amount?: string, day?: string }} Booking
 */

/**
 * What the LLM sees: the booking, then numbered receipts; redacted.
 *
 * @param {Booking} booking
 * @param {ReceiptCandidate[]} candidates
 * @param {{ terms?: string[], ownDomains?: string[] }} redaction
 */
export function receiptPickMessage(booking, candidates, redaction) {
	const lines = [
		`Buchung: ${booking.counterparty || '—'} | Zweck: ${String(booking.purpose ?? '').slice(0, 300) || '—'} | Betrag: ${booking.amount ?? '?'} EUR | Tag: ${booking.day ?? '?'}`,
		'Belege:'
	];
	candidates.forEach((c, i) => {
		lines.push(
			`${i + 1}. Anbieter: ${c.vendor || '—'} | Betrag: ${c.amount ?? '?'} ${c.currency ?? ''} | Datum: ${c.date ?? '?'} | Nr.: ${c.number || '—'} | Inhalt: ${String(c.summary ?? '').slice(0, 120) || '—'}`
		);
	});
	return redact(lines.join('\n'), redaction);
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {{ terms?: string[], ownDomains?: string[] }} deps.redaction
 */
export function createMatchAssist({ llm, redaction }) {
	return {
		/**
		 * @param {{ booking: Booking, candidates: ReceiptCandidate[] }} query
		 */
		async pick({ booking, candidates }) {
			const list = candidates.slice(0, MAX_RECEIPT_CANDIDATES);
			const content = receiptPickMessage(booking, list, redaction);
			const answer = await llm.json({
				system: RECEIPT_PICK_SYSTEM,
				content: content.text,
				check: (d) => checkReceiptPick(d, list.length)
			});
			const best = answer.data.best;
			return {
				pick:
					best === null
						? null
						: {
								id: list[best - 1].id,
								confidence: answer.data.confidence,
								reason: String(answer.data.reason).slice(0, 200)
							},
				llm: {
					calls: [{ model: answer.model, ms: answer.ms, usage: answer.usage }],
					sent: [content.text]
				}
			};
		}
	};
}

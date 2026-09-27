// "✦ Ungereimtheiten erklären" on a vendor account (issue #121): the LLM reads
// one vendor's timeline – top-ups, statements with their billing periods and
// positions, the running balance and what the rules found – and says in a
// few German sentences what does not add up and what to check. A suggestion;
// nothing is booked. Redacted like every call, and without phone, customer or
// invoice numbers, addresses or hashes.

import { redact } from './redact.js';
import { stripChainIds } from './transfer-assist.js';

export const MAX_ROWS = 120;

export const VENDOR_EXPLAIN_SYSTEM = `You help a German company's bookkeeping check one vendor account.
You get the vendor's timeline for a period: payments (top-ups) and the vendor's statements with their billing period and positions, a running balance (opening + payments − statements), and the findings of fixed rules.
Often the vendor is a prepaid tariff: payments are top-ups, statements bill what the credit was used for, usually the month before.
Answer with one JSON object and nothing else:
{
  "notes": [string]      // at most 6 short German sentences: what does not add up, and what to check or ask the vendor for
}
Name months and amounts. Do not invent payments or statements that are not listed. When everything adds up, say so in one note.`;

/** @param {any} data */
export function checkVendorNotes(data) {
	if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) return ['notes missing'];
	if (!data.notes.every((/** @type {unknown} */ n) => typeof n === 'string'))
		return ['a note is not text'];
	return [];
}

// Phone numbers and long numbers (customer, contract, invoice): not needed to reason.
const PHONE = /(?:\+|\b00)\d[\d\s/()-]{6,}\d|\b0\d{2,5}[\s/-]?\d{3,}[\s-]?\d{0,6}\b/g;
// A date (YYYY-MM-DD) is no number to hide.
const LONG_NUMBER = /\b(?!\d{4}-\d{2}-\d{2}\b)[A-Z]{0,4}\d[\dA-Z-]{7,}\b/g;

/** @param {unknown} text */
const scrub = (text) =>
	stripChainIds(String(text ?? ''))
		.replace(PHONE, '[Telefon]')
		.replace(LONG_NUMBER, '[Nummer]');

/**
 * @typedef {{ date: string, kind: 'payment' | 'receipt', topUp?: string, usage?: string, balance: string, period?: { from: string, to: string } | null, items?: { description: string, amount: string }[] }} TimelineRow
 * @typedef {{ vendor: string, from: string, until: string, opening: string | null, closing: string, rows: TimelineRow[], findings: string[] }} Timeline
 */

/**
 * What the LLM sees; redacted.
 *
 * @param {Timeline} tl
 * @param {{ terms?: string[], ownDomains?: string[] }} redaction
 */
export function vendorMessage(tl, redaction) {
	const lines = [
		`Lieferant: ${tl.vendor} | Zeitraum: ${tl.from} bis ${tl.until} | Anfangsbestand: ${tl.opening ?? 'unbekannt'} EUR | Saldo am Ende: ${tl.closing} EUR`,
		'Zeitleiste:'
	];
	for (const r of tl.rows.slice(0, MAX_ROWS)) {
		if (r.kind === 'payment') {
			lines.push(`${r.date} Zahlung ${r.topUp ?? '?'} EUR → Saldo ${r.balance}`);
		} else {
			const period = r.period ? ` für ${r.period.from} bis ${r.period.to}` : '';
			const items = (r.items ?? [])
				.slice(0, 20)
				.map((i) => `${String(i.description).slice(0, 80)} ${i.amount}`)
				.join('; ');
			lines.push(
				`${r.date} Beleg${period} ${r.usage ?? '?'} EUR → Saldo ${r.balance}${items ? ` (Positionen: ${items})` : ''}`
			);
		}
	}
	lines.push(`Befunde der Regeln: ${tl.findings.length ? tl.findings.join('; ') : 'keine'}`);
	return redact(scrub(lines.join('\n')), redaction);
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {{ terms?: string[], ownDomains?: string[] }} deps.redaction
 */
export function createVendorAssist({ llm, redaction }) {
	return {
		/** @param {Timeline} tl */
		async explain(tl) {
			const content = vendorMessage(tl, redaction);
			const answer = await llm.json({
				system: VENDOR_EXPLAIN_SYSTEM,
				content: content.text,
				check: checkVendorNotes
			});
			return {
				notes: answer.data.notes.slice(0, 6).map((/** @type {string} */ n) => n.slice(0, 400)),
				llm: {
					calls: [{ model: answer.model, ms: answer.ms, usage: answer.usage }],
					sent: [content.text]
				}
			};
		}
	};
}

// "✦ KI-Vorschlag" under "Als Gegenbuchung verknüpfen …" (issue #109): the
// LLM picks which of the candidate bookings is the other side of an own
// transfer, or none. It gets, per booking, the direction, the euro amount,
// the crypto quantity and asset, the day, the kind of account (bank,
// exchange, wallet and chain), the counterparty name and a short purpose or
// memo – redacted like every other call, and without any address, IBAN or
// transaction hash (those are cut here, on top of the redaction). The pick is
// a suggestion; the person links.

import { redact } from './redact.js';

export const MAX_TRANSFER_CANDIDATES = 8;

export const TRANSFER_PICK_SYSTEM = `You help a German company's bookkeeping find own transfers: money or coins moved between two of its own accounts (bank accounts, crypto exchange accounts, crypto wallets on different chains).
You get one booking and numbered candidate bookings on its other accounts, each with direction, euro amount, crypto quantity and asset, day, the kind of account, counterparty and purpose.
Answer with one JSON object and nothing else:
{
  "best": number | null,              // the candidate that is the other side of the same own transfer, null when none is
  "confidence": "high" | "medium" | "low",
  "reason": string                    // why, at most 20 words, German
}
An own transfer leaves one account and arrives on another, usually within days. Exchanges and bridges keep fees, so the arriving amount may be somewhat smaller; euro values of crypto differ with the rate. A payment to or from a third party (a vendor, a customer) is no own transfer. When unsure, say null.`;

/**
 * @param {any} data
 * @param {number} count
 */
export function checkTransferPick(data, count) {
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
 * @typedef {{ direction?: 'in' | 'out', amount?: string, quantity?: string, asset?: string, day?: string, account?: string, counterparty?: string, purpose?: string }} TransferBooking
 * @typedef {TransferBooking & { id: string }} TransferCandidate
 */

/**
 * EVM addresses and hashes (0x…), long hex strings (Cosmos and Bitcoin
 * hashes) and bech32 addresses: none leaves.
 *
 * @param {string} text
 */
export const stripChainIds = (text) =>
	String(text ?? '')
		.replace(/\b0x[0-9a-fA-F]{8,}\b/g, '[Adresse]')
		.replace(/\b[0-9a-fA-F]{32,}\b/g, '[Hash]')
		.replace(/\b[a-z]{1,20}1[02-9ac-hj-np-z]{20,}\b/g, '[Adresse]');

/** @param {TransferBooking} b */
function line(b) {
	const dir = b.direction === 'in' ? 'Eingang' : b.direction === 'out' ? 'Ausgang' : '?';
	const qty = b.quantity && b.asset ? ` | Menge: ${b.quantity} ${b.asset}` : '';
	return `${dir} | Betrag: ${b.amount ?? '?'} EUR${qty} | Tag: ${b.day ?? '?'} | Konto: ${b.account || '—'} | Gegenpartei: ${String(b.counterparty ?? '').slice(0, 120) || '—'} | Zweck: ${String(b.purpose ?? '').slice(0, 200) || '—'}`;
}

/**
 * What the LLM sees: the booking, then numbered candidates; redacted.
 *
 * @param {TransferBooking} booking
 * @param {TransferCandidate[]} candidates
 * @param {{ terms?: string[], ownDomains?: string[] }} redaction
 */
export function transferPickMessage(booking, candidates, redaction) {
	const lines = [`Buchung: ${line(booking)}`, 'Kandidaten:'];
	candidates.forEach((c, i) => lines.push(`${i + 1}. ${line(c)}`));
	return redact(stripChainIds(lines.join('\n')), redaction);
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {{ terms?: string[], ownDomains?: string[] }} deps.redaction
 */
export function createTransferAssist({ llm, redaction }) {
	return {
		/**
		 * @param {{ booking: TransferBooking, candidates: TransferCandidate[] }} query
		 */
		async pick({ booking, candidates }) {
			const list = candidates.slice(0, MAX_TRANSFER_CANDIDATES);
			const content = transferPickMessage(booking, list, redaction);
			const answer = await llm.json({
				system: TRANSFER_PICK_SYSTEM,
				content: content.text,
				check: (d) => checkTransferPick(d, list.length)
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

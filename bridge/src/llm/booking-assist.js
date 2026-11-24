// "✦ Konto vorschlagen" on a payment's "Konto": the LLM reads the booking, its
// receipt (vendor, kind, positions), the accounts the books already learned
// for vendors, and the chart of accounts the person read in (or the built-in
// SKR 03 list), and names up to two accounts of that list with a short
// reason. A suggestion only: nothing is booked until the person takes it.
//
// Redacted like every call, unless the model runs on this machine or in an
// attested enclave and setup:llm was told not to (config.js redactionOff).
// An answer naming an account that is not in the list sent is dropped.
//
// The app leaves the payment's own account, and every other own bank, wallet
// or exchange account unless the payment is an own transfer, out of the list
// (app booking/assist-guard.js), and says what it already knows of the
// payment (`known`): the model is told which side of the books is wanted.

import { redact } from './redact.js';
import { stripChainIds } from './transfer-assist.js';

export const MAX_ACCOUNTS = 600;
export const MAX_LEARNED = 80;
export const MAX_PICKS = 2;

/** What the app may say it knows of a payment (`booking.known`). */
export const KNOWN_BOOKINGS = Object.freeze(['reward', 'cloud-credits', 'fee', 'own-transfer']);

/** @type {Record<string, string>} */
const KNOWN_TEXT = {
	reward:
		'Die App weiß: ein Ertrag aus Staking, Earn oder Mining, kein Beleg nötig. Gesucht ist ein Ertragskonto, nicht das Konto, auf dem der Ertrag eingeht.',
	'cloud-credits':
		'Die App weiß: der Kauf von Aleph-Credits (Rechen- und Speicherleistung in der Cloud); die Monatsabrechnung ist der Beleg. Gesucht ist ein Aufwandskonto, nicht das Konto, von dem gezahlt wurde.',
	fee: 'Die App weiß: eine Gebühr des Kontos oder des Netzwerks. Gesucht ist ein Aufwandskonto.',
	'own-transfer':
		'Die App weiß: eine Umbuchung zwischen eigenen Konten. Gesucht ist das Konto der anderen Seite oder Geldtransit.'
};

export const BOOKING_SYSTEM = `You help a German company's bookkeeping choose the contra account (Gegenkonto) for one payment.
You get the payment, its receipt if there is one, the accounts the books already use for known vendors, and the company's chart of accounts as "number: name" lines.
Answer with one JSON object and nothing else:
{
  "picks": [                              // 0–2 accounts, best first
    {
      "account": string,                  // a number from the chart, exactly as listed
      "confidence": "high" | "medium" | "low",
      "reason": string                    // why, at most 20 words, German
    }
  ]
}
Pick only numbers from the chart. Prefer an account the books already use for the same vendor. Money in wants a revenue or income account, money out an expense account (an asset only for a purchase of one). Never pick the account the payment is on ("eigenes Konto") or another bank, wallet or exchange account of the company, unless the payment is a transfer between own accounts. When the payment says what the app already knows ("Die App weiß"), follow it. When nothing fits, answer an empty list.`;

const NUMBER = /^\d{4,8}$/;

/**
 * @param {any} data
 * @param {Set<string>} numbers the accounts that were sent
 */
export function checkPicks(data, numbers) {
	if (!data || typeof data !== 'object' || !Array.isArray(data.picks)) return ['picks missing'];
	/** @type {string[]} */
	const problems = [];
	for (const p of data.picks) {
		if (!p || typeof p !== 'object') {
			problems.push('a pick is not an object');
			continue;
		}
		if (!numbers.has(String(p.account ?? '').trim()))
			problems.push('an account is not in the chart');
		if (!['high', 'medium', 'low'].includes(p.confidence))
			problems.push('confidence is not high/medium/low');
		if (typeof p.reason !== 'string') problems.push('reason missing');
	}
	return problems;
}

/**
 * @typedef {{ direction: 'in' | 'out', amount: string, day: string, account?: string | null, counterparty?: string | null, purpose?: string | null, known?: string }} Booking
 * @typedef {{ vendor?: string | null, kind?: string | null, items?: string[], vat?: string | null }} Receipt
 * @typedef {{ vendor: string, account: string }} Learned
 * @typedef {{ number: string, name: string }} Account
 */

/**
 * What the LLM sees; redacted unless `off`.
 *
 * @param {{ booking: Booking, receipt?: Receipt | null, learned?: Learned[], accounts: Account[] }} input
 * @param {{ terms?: string[], ownDomains?: string[], off?: boolean }} redaction
 */
export function bookingMessage({ booking, receipt = null, learned = [], accounts }, redaction) {
	const b = booking;
	const lines = [
		`Zahlung: ${b.direction === 'in' ? 'Eingang' : 'Ausgang'} ${b.amount} EUR am ${b.day}${b.account ? ` | eigenes Konto: ${b.account}` : ''}`,
		`Gegenpartei: ${b.counterparty || 'unbekannt'}`,
		...(b.purpose ? [`Verwendungszweck: ${String(b.purpose).slice(0, 300)}`] : []),
		// An own transfer is neither: its own line says what is wanted.
		...(b.known === 'own-transfer'
			? []
			: [
					b.direction === 'in'
						? 'Gesucht: ein Ertrags- oder Erlöskonto (Geld kommt herein).'
						: 'Gesucht: ein Aufwandskonto (Geld geht hinaus).'
				]),
		...(b.known && KNOWN_TEXT[b.known] ? [KNOWN_TEXT[b.known]] : [])
	];
	if (receipt) {
		lines.push(
			`Beleg: ${receipt.vendor || 'unbekannt'}${receipt.kind ? ` | Art: ${receipt.kind}` : ''}${receipt.vat ? ` | USt: ${receipt.vat}` : ''}`
		);
		const items = (receipt.items ?? []).slice(0, 10).map((i) => String(i).slice(0, 80));
		if (items.length) lines.push(`Positionen: ${items.join('; ')}`);
	} else {
		lines.push('Beleg: keiner');
	}
	lines.push('Gelernte Konten (Lieferant → Konto):');
	lines.push(
		...(learned.length
			? learned.slice(0, MAX_LEARNED).map((l) => `${l.vendor} → ${l.account}`)
			: ['keine'])
	);
	lines.push('Kontenplan:');
	// "number: name": a five-digit number before a capitalised name would read
	// as a postcode and city to the redaction.
	lines.push(...accounts.slice(0, MAX_ACCOUNTS).map((a) => `${a.number}: ${a.name}`));
	return redact(stripChainIds(lines.join('\n')), redaction);
}

/**
 * @param {object} deps
 * @param {Pick<import('./extract.js').Extractor, 'json'>} deps.llm
 * @param {{ terms?: string[], ownDomains?: string[], off?: boolean }} deps.redaction
 */
export function createBookingAssist({ llm, redaction }) {
	return {
		/** @param {{ booking: Booking, receipt?: Receipt | null, learned?: Learned[], accounts: Account[] }} input */
		async suggest(input) {
			const accounts = input.accounts
				.filter((a) => NUMBER.test(String(a.number)))
				.slice(0, MAX_ACCOUNTS);
			const numbers = new Set(accounts.map((a) => String(a.number)));
			const content = bookingMessage({ ...input, accounts }, redaction);
			const answer = await llm.json({
				system: BOOKING_SYSTEM,
				content: content.text,
				check: (d) => checkPicks(d, numbers)
			});
			/** @type {Set<string>} */
			const seen = new Set();
			const picks = answer.data.picks
				.map((/** @type {any} */ p) => ({
					account: String(p.account).trim(),
					confidence: p.confidence,
					reason: String(p.reason).slice(0, 200)
				}))
				.filter((/** @type {{ account: string }} */ p) => {
					if (seen.has(p.account)) return false;
					seen.add(p.account);
					return true;
				})
				.slice(0, MAX_PICKS);
			return {
				picks,
				llm: {
					calls: [{ model: answer.model, ms: answer.ms, usage: answer.usage }],
					// Exactly what left this machine, redacted unless the model is local or attested.
					sent: [content.text]
				}
			};
		}
	};
}

// Receipt data from a receipt's text, by an OpenAI-compatible chat API
// (DeepSeek by default). Moved here from the phase-0 spike
// (spikes/llm/extract.mjs): the same prompt and schema, the same budget.
//
// Findings that shape it (docs/phase-0.md):
//   - both DeepSeek models reason before they answer, and the reasoning counts
//     against max_tokens: 6000, and anything but finish_reason `stop` is a
//     failure, never a half answer;
//   - flash first, v4-pro as the retry when flash fails or its answer does
//     not check out (net + VAT ≠ gross, a date that is no date, no gross, a
//     currency that is no ISO code);
//   - JSON mode.
//
// The text is redacted (redact.js) before anything is sent, here and not in
// the browser. Neither the text nor the answer is ever logged.

import { redactionOff } from '../config.js';
import { redact, sumCounts } from './redact.js';

export const MAX_TOKENS = 6000;
export const MAX_TEXT = 30_000;
/** How long one answer may take from a provider elsewhere. */
export const TIMEOUT_MS = 180_000;
/**
 * …and from a model on this machine: on a CPU (Ollama on an Intel Mac) one
 * receipt takes two minutes and more, and the first after a pause also loads
 * the model into memory. Measured 2026-10-15: 121–154 s per receipt, warm.
 */
export const LOCAL_TIMEOUT_MS = 600_000;

export const SYSTEM = `You extract bookkeeping data from receipts in any language (German, English, Russian, Ukrainian,
Polish, Czech, Turkish, Arabic, Spanish, Italian, French or any other) for a German company (UG).
Answer with one JSON object and nothing else, using exactly these keys (null when not present):
{
  "document_type": "invoice" | "receipt" | "direct_debit_notice" | "payment_reminder" | "credit_card_statement" | "ticket" | "other" | "none",
  "vendor": string,                 // the company that issued the document
  "vendor_vat_id": string | null,
  "vendor_country": string | null,  // ISO 3166 alpha-2 of the vendor's address, e.g. "DE", "AT", "US"
  "customer_vat_id": string | null, // the VAT ID of the customer (the recipient), if printed
  "customer_country": string | null,// ISO 3166 alpha-2 of the customer's address
  "invoice_number": string | null,
  "customer_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_or_debit_date": "YYYY-MM-DD" | null,
  "service_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } | null,
  "currency": "EUR" | ...,
  "net": number | null,
  "vat": [ { "rate": number, "amount": number, "category": "standard" | "reduced" | "zero" | "exempt" | "reverse_charge" | "intra_eu" | "export" | "not_taxable" | null } ],
  "gross": number,                  // the amount that is or was paid; negative for credit notes
  "payment": "direct_debit" | "card" | "paypal" | "bank_transfer" | "paid" | "open" | null,
  "iban_last4": string | null,      // the IBAN's last four, also from a redacted one like [IBAN …1234]
  "reverse_charge": boolean,        // no German VAT because the vendor is abroad (§13b UStG)
  "travel": {                       // only for a travel cost, a hotel, a restaurant meal or an event ticket
    "kind": "train" | "bus" | "flight" | "public_transport" | "taxi" | "rental_car" | "fuel" | "parking" | "hotel" | "restaurant" | "event",
    "from": string | null,           // where the journey starts
    "to": string | null,             // where it goes
    "departure": "YYYY-MM-DDTHH:MM" | null,
    "arrival": "YYYY-MM-DDTHH:MM" | null,
    "return_departure": "YYYY-MM-DDTHH:MM" | null,  // a return ticket's way back
    "return_arrival": "YYYY-MM-DDTHH:MM" | null,
    "place": string | null,          // the town of a hotel, a restaurant or an event
    "check_in": "YYYY-MM-DD" | null, // a hotel's first night
    "check_out": "YYYY-MM-DD" | null,
    "nights": number | null,
    "breakfast_included": boolean | null  // the hotel invoice includes breakfast
  } | null,
  "summary": string,                // what was bought, max 12 words, German
  "line_items": [ { "description": string, "amount": number } ] | null,  // the billed positions as printed, at most 20
  "no_payment_request": boolean     // the document says it asks for no payment (prepaid statement, already paid)
}
Amounts are numbers with a dot as decimal separator, whatever the receipt writes ("4 512,30" → 4512.30).
Dates and times in ISO form, whatever the receipt writes: a European "12/03/2026" is 12 March, "14MAR26" is
2026-03-14. The currency as its ISO code ("руб.", "₽" → RUB; "TL", "₺" → TRY; "zł" → PLN; "Kč" → CZK;
"грн", "₴" → UAH; "درهم" → AED). Names of vendors, places and stations as printed, in their own script.
The summary is German, whatever the receipt's language. Never guess a value that is not in the text.
A VAT line's category follows what the invoice prints: "Steuerschuldnerschaft des Leistungsempfängers" or
"Reverse charge" → reverse_charge; "innergemeinschaftliche Lieferung/Leistung", "intra-Community supply",
"steuerfreie innergemeinschaftliche Lieferung" → intra_eu; "Ausfuhrlieferung", "export" → export; "nicht im
Inland steuerbar", "not subject to German VAT" → not_taxable; "steuerfrei nach § 4" → exempt; 0 % without
such a reason → zero; the normal rate → standard; a reduced rate → reduced. Such an invoice often has a VAT
line with amount 0: keep it, with its category.
"travel" is null for anything else; times are local times as printed, never made up.
Use "none" when the text is no bookkeeping document at all (a sign-in link, a newsletter, a
shipping or account notice without an amount to pay); then gross and currency are null and the
summary says what it is.`;

export class ExtractError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string} code
	 * @param {{ model: string, ok: boolean, reason: string }[]} [attempts]
	 */
	constructor(message, status, code, attempts = []) {
		super(message);
		this.name = 'ExtractError';
		this.status = status;
		this.code = code;
		this.attempts = attempts;
	}
}

/**
 * The provider refused, rather than a model failing on this one text (#417):
 * what each kind of refusal is called, its HTTP status towards the app, and
 * what the bridge says. The app stops a run on any of them – every further
 * receipt would be refused the same way – and keeps the rest for later.
 */
export const REFUSALS = Object.freeze({
	rate: {
		code: 'LLM_RATE_LIMIT',
		status: 429,
		message: 'the provider limits requests; try again shortly'
	},
	credit: { code: 'LLM_NO_CREDIT', status: 402, message: "the provider's credit is used up" },
	auth: { code: 'LLM_AUTH', status: 502, message: 'the provider refuses the API key' },
	model: { code: 'LLM_MODEL', status: 502, message: 'the provider does not know the model' },
	unreachable: { code: 'LLM_UNREACHABLE', status: 502, message: 'the provider cannot be reached' }
});

/**
 * What kind of refusal one attempt was, or null when the provider answered.
 *
 * @param {{ status?: number, unreachable?: boolean, modelUnknown?: boolean }} r
 * @returns {keyof typeof REFUSALS | null}
 */
export function refusalOf(r) {
	if (r.unreachable) return 'unreachable';
	if (r.status === 429) return 'rate';
	if (r.status === 402) return 'credit';
	if (r.status === 401 || r.status === 403) return 'auth';
	if (r.status === 404 || (r.status === 400 && r.modelUnknown)) return 'model';
	return null;
}

/**
 * Every attempt refused the same way: that refusal. Anything else – a model
 * that answered but not usably, or a mix – is a failed read of this text.
 *
 * @param {(keyof typeof REFUSALS | null)[]} kinds one per attempt
 * @param {any[]} attempts
 * @param {string} provider the host the text went to
 */
export function failed(kinds, attempts, provider) {
	const [first] = kinds;
	if (first && kinds.every((k) => k === first)) {
		const r = REFUSALS[first];
		return Object.assign(new ExtractError(r.message, r.status, r.code, attempts), { provider });
	}
	return new ExtractError('no model gave a usable answer', 502, 'EXTRACT_FAILED', attempts);
}

/** A refusal that holds for every model of the provider: no use asking the next one. */
const ACCOUNT_WIDE = new Set(['credit', 'auth', 'unreachable']);

/** @param {unknown} v */
const isDay = (v) => {
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const d = new Date(`${v}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** @param {unknown} v */
const toCents = (v) => Math.round(Number(v) * 100);

/**
/** The VAT categories a line can carry (#354), as the system prompt names them. */
export const VAT_CATEGORIES = Object.freeze([
	'standard',
	'reduced',
	'zero',
	'exempt',
	'reverse_charge',
	'intra_eu',
	'export',
	'not_taxable'
]);

/**
 * The tax fields of an answer made exact, in place (#354): countries as
 * ISO 3166 alpha-2 or null, VAT IDs compact and upper case or null, a VAT
 * line's category one of VAT_CATEGORIES or null. A model that writes "Germany"
 * or an unknown category loses that one field, not the whole reading.
 *
 * @param {any} data
 */
export function normalizeTaxFields(data) {
	const country = (/** @type {unknown} */ v) => {
		const s = String(v ?? '')
			.trim()
			.toUpperCase();
		return /^[A-Z]{2}$/.test(s) ? s : null;
	};
	const vatId = (/** @type {unknown} */ v) => {
		const s = String(v ?? '')
			.replace(/[\s.-]+/g, '')
			.toUpperCase();
		return /^[A-Z]{2}(?=[A-Z0-9]*\d)[A-Z0-9]{2,13}$/.test(s) ? s : null;
	};
	data.vendor_country = country(data.vendor_country);
	data.customer_country = country(data.customer_country);
	if (data.vendor_vat_id !== undefined) data.vendor_vat_id = vatId(data.vendor_vat_id);
	data.customer_vat_id = vatId(data.customer_vat_id);
	if (Array.isArray(data.vat)) {
		for (const v of data.vat) {
			if (v && typeof v === 'object') {
				v.category = VAT_CATEGORIES.includes(v.category) ? v.category : null;
			}
		}
	}
	return data;
}

/** The kinds of travel cost a receipt can be (#213), as the system prompt names them. */
export const TRAVEL_KINDS = Object.freeze([
	'train',
	'bus',
	'flight',
	'public_transport',
	'taxi',
	'rental_car',
	'fuel',
	'parking',
	'hotel',
	'restaurant',
	'event'
]);

/**
 * The travel fields of an answer made exact, in place (#213): a kind from
 * TRAVEL_KINDS, times as `YYYY-MM-DDTHH:MM`, days as `YYYY-MM-DD`, nights a
 * whole number, places as trimmed text. What does not fit is null, not a
 * failed reading; an answer of an older shape keeps what it has.
 *
 * @param {any} data
 */
export function normalizeTravelFields(data) {
	const t = data.travel;
	if (!t || typeof t !== 'object' || Array.isArray(t)) {
		data.travel = null;
		return data;
	}
	const time = (/** @type {unknown} */ v) => {
		if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
		const [h, m] = v.slice(11).split(':').map(Number);
		return isDay(v.slice(0, 10)) && h < 24 && m < 60 ? v : null;
	};
	const day = (/** @type {unknown} */ v) => (isDay(v) ? /** @type {string} */ (v) : null);
	const text = (/** @type {unknown} */ v) =>
		typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
	const nights = Number(t.nights);
	data.travel = {
		kind: TRAVEL_KINDS.includes(t.kind) ? t.kind : null,
		from: text(t.from),
		to: text(t.to),
		departure: time(t.departure),
		arrival: time(t.arrival),
		return_departure: time(t.return_departure),
		return_arrival: time(t.return_arrival),
		place: text(t.place),
		check_in: day(t.check_in),
		check_out: day(t.check_out),
		nights: Number.isInteger(nights) && nights > 0 && nights <= 366 ? nights : null,
		breakfast_included: typeof t.breakfast_included === 'boolean' ? t.breakfast_included : null
	};
	return data;
}

/**
 * Whether an answer can be used. Returns the reasons it cannot; empty = fine.
 * Its tax fields are made exact on the way (normalizeTaxFields).
 *
 * @param {any} data
 * @returns {string[]}
 */
export function checkExtraction(data) {
	/** @type {string[]} */
	const problems = [];
	if (!data || typeof data !== 'object' || Array.isArray(data)) return ['not an object'];
	normalizeTaxFields(data);
	normalizeTravelFields(data);
	// "none": no receipt at all, nothing to add up.
	const none = data.document_type === 'none';
	if (!none && (typeof data.gross !== 'number' || !Number.isFinite(data.gross)))
		problems.push('gross missing');
	if (!none && (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency))) {
		problems.push('currency is not an ISO code');
	}
	for (const key of ['invoice_date', 'due_or_debit_date']) {
		if (data[key] !== null && data[key] !== undefined && !isDay(data[key])) {
			problems.push(`${key} is not a date`);
		}
	}
	if (data.service_period) {
		if (!isDay(data.service_period.from) || !isDay(data.service_period.to)) {
			problems.push('service_period is not two dates');
		}
	}
	if (data.line_items !== null && data.line_items !== undefined) {
		if (!Array.isArray(data.line_items)) problems.push('line_items is not a list');
		else if (
			data.line_items.some(
				(/** @type {any} */ i) =>
					!i ||
					typeof i.description !== 'string' ||
					typeof i.amount !== 'number' ||
					!Number.isFinite(i.amount)
			)
		) {
			problems.push('a line item is not a description with an amount');
		}
	}
	const vat = Array.isArray(data.vat) ? data.vat : [];
	if (data.vat !== null && data.vat !== undefined && !Array.isArray(data.vat)) {
		problems.push('vat is not a list');
	}
	if (
		vat.some((/** @type {any} */ v) => typeof v?.amount !== 'number' || !Number.isFinite(v.amount))
	) {
		problems.push('a VAT amount is not a number');
	} else if (
		typeof data.net === 'number' &&
		vat.length > 0 &&
		typeof data.gross === 'number' &&
		Math.abs(
			toCents(data.net) +
				vat.reduce((s, /** @type {any} */ v) => s + toCents(v.amount), 0) -
				toCents(data.gross)
		) > 1
	) {
		problems.push('net + VAT is not gross');
	}
	return problems;
}

/**
 * The user message: hints first (they help find the vendor), then the text.
 *
 * @param {string} text
 * @param {{ subject?: string, from?: string, fileName?: string, receivedAt?: string }} hints
 */
export function userMessage(text, hints = {}) {
	const lines = [];
	if (hints.from) lines.push(`Absender der E-Mail: ${hints.from}`);
	if (hints.subject) lines.push(`Betreff der E-Mail: ${hints.subject}`);
	if (hints.fileName) lines.push(`Dateiname: ${hints.fileName}`);
	if (hints.receivedAt) lines.push(`Eingegangen am: ${hints.receivedAt}`);
	return `${lines.length ? `${lines.join('\n')}\n---\n` : ''}${String(text).slice(0, MAX_TEXT)}`;
}

/**
 * @param {object} options
 * @param {import('../config.js').LlmConfig} options.config
 * @param {() => Promise<string>} options.getKey from the keychain
 * @param {string[]} [options.ownDomains] e-mail domains to black out
 * @param {typeof fetch} [options.fetch]
 */
export function createExtractor({ config, getKey, ownDomains = [], fetch: f = fetch }) {
	const base = config.baseUrl.replace(/\/+$/, '');
	const url = new URL(base);
	const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
		throw new Error('The LLM base URL must be https (http only for a server on this machine).');
	}
	const models = [...new Set([config.model, config.retryModel].filter(Boolean))];
	const timeoutMs = loopback ? LOCAL_TIMEOUT_MS : TIMEOUT_MS;

	/**
	 * @param {string} model
	 * @param {string} key
	 * @param {string} content
	 * @param {{ system?: string, check?: (data: any) => string[] }} [task] another question than a receipt's
	 */
	async function ask(model, key, content, { system = SYSTEM, check = checkExtraction } = {}) {
		let res;
		try {
			res = await f(`${base}/chat/completions`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model,
					max_tokens: MAX_TOKENS,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content }
					]
				}),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (/** @type {any} */ error) {
			const timeout = error.name === 'TimeoutError';
			return {
				ok: false,
				reason: timeout
					? `no answer within ${timeoutMs / 1000} s`
					: `unreachable: ${error.cause?.code ?? error.code ?? error.name}`,
				// A timeout is this text taking too long, not the provider being gone.
				unreachable: !timeout
			};
		}
		if (!res.ok) {
			// A 400 may say the model is unknown (DeepSeek: "Model Not Exist"); only that is read.
			const said =
				res.status === 400
					? await res.text().catch(() => '')
					: (await res.body?.cancel().catch(() => {}), '');
			return {
				ok: false,
				reason: `HTTP ${res.status}`,
				status: res.status,
				modelUnknown:
					/model[^.]{0,40}(not exist|not found|unknown|does not exist)|unknown model|no such model/i.test(
						String(said).slice(0, 2000)
					)
			};
		}
		/** @type {any} */
		let body;
		try {
			body = await res.json();
		} catch {
			return { ok: false, reason: 'answer is not JSON' };
		}
		const choice = body?.choices?.[0];
		// Tokens are counted (and billed) whether the answer is usable or not.
		const u = body?.usage ?? {};
		const usage = {
			prompt: Number(u.prompt_tokens ?? 0) || 0,
			completion: Number(u.completion_tokens ?? 0) || 0,
			reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) || 0,
			// Input served from the provider's cache (DeepSeek: prompt_cache_hit_tokens): cheaper.
			cached: Number(u.prompt_cache_hit_tokens ?? 0) || 0
		};
		if (choice?.finish_reason !== 'stop') {
			return {
				ok: false,
				reason: `stopped early: ${choice?.finish_reason ?? 'no choice'}`,
				usage
			};
		}
		let data;
		try {
			data = JSON.parse(choice.message?.content ?? '');
		} catch {
			return { ok: false, reason: 'content is not JSON', usage };
		}
		const problems = check(data);
		if (problems.length) {
			return { ok: false, reason: `checks failed: ${problems.join(', ')}`, usage };
		}
		return { ok: true, reason: 'ok', data, usage };
	}

	const provider = url.host;
	/** @type {{ code: string, at: string } | null} the provider's last refusal, for GET /llm/status */
	let lastRefusal = null;
	/** @param {ExtractError} error */
	const remember = (error) => {
		if (error.code !== 'EXTRACT_FAILED')
			lastRefusal = { code: error.code, at: new Date().toISOString() };
		return error;
	};

	return {
		models,
		/** Where the text goes, without path, query or credentials: for GET /llm/status. */
		provider,
		/** The provider's last refusal since the bridge started (#417), or null. */
		lastRefusal: () => lastRefusal,
		/**
		 * Another JSON question to the same models, flash first, v4-pro when the
		 * answer does not check out. The caller redacts the content.
		 *
		 * @param {{ system: string, content: string, check: (data: any) => string[] }} task
		 * @returns {Promise<{ data: any, model: string, usage: Usage, ms: number, attempts: Attempt[] }>}
		 */
		async json({ system, content, check }) {
			const key = await getKey();
			/** @type {Attempt[]} */
			const attempts = [];
			/** @type {(keyof typeof REFUSALS | null)[]} */
			const kinds = [];
			const started = Date.now();
			for (const model of models) {
				const t0 = Date.now();
				const r = await ask(model, key, content, { system, check });
				kinds.push(refusalOf(r));
				attempts.push({
					model,
					ok: r.ok,
					reason: r.reason,
					ms: Date.now() - t0,
					...(r.usage ? { usage: r.usage } : {})
				});
				if (r.ok) {
					return { data: r.data, model, usage: r.usage, ms: Date.now() - started, attempts };
				}
				if (ACCOUNT_WIDE.has(String(kinds.at(-1)))) break;
			}
			throw remember(failed(kinds, attempts, provider));
		},
		/**
		 * @param {{ text: string, hints?: Record<string, string> }} input
		 * @returns {Promise<ExtractResult>}
		 */
		async extract({ text, hints = {} }) {
			const options = { terms: config.redactTerms, ownDomains, off: redactionOff(config) };
			const body = redact(text, options);
			const counts = { ...body.counts };
			/** @type {Record<string, string>} */
			const safeHints = {};
			for (const [k, v] of Object.entries(hints)) {
				if (typeof v !== 'string' || !v) continue;
				const r = redact(v.slice(0, 300), options);
				safeHints[k] = r.text;
				for (const kind of /** @type {(keyof typeof counts)[]} */ (Object.keys(counts))) {
					counts[kind] += r.counts[kind];
				}
			}
			if (body.text.trim().length < 20) {
				throw new ExtractError('too little text to read (no text layer?)', 422, 'EXTRACT_NO_TEXT');
			}
			const content = userMessage(body.text, safeHints);
			const key = await getKey();
			/** @type {Attempt[]} */
			const attempts = [];
			/** @type {(keyof typeof REFUSALS | null)[]} */
			const kinds = [];
			const started = Date.now();
			for (const model of models) {
				const t0 = Date.now();
				const r = await ask(model, key, content);
				kinds.push(refusalOf(r));
				attempts.push({
					model,
					ok: r.ok,
					reason: r.reason,
					ms: Date.now() - t0,
					...(r.usage ? { usage: r.usage } : {})
				});
				if (r.ok) {
					const first = attempts[0];
					return {
						extraction: r.data,
						model,
						usage: r.usage,
						ms: Date.now() - started,
						attempts,
						fallback: {
							used: attempts.length > 1,
							reason: attempts.length > 1 ? first.reason : null
						},
						redactions: { ...counts, total: sumCounts(counts) },
						// Exactly what went to the provider as the user message (the system
						// prompt is the fixed SYSTEM above): already redacted.
						sentText: content
					};
				}
				// No credit, a wrong key, no provider: the same for every model.
				if (ACCOUNT_WIDE.has(String(kinds.at(-1)))) break;
			}
			throw remember(failed(kinds, attempts, provider));
		}
	};
}

/**
 * @typedef {{ prompt: number, completion: number, reasoning: number }} Usage
 * @typedef {{ model: string, ok: boolean, reason: string, ms: number, usage?: Usage }} Attempt
 * @typedef {object} ExtractResult
 * @property {any} extraction the checked answer
 * @property {string} model the model whose answer this is
 * @property {Usage} usage that model's tokens
 * @property {number} ms the whole call, every attempt
 * @property {Attempt[]} attempts
 * @property {{ used: boolean, reason: string | null }} fallback whether the second model answered, and why the first did not
 * @property {import('./redact.js').RedactionCounts & { total: number }} redactions places blacked out, by kind
 * @property {string} sentText the redacted user message, as sent
 */

/** @typedef {ReturnType<typeof createExtractor>} Extractor */

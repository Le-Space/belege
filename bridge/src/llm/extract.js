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

import { redact, sumCounts } from './redact.js';

export const MAX_TOKENS = 6000;
export const MAX_TEXT = 30_000;
const TIMEOUT_MS = 180_000;

export const SYSTEM = `You extract bookkeeping data from German or English receipts for a German company (UG).
Answer with one JSON object and nothing else, using exactly these keys (null when not present):
{
  "document_type": "invoice" | "receipt" | "direct_debit_notice" | "payment_reminder" | "credit_card_statement" | "ticket" | "other" | "none",
  "vendor": string,                 // the company that issued the document
  "vendor_vat_id": string | null,
  "invoice_number": string | null,
  "customer_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_or_debit_date": "YYYY-MM-DD" | null,
  "service_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } | null,
  "currency": "EUR" | ...,
  "net": number | null,
  "vat": [ { "rate": number, "amount": number } ],
  "gross": number,                  // the amount that is or was paid; negative for credit notes
  "payment": "direct_debit" | "card" | "paypal" | "bank_transfer" | "paid" | "open" | null,
  "iban_last4": string | null,      // from a redacted IBAN like [IBAN …1234]
  "reverse_charge": boolean,        // no German VAT because the vendor is abroad (§13b UStG)
  "travel": { "from": string, "to": string, "departure": "YYYY-MM-DDTHH:MM" | null } | null,
  "summary": string                 // what was bought, max 12 words, German
}
Amounts are numbers with a dot as decimal separator. Never guess a value that is not in the text.
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

/** @param {unknown} v */
const isDay = (v) => {
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const d = new Date(`${v}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** @param {unknown} v */
const toCents = (v) => Math.round(Number(v) * 100);

/**
 * Whether an answer can be used. Returns the reasons it cannot; empty = fine.
 *
 * @param {any} data
 * @returns {string[]}
 */
export function checkExtraction(data) {
	/** @type {string[]} */
	const problems = [];
	if (!data || typeof data !== 'object' || Array.isArray(data)) return ['not an object'];
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
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (/** @type {any} */ error) {
			return {
				ok: false,
				reason: `unreachable: ${error.name === 'TimeoutError' ? 'timeout' : (error.code ?? error.name)}`
			};
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
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
			reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) || 0
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

	return {
		models,
		/** Where the text goes, without path, query or credentials: for GET /llm/status. */
		provider,
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
			const started = Date.now();
			for (const model of models) {
				const t0 = Date.now();
				const r = await ask(model, key, content, { system, check });
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
				if (r.status === 401) break;
			}
			throw new ExtractError('no model gave a usable answer', 502, 'EXTRACT_FAILED', attempts);
		},
		/**
		 * @param {{ text: string, hints?: Record<string, string> }} input
		 * @returns {Promise<ExtractResult>}
		 */
		async extract({ text, hints = {} }) {
			const options = { terms: config.redactTerms, ownDomains };
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
			const started = Date.now();
			for (const model of models) {
				const t0 = Date.now();
				const r = await ask(model, key, content);
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
				// A wrong key is wrong for every model.
				if (r.status === 401) break;
			}
			throw new ExtractError('no model gave a usable answer', 502, 'EXTRACT_FAILED', attempts);
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

// What the books take and what the AI used: storage in this browser, and
// tokens and their cost from the Verlauf. Pure; the numbers come from the
// records and `navigator.storage.estimate()`, nothing leaves the browser.
//
// Every AI call is an event with its tokens: `extract` (Auslesen),
// `match-assist` (KI-Vorschlag), `transfer-assist` (KI-Vorschlag für eine
// Gegenbuchung), `mail-assist` (Postfach-Suche). Newer events
// carry each call (`calls`: model, prompt, cache hits, completion); older
// ones only a total and the last model, and are counted as an estimate:
// the prompt as not cached, the rest as output, at that model's price.

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} ModelPrice USD per 1 000 000 tokens, at peak time
 * @property {number} input input not cached
 * @property {number} cached input cached
 * @property {number} output
 */

/**
 * @typedef {object} PriceTable
 * @property {string} currency
 * @property {string} checkedOn YYYY-MM-DD: when the prices were read off the provider's page
 * @property {string} source the provider's pricing page
 * @property {number} offPeakFactor off peak, prices are this share of the peak ones
 * @property {Record<string, ModelPrice>} models
 */

/**
 * DeepSeek's published prices (api-docs.deepseek.com/quick_start/pricing),
 * read on 27 September 2026: peak hours are 01–04 and 06–10 UTC, Monday to
 * Friday; off peak costs half. Chinese public holidays, which are off peak
 * too, are not known here: on those days the estimate is too high.
 *
 * @type {PriceTable}
 */
export const DEFAULT_PRICES = Object.freeze({
	currency: 'USD',
	checkedOn: '2026-09-27',
	source: 'https://api-docs.deepseek.com/quick_start/pricing',
	offPeakFactor: 0.5,
	models: {
		'deepseek-flash': { input: 0.3, cached: 0.006, output: 1.2 },
		'deepseek-v4-pro': { input: 1.32, cached: 0.044, output: 3.96 }
	}
});

/** Event kinds that are AI calls, and what the person calls them. */
export const AI_KINDS = /** @type {const} */ ([
	'extract',
	'match-assist',
	'transfer-assist',
	'vendor-assist',
	'mail-assist'
]);

/**
 * Whether a moment is DeepSeek's peak time: 01–04 or 06–10 UTC, Monday to Friday.
 *
 * @param {string} iso
 */
export function isPeak(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return true;
	const day = d.getUTCDay();
	if (day === 0 || day === 6) return false;
	const h = d.getUTCHours();
	return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

/** @param {unknown} v */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The calls of an AI event, each with its tokens; `estimated` when the event
 * predates per-call records.
 *
 * @param {Rec} e
 * @returns {{ model: string, prompt: number, cached: number, completion: number, estimated: boolean }[]}
 */
export function callsOf(e) {
	if (Array.isArray(e.calls) && e.calls.length) {
		return e.calls.map((/** @type {Rec} */ c) => ({
			model: String(c.model ?? e.model ?? ''),
			prompt: n(c.prompt),
			cached: Math.min(n(c.cached), n(c.prompt)),
			completion: n(c.completion),
			estimated: false
		}));
	}
	const total = n(e.tokensTotal);
	if (!total) return [];
	const prompt = Math.min(n(e.tokens?.prompt), total);
	return [
		{
			model: String(e.model ?? ''),
			prompt: prompt || total,
			cached: 0,
			completion: prompt ? total - prompt : 0,
			estimated: true
		}
	];
}

/**
 * What one call cost, in the table's currency; null for a model without a price.
 *
 * @param {{ model: string, prompt: number, cached: number, completion: number }} call
 * @param {string} at ISO time of the call
 * @param {PriceTable} prices
 */
export function costOf(call, at, prices) {
	const p = prices.models[call.model];
	if (!p) return null;
	const factor = isPeak(at) ? 1 : prices.offPeakFactor;
	const cost =
		((call.prompt - call.cached) * p.input + call.cached * p.cached + call.completion * p.output) /
		1e6;
	return cost * factor;
}

/**
 * @typedef {object} Usage
 * @property {number} calls
 * @property {number} tokens
 * @property {number} cost in the table's currency, of the calls with a price
 * @property {boolean} estimated some calls counted from totals only
 * @property {string[]} unpriced models without a price
 * @property {Record<string, { calls: number, tokens: number, cost: number }>} byKind
 */

/**
 * AI usage since a moment.
 *
 * @param {Rec[]} events
 * @param {string} since ISO time
 * @param {PriceTable} prices
 * @returns {Usage}
 */
export function aiUsage(events, since, prices) {
	/** @type {Usage} */
	const out = { calls: 0, tokens: 0, cost: 0, estimated: false, unpriced: [], byKind: {} };
	for (const e of events) {
		if (!AI_KINDS.includes(e.kind) || String(e.at ?? '') < since) continue;
		const kind = (out.byKind[e.kind] ??= { calls: 0, tokens: 0, cost: 0 });
		for (const c of callsOf(e)) {
			const tokens = c.prompt + c.completion;
			const cost = costOf(c, String(e.at), prices);
			out.calls++;
			out.tokens += tokens;
			kind.calls++;
			kind.tokens += tokens;
			if (c.estimated) out.estimated = true;
			if (cost === null) {
				if (c.model && !out.unpriced.includes(c.model)) out.unpriced.push(c.model);
			} else {
				out.cost += cost;
				kind.cost += cost;
			}
		}
	}
	return out;
}

/**
 * Tokens per receipt read: the Auslesen calls over the receipts read successfully.
 *
 * @param {Rec[]} events
 * @param {string} since ISO time
 */
export function tokensPerReceipt(events, since) {
	let tokens = 0;
	let read = 0;
	for (const e of events) {
		if (e.kind !== 'extract' || String(e.at ?? '') < since) continue;
		for (const c of callsOf(e)) tokens += c.prompt + c.completion;
		if (e.ok) read++;
	}
	return read ? Math.round(tokens / read) : null;
}

/**
 * The start of today, of the last seven days and of this month, in local time, as ISO.
 *
 * @param {Date} now
 */
export function periods(now) {
	const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return {
		today: day.toISOString(),
		week: new Date(day.getTime() - 6 * 864e5).toISOString(),
		month: new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
	};
}

/**
 * What the books hold: records per collection and the receipt files' bytes.
 * Deleted receipts count: their sealed files stay in the blockstore.
 *
 * @param {{ transactions: Rec[], receipts: Rec[], matches: Rec[], questions: Rec[], events: Rec[], partners?: Rec[], accounts?: Rec[] }} books
 */
export function booksStats(books) {
	const files = books.receipts.filter((r) => r.fileCid);
	return {
		counts: {
			transactions: books.transactions.length,
			receipts: books.receipts.length,
			matches: books.matches.length,
			questions: books.questions.length,
			events: books.events.length,
			partners: books.partners?.length ?? 0,
			accounts: books.accounts?.length ?? 0
		},
		files: files.length,
		fileBytes: files.reduce((sum, r) => sum + n(r.size), 0)
	};
}

/**
 * The price table as kept in the settings (`aiPrices`), cleaned; the default when none.
 *
 * @param {unknown} value
 * @returns {PriceTable}
 */
export function cleanPrices(value) {
	const v = /** @type {any} */ (value);
	if (!v || typeof v !== 'object' || !v.models || typeof v.models !== 'object')
		return DEFAULT_PRICES;
	/** @type {Record<string, ModelPrice>} */
	const models = {};
	for (const [name, p] of Object.entries(v.models)) {
		if (!/^[\w.:-]{1,80}$/.test(name) || !p || typeof p !== 'object') continue;
		const q = /** @type {any} */ (p);
		const nums = [q.input, q.cached, q.output].map(Number);
		if (nums.every((x) => Number.isFinite(x) && x >= 0 && x < 1000)) {
			models[name] = { input: nums[0], cached: nums[1], output: nums[2] };
		}
	}
	const factor = Number(v.offPeakFactor);
	return {
		currency: /^[A-Z]{3}$/.test(String(v.currency)) ? String(v.currency) : 'USD',
		checkedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(v.checkedOn)) ? String(v.checkedOn) : '',
		source: typeof v.source === 'string' ? v.source.slice(0, 300) : '',
		offPeakFactor: Number.isFinite(factor) && factor > 0 && factor <= 1 ? factor : 1,
		models
	};
}

/**
 * The calls of a bridge answer as a Verlauf event keeps them: model and tokens
 * per call (a failed first try is billed too), for the cost (`callsOf`).
 *
 * @param {{ model?: unknown, usage?: Rec }[] | undefined} list
 * @returns {{ model: string, prompt: number, cached: number, completion: number }[]}
 */
export function eventCalls(list) {
	return (list ?? []).map((c) => ({
		model: String(c?.model ?? ''),
		prompt: n(c?.usage?.prompt),
		cached: n(c?.usage?.cached),
		completion: n(c?.usage?.completion)
	}));
}

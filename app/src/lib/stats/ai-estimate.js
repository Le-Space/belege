// What one press of an AI button (✦) will roughly take: tokens in and out,
// and what that costs at the provider the bridge uses. Pure.
//
// The tokens come from the Verlauf: the average of the last calls of the same
// kind (an event is one press; a retry inside it counts). Without any, a rough
// figure from the code below. The price comes from the provider's published
// table, bundled here: DeepSeek's (usage.js, or the one kept in the settings)
// and LibertAI's. A model on the bridge's own computer costs nothing; a hosted
// bridge paid from a Le Space plan has it included.
//
// Informational only (#566, decision 2026-11-15): nothing here is billed, and
// nothing billed is ever computed from it.

import { DEFAULT_PRICES, callsOf, costOf } from './usage.js';

/** @typedef {import('./usage.js').PriceTable} PriceTable */

/**
 * LibertAI's published prices for its text models, from the Aleph aggregate
 * of 0x238224C744F4b90b4494516e074D2676ECfC6803, key LTAI_PRICING, read on
 * 15 November 2026. No off-peak discount; a model without a cached price
 * counts cached input at the full input price.
 *
 * @type {PriceTable}
 */
export const LIBERTAI_PRICES = Object.freeze({
	currency: 'USD',
	checkedOn: '2026-11-15',
	source: 'aleph:0x238224C744F4b90b4494516e074D2676ECfC6803/LTAI_PRICING',
	offPeakFactor: 1,
	models: {
		'qwen3.6-35b-a3b': { input: 0.15, cached: 0.15, output: 0.5 },
		'qwen3.8-27b': { input: 0.15, cached: 0.15, output: 0.5 },
		'qwen3.8-27b-tee': { input: 0.15, cached: 0.15, output: 0.5 },
		'deepseek-v4.1-flash-1017': { input: 0.25, cached: 0.05, output: 1.75 },
		'glm-5.3': { input: 1.4, cached: 0.26, output: 4.4 },
		'glm-5.3-flash': { input: 0.15, cached: 0.03, output: 0.5 }
	}
});

/**
 * Tokens of one press when the Verlauf has none of that kind yet: rough
 * figures for the prompts the bridge builds (bridge/src/llm/*), the
 * reasoning of the DeepSeek models included in the output.
 */
export const FALLBACK_TOKENS = Object.freeze({
	extract: { prompt: 2500, completion: 700 },
	'match-assist': { prompt: 3000, completion: 800 },
	'transfer-assist': { prompt: 2000, completion: 600 },
	'vendor-assist': { prompt: 2500, completion: 800 },
	'travel-assist': { prompt: 3500, completion: 1000 },
	'booking-assist': { prompt: 1800, completion: 600 },
	'mail-assist': { prompt: 2000, completion: 600 }
});

/** How many of the latest presses the average is taken over. */
export const SAMPLE = 20;

/**
 * The average press of a kind over its latest events: tokens in (and how many
 * of them were cached), out, and the model of the latest. Null when there is
 * none with tokens.
 *
 * @param {Record<string, any>[]} events
 * @param {string} kind
 * @param {number} [sample]
 */
export function measuredAverage(events, kind, sample = SAMPLE) {
	const latest = events
		.filter((e) => e?.kind === kind)
		.map((e) => ({ at: String(e.at ?? ''), calls: callsOf(e) }))
		.filter((e) => e.calls.length)
		.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
		.slice(0, sample);
	if (!latest.length) return null;
	let prompt = 0;
	let cached = 0;
	let completion = 0;
	for (const e of latest) {
		for (const c of e.calls) {
			prompt += c.prompt;
			cached += c.cached;
			completion += c.completion;
		}
	}
	const k = latest.length;
	return {
		prompt: Math.round(prompt / k),
		cached: Math.round(cached / k),
		completion: Math.round(completion / k),
		samples: k,
		model: latest[0].calls.at(-1)?.model ?? ''
	};
}

/**
 * Which price table the bridge's model goes by: by the host it asks
 * (`/llm/status` provider), else by the model's name; 'local' for a model on
 * the bridge's own computer; null when not known.
 *
 * @param {{ provider?: string | null, model?: string | null, local?: boolean } | null | undefined} llm
 * @returns {'deepseek' | 'libertai' | 'local' | null}
 */
export function providerOf(llm) {
	if (!llm) return null;
	if (llm.local) return 'local';
	const host = String(llm.provider ?? '').toLowerCase();
	if (/(^|\.)deepseek\.com(:\d+)?$/.test(host)) return 'deepseek';
	if (/(^|\.)libertai\.io(:\d+)?$/.test(host)) return 'libertai';
	if (/:(11434|1234)$/.test(host)) return 'local';
	// A known model by name, even behind a proxy on this machine.
	const model = String(llm.model ?? '');
	if (model in LIBERTAI_PRICES.models) return 'libertai';
	if (model in DEFAULT_PRICES.models) return 'deepseek';
	if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return 'local';
	return null;
}

/**
 * @typedef {object} CallEstimate
 * @property {number} prompt tokens in
 * @property {number} completion tokens out
 * @property {number} samples presses measured; 0 when the figures are the code's
 * @property {'priced' | 'local' | 'included' | 'unknown'} mode
 *   priced: `cost` holds the price; local: the model runs on the bridge's
 *   computer (0); included: in the Le Space plan; unknown: no price for this model
 * @property {number | null} cost in `currency`, only when priced
 * @property {string} currency
 * @property {string} model the model priced, or ''
 */

/**
 * What one press of `kind` will roughly take.
 *
 * @param {object} p
 * @param {string} p.kind an AI event kind (usage.js AI_KINDS)
 * @param {Record<string, any>[]} [p.events] the Verlauf
 * @param {{ provider?: string | null, model?: string | null, local?: boolean } | null} [p.llm] the bridge's model (`/llm/status`)
 * @param {boolean} [p.included] a hosted bridge paid from a Le Space plan
 * @param {PriceTable} [p.deepseek] DeepSeek's table (the one kept in the settings, else the bundled one)
 * @param {string} [p.at] ISO time, for DeepSeek's off-peak price
 * @returns {CallEstimate}
 */
export function estimateCall({
	kind,
	events = [],
	llm = null,
	included = false,
	deepseek = DEFAULT_PRICES,
	at = new Date().toISOString()
}) {
	const measured = measuredAverage(events, kind);
	const fallback = /** @type {Record<string, { prompt: number, completion: number }>} */ (
		FALLBACK_TOKENS
	)[kind] ?? { prompt: 2000, completion: 600 };
	const tokens = measured ?? { ...fallback, cached: 0, samples: 0, model: '' };
	/** @type {CallEstimate} */
	const out = {
		prompt: tokens.prompt,
		completion: tokens.completion,
		samples: tokens.samples,
		mode: 'unknown',
		cost: null,
		currency: 'USD',
		model: ''
	};
	if (included) return { ...out, mode: 'included' };
	const provider = providerOf(llm ?? (measured ? { model: measured.model } : null));
	if (provider === 'local') return { ...out, mode: 'local', cost: 0 };
	const table =
		provider === 'libertai' ? LIBERTAI_PRICES : provider === 'deepseek' ? deepseek : null;
	if (!table) return out;
	// The bridge's model first; the measured one when the bridge did not say.
	const model = [llm?.model, measured?.model].find((m) => m && table.models[m]) ?? '';
	if (!model) return out;
	const cost = costOf({ ...tokens, model }, at, table);
	if (cost === null) return out;
	return { ...out, mode: 'priced', cost, currency: table.currency, model };
}

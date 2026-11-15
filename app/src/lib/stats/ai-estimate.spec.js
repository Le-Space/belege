// The estimate beside an AI button: measured average, fallback, provider and
// price, local and included. Made-up numbers only.
import { describe, expect, it } from 'vitest';

import {
	FALLBACK_TOKENS,
	LIBERTAI_PRICES,
	estimateCall,
	measuredAverage,
	providerOf
} from './ai-estimate.js';

const PEAK = '2026-09-28T02:30:00Z'; // Monday, DeepSeek's peak
const OFF = '2026-09-27T12:00:00Z'; // Sunday

/** @param {string} at @param {number} prompt @param {number} completion @param {string} [model] */
const ev = (at, prompt, completion, model = 'deepseek-flash', kind = 'booking-assist') => ({
	kind,
	at,
	calls: [{ model, prompt, cached: 0, completion }]
});

describe('measured average', () => {
	it('averages the latest presses of the kind, a retry counted in its press', () => {
		const events = [
			ev('2026-10-01T10:00:00Z', 1000, 200),
			ev('2026-10-02T10:00:00Z', 3000, 400),
			{ kind: 'match-assist', at: '2026-10-03T10:00:00Z', calls: [{ prompt: 9, completion: 9 }] },
			{
				kind: 'booking-assist',
				at: '2026-10-04T10:00:00Z',
				calls: [
					{ model: 'deepseek-flash', prompt: 500, completion: 100 },
					{ model: 'deepseek-v4-pro', prompt: 1500, completion: 300 }
				]
			}
		];
		expect(measuredAverage(events, 'booking-assist')).toEqual({
			prompt: 2000,
			cached: 0,
			completion: 333,
			samples: 3,
			model: 'deepseek-v4-pro'
		});
	});

	it('takes only the latest ones', () => {
		const events = [ev('2026-10-01T10:00:00Z', 9000, 9000), ev('2026-10-02T10:00:00Z', 100, 10)];
		expect(measuredAverage(events, 'booking-assist', 1)?.prompt).toBe(100);
	});

	it('is null without a press that has tokens', () => {
		expect(measuredAverage([{ kind: 'booking-assist', at: 'x' }], 'booking-assist')).toBeNull();
		expect(measuredAverage([], 'extract')).toBeNull();
	});
});

describe('provider', () => {
	it('by the host the bridge asks', () => {
		expect(providerOf({ provider: 'api.deepseek.com' })).toBe('deepseek');
		expect(providerOf({ provider: 'api.libertai.io' })).toBe('libertai');
		expect(providerOf({ provider: 'localhost:11434' })).toBe('local');
		expect(providerOf({ provider: 'models.example.com', local: true })).toBe('local');
		expect(providerOf({ provider: '127.0.0.1:8080', model: 'llama-test' })).toBe('local');
		// A proxy on this machine to a paid model is priced as that model.
		expect(providerOf({ provider: '127.0.0.1:8080', model: 'deepseek-flash' })).toBe('deepseek');
	});

	it('by the model when the host says nothing', () => {
		expect(providerOf({ model: 'qwen3.8-27b-tee' })).toBe('libertai');
		expect(providerOf({ model: 'deepseek-flash' })).toBe('deepseek');
		expect(providerOf({ provider: 'models.example.com', model: 'other' })).toBeNull();
		expect(providerOf(null)).toBeNull();
	});
});

describe('estimate of one press', () => {
	it('falls back to the code’s figures without measurements', () => {
		const e = estimateCall({
			kind: 'travel-assist',
			llm: { provider: 'api.deepseek.com', model: 'deepseek-flash' },
			at: PEAK
		});
		expect(e.samples).toBe(0);
		expect(e.prompt).toBe(FALLBACK_TOKENS['travel-assist'].prompt);
		expect(e.completion).toBe(FALLBACK_TOKENS['travel-assist'].completion);
		// 3500 × 0.3 + 1000 × 1.2 per million
		expect(e.mode).toBe('priced');
		expect(e.cost).toBeCloseTo(0.00225, 8);
	});

	it('prices the measured average at DeepSeek, half off peak', () => {
		const events = [ev('2026-10-01T10:00:00Z', 1000, 500)];
		const llm = { provider: 'api.deepseek.com', model: 'deepseek-flash' };
		const peak = estimateCall({ kind: 'booking-assist', events, llm, at: PEAK });
		const off = estimateCall({ kind: 'booking-assist', events, llm, at: OFF });
		expect(peak.cost).toBeCloseTo((1000 * 0.3 + 500 * 1.2) / 1e6, 10);
		expect(off.cost).toBeCloseTo(/** @type {number} */ (peak.cost) / 2, 10);
		expect(peak.samples).toBe(1);
	});

	it('prices LibertAI from its bundled table, no off-peak', () => {
		const llm = { provider: 'api.libertai.io', model: 'qwen3.8-27b-tee' };
		const e = estimateCall({
			kind: 'extract',
			events: [ev(OFF, 2000, 1000, 'qwen3.8-27b-tee', 'extract')],
			llm,
			at: OFF
		});
		const p = LIBERTAI_PRICES.models['qwen3.8-27b-tee'];
		expect(e.cost).toBeCloseTo((2000 * p.input + 1000 * p.output) / 1e6, 10);
		expect(e.model).toBe('qwen3.8-27b-tee');
	});

	it('costs nothing on the bridge’s own computer, tokens still shown', () => {
		const e = estimateCall({
			kind: 'mail-assist',
			llm: { provider: 'localhost:11434', model: 'llama-test' }
		});
		expect(e).toMatchObject({ mode: 'local', cost: 0, prompt: 2000 });
	});

	it('is included in a Le Space plan', () => {
		const e = estimateCall({
			kind: 'vendor-assist',
			llm: { provider: 'api.libertai.io', model: 'qwen3.8-27b-tee' },
			included: true
		});
		expect(e).toMatchObject({ mode: 'included', cost: null });
		expect(e.prompt).toBeGreaterThan(0);
	});

	it('says no price for a model no table knows', () => {
		const e = estimateCall({
			kind: 'match-assist',
			llm: { provider: 'models.example.com', model: 'other' }
		});
		expect(e).toMatchObject({ mode: 'unknown', cost: null });
	});

	it('goes by the measured model when the bridge did not say', () => {
		const e = estimateCall({
			kind: 'booking-assist',
			events: [ev(PEAK, 1000, 0, 'deepseek-v4-pro')],
			at: PEAK
		});
		expect(e.mode).toBe('priced');
		expect(e.cost).toBeCloseTo((1000 * 1.32) / 1e6, 10);
	});

	it('uses the DeepSeek table kept in the settings', () => {
		const deepseek = {
			currency: 'EUR',
			checkedOn: '',
			source: '',
			offPeakFactor: 1,
			models: { 'deepseek-flash': { input: 1, cached: 1, output: 1 } }
		};
		const e = estimateCall({
			kind: 'booking-assist',
			events: [ev(PEAK, 1000, 1000)],
			llm: { provider: 'api.deepseek.com', model: 'deepseek-flash' },
			deepseek,
			at: PEAK
		});
		expect(e).toMatchObject({ currency: 'EUR' });
		expect(e.cost).toBeCloseTo(0.002, 10);
	});
});

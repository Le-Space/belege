// Exchange rates: which source answers, what "the rate of a day" is, and the
// /rates route. The sources are faked; nothing goes to the network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateService, invert, toDecimal, RateError } from '../src/rates.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing, hashToken } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { request } from './support/http.js';

const NOW = () => new Date('2026-09-26T10:00:00Z');
const DAY_START = Date.parse('2026-09-01T00:00:00Z') / 1000;

/**
 * A fetch that answers from a table of URL prefixes and records what was asked.
 *
 * @param {Record<string, unknown>} answers prefix → JSON body, or a number for an HTTP status
 */
function fakeFetch(answers) {
	/** @type {string[]} */
	const calls = [];
	/** @type {typeof fetch} */
	const f = async (input) => {
		const url = String(input);
		calls.push(url);
		const prefix = Object.keys(answers).find((p) => url.startsWith(p));
		const body = prefix === undefined ? 404 : answers[prefix];
		if (typeof body === 'number') return new Response('{}', { status: body });
		return new Response(JSON.stringify(body), { status: 200 });
	};
	return { fetch: f, calls };
}

const coingecko = (/** @type {number} */ eur, /** @type {number} */ usd) => ({
	market_data: { current_price: { eur, usd } }
});

describe('decimal helpers', () => {
	test('toDecimal writes plain decimals, also for tiny numbers', () => {
		assert.equal(toDecimal(60123.45), '60123.45');
		assert.equal(toDecimal('0.5'), '0.5');
		assert.equal(toDecimal(1.2e-7), '0.00000012');
		assert.equal(toDecimal(0), null);
		assert.equal(toDecimal(-1), null);
		assert.equal(toDecimal('abc'), null);
	});

	test('invert gives 12 decimals, rounded', () => {
		assert.equal(invert('1.25'), '0.8');
		assert.equal(invert('1.1'), '0.909090909091');
		assert.equal(invert('4'), '0.25');
	});
});

describe('rate service', () => {
	test('a crypto asset: CoinGecko at 00:00 UTC of the day', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/bitcoin/history': coingecko(54321.5, 60000.25)
		});
		const rates = createRateService({ fetch, now: NOW });
		const rate = await rates.rate('BTC', '2026-09-01');
		assert.deepEqual(rate, {
			asset: 'BTC',
			date: '2026-09-01',
			currency: 'EUR',
			rate: '54321.5',
			usdRate: '60000.25',
			source: 'coingecko',
			at: '2026-09-01T00:00:00Z'
		});
		assert.match(calls[0], /date=01-09-2026/);
	});

	test('the CoinGecko key from the keychain goes into the header, not the URL', async () => {
		/** @type {Headers | undefined} */ let seen;
		const rates = createRateService({
			now: NOW,
			coingeckoKey: async () => 'test-key',
			fetch: async (input, init) => {
				seen = new Headers(init?.headers);
				assert.doesNotMatch(String(input), /test-key/);
				return new Response(JSON.stringify(coingecko(1, 1)), { status: 200 });
			}
		});
		await rates.rate('NYM', '2026-09-01');
		assert.equal(seen?.get('x-cg-demo-api-key'), 'test-key');
	});

	test('CoinGecko fails: Kraken, the open of the daily candle', async () => {
		const { fetch } = fakeFetch({
			'https://api.coingecko.com/': 429,
			'https://api.kraken.com/0/public/OHLC': {
				error: [],
				result: {
					XXBTZEUR: [
						[DAY_START - 86400, '50000.0', '0', '0', '51000.0', '0', '0', 0],
						[DAY_START, '51000.1', '0', '0', '52000.0', '0', '0', 0]
					],
					last: DAY_START
				}
			}
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('BTC', '2026-09-01');
		assert.equal(rate.rate, '51000.1');
		assert.equal(rate.source, 'kraken');
		assert.equal(rate.usdRate, null);
	});

	test('USD: the ECB reference rate, inverted, the last one on or before the day', async () => {
		const { fetch } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [1.25], 1: [1.1] } } } }],
				structure: {
					dimensions: { observation: [{ values: [{ id: '2026-08-28' }, { id: '2026-08-31' }] }] }
				}
			}
		});
		// 2026-08-30 is a Sunday: the Friday rate counts.
		const rate = await createRateService({ fetch, now: NOW }).rate('USD', '2026-08-30');
		assert.equal(rate.rate, '0.8');
		assert.equal(rate.source, 'ecb');
		assert.equal(rate.at, '2026-08-28T00:00:00Z');
	});

	test('prefer kraken: Kraken first, CoinGecko only as the fallback', async () => {
		const kraken = {
			error: [],
			result: { XXBTZEUR: [[DAY_START, '51000.1', '0', '0', '0', '0', '0', 0]], last: DAY_START }
		};
		const first = fakeFetch({
			'https://api.coingecko.com/': coingecko(54321.5, 60000.25),
			'https://api.kraken.com/0/public/OHLC': kraken
		});
		const rate = await createRateService({ fetch: first.fetch, now: NOW }).rate(
			'BTC',
			'2026-09-01',
			{
				prefer: 'kraken'
			}
		);
		assert.equal(rate.source, 'kraken');
		assert.equal(rate.rate, '51000.1');
		assert.equal(first.calls.length, 1);
		assert.match(first.calls[0], /pair=XBTEUR/);

		const fallback = fakeFetch({
			'https://api.coingecko.com/': coingecko(54321.5, 60000.25),
			'https://api.kraken.com/': 503
		});
		const second = await createRateService({ fetch: fallback.fetch, now: NOW }).rate(
			'BTC',
			'2026-09-01',
			{ prefer: 'kraken' }
		);
		assert.equal(second.source, 'coingecko');
	});

	test('prefer kraken prices an asset Belege does not list, by its EUR pair', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.kraken.com/0/public/OHLC': {
				error: [],
				result: { DOTEUR: [[DAY_START, '3.21', '0', '0', '0', '0', '0', 0]], last: DAY_START }
			}
		});
		const rates = createRateService({ fetch, now: NOW });
		assert.equal((await rates.rate('DOT', '2026-09-01', { prefer: 'kraken' })).rate, '3.21');
		assert.match(calls[0], /pair=DOTEUR/);
		await assert.rejects(
			rates.rate('DOT', '2026-09-01'),
			(e) => e instanceof RateError && e.status === 400
		);
	});

	test('no source answers: 502', async () => {
		const { fetch } = fakeFetch({});
		await assert.rejects(
			createRateService({ fetch, now: NOW }).rate('BTC', '2026-09-01'),
			(e) => e instanceof RateError && e.status === 502
		);
	});

	test('an unknown asset, a malformed or a future day: 400, nothing fetched', async () => {
		const { fetch, calls } = fakeFetch({});
		const rates = createRateService({ fetch, now: NOW });
		for (const [asset, date] of [
			['DOGE', '2026-09-01'],
			['BTC', '2026-9-1'],
			['BTC', '2026-02-30x'],
			['BTC', '2026-09-27'],
			['toString', '2026-09-01']
		]) {
			await assert.rejects(
				rates.rate(asset, date),
				(e) => e instanceof RateError && e.status === 400
			);
		}
		assert.equal(calls.length, 0);
	});

	test('a past day is asked once; today is asked again', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.coingecko.com/': coingecko(2, 2)
		});
		const rates = createRateService({ fetch, now: NOW });
		await rates.rate('ETH', '2026-09-01');
		await rates.rate('ETH', '2026-09-01');
		assert.equal(calls.length, 1);
		await rates.rate('ETH', '2026-09-26');
		await rates.rate('ETH', '2026-09-26');
		assert.equal(calls.length, 3);
	});
});

describe('Kraken: one daily series per pair', () => {
	const day = (/** @type {string} */ d) => Date.parse(`${d}T00:00:00Z`) / 1000;
	const iso = (/** @type {number} */ t) => new Date(t * 1000).toISOString().slice(0, 10);
	// Kraken's last 720 daily candles up to today (NOW), made-up opens: 40000 + the day's index.
	const today = day('2026-09-26');
	const candles = Array.from({ length: 720 }, (_, i) => {
		const t = today - (719 - i) * 86400;
		return [t, `${40000 + i}.5`, '0', '0', '0', '0', '0', 0];
	});
	const openOf = (/** @type {string} */ d) => candles.find((c) => c[0] === day(d))?.[1];

	/**
	 * Kraken as it behaves: CoinGecko refuses days older than 365 (401), and
	 * Kraken answers "too many requests" (in a 200) after `allowed` calls in a row.
	 *
	 * @param {{ allowed?: number, throttleFirst?: number }} [options]
	 */
	function throttlingKraken({ allowed = 1, throttleFirst = 0 } = {}) {
		/** @type {string[]} */
		const calls = [];
		let kraken = 0;
		/** @type {typeof fetch} */
		const f = async (input) => {
			const url = String(input);
			calls.push(url);
			if (url.startsWith('https://api.coingecko.com/')) {
				return new Response(JSON.stringify({ error: { status: { error_code: 10012 } } }), {
					status: 401
				});
			}
			kraken++;
			if (kraken <= throttleFirst || kraken > throttleFirst + allowed) {
				return new Response(JSON.stringify({ error: ['EGeneral:Too many requests'] }), {
					status: 200
				});
			}
			const since = Number(new URL(url).searchParams.get('since') ?? 0);
			return new Response(
				JSON.stringify({
					error: [],
					result: { XXBTZEUR: candles.filter((c) => c[0] > since), last: today }
				}),
				{ status: 200 }
			);
		};
		return { fetch: f, calls, krakenCalls: () => kraken };
	}

	test('CoinGecko refuses a day older than a year (401): Kraken answers', async () => {
		const { fetch, calls } = throttlingKraken();
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		const rate = await rates.rate('BTC', '2025-08-25');
		assert.equal(rate.source, 'kraken');
		assert.equal(rate.rate, openOf('2025-08-25'));
		assert.equal(rate.at, '2025-08-25T00:00:00Z');
		assert.match(calls[0], /api\.coingecko\.com/);
		assert.match(calls[1], /api\.kraken\.com\/0\/public\/OHLC\?pair=XBTEUR&interval=1440/);
	});

	test('many BTC days older than a year are priced from one Kraken call', async () => {
		const { fetch, krakenCalls } = throttlingKraken({ allowed: 1 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		const days = Array.from({ length: 60 }, (_, i) => iso(day('2025-07-01') + i * 86400));
		// As a wallet sync asks: one day after the other, and a few at once.
		for (const d of days.slice(0, 40)) {
			assert.equal((await rates.rate('BTC', d)).rate, openOf(d), d);
		}
		const together = await Promise.all(days.slice(40).map((d) => rates.rate('BTC', d)));
		assert.deepEqual(
			together.map((r) => r.rate),
			days.slice(40).map(openOf)
		);
		assert.equal(krakenCalls(), 1);
	});

	test('days asked at once before the first answer share one Kraken call', async () => {
		const { fetch, krakenCalls } = throttlingKraken({ allowed: 1 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		const days = ['2025-01-02', '2025-03-04', '2025-05-06', '2025-07-08'];
		const found = await Promise.all(days.map((d) => rates.rate('BTC', d, { prefer: 'kraken' })));
		assert.deepEqual(
			found.map((r) => r.rate),
			days.map(openOf)
		);
		assert.equal(krakenCalls(), 1);
	});

	test('"too many requests" is asked again after a wait, longer each time', async () => {
		const { fetch, krakenCalls } = throttlingKraken({ throttleFirst: 2 });
		/** @type {number[]} */
		const waited = [];
		const rates = createRateService({
			fetch,
			now: NOW,
			delay: async (ms) => {
				waited.push(ms);
			}
		});
		assert.equal((await rates.rate('BTC', '2025-08-25')).rate, openOf('2025-08-25'));
		assert.equal(krakenCalls(), 3);
		assert.equal(waited.length, 2);
		assert.ok(waited[1] > waited[0]);
	});

	test('Kraken throttles for good: no rate, and the next ask tries again', async () => {
		const { fetch, krakenCalls } = throttlingKraken({ allowed: 0 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		await assert.rejects(
			rates.rate('BTC', '2025-08-25'),
			(e) => e instanceof RateError && e.status === 502
		);
		const tries = krakenCalls();
		assert.ok(tries > 1 && tries < 10, `${tries} calls`);
		await assert.rejects(rates.rate('BTC', '2025-08-26'));
		assert.equal(krakenCalls(), 2 * tries);
	});

	test('a day before the series has no Kraken rate, without asking again', async () => {
		const { fetch, krakenCalls } = throttlingKraken({ allowed: 1 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		await rates.rate('BTC', '2025-08-25');
		await assert.rejects(rates.rate('BTC', '2024-01-01'), /no rate found/);
		assert.equal(krakenCalls(), 1);
	});

	test("today is not kept: today's rate asks again, past days do not", async () => {
		const { fetch, krakenCalls } = throttlingKraken({ allowed: 10 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		assert.equal((await rates.rate('BTC', '2026-09-26')).rate, openOf('2026-09-26'));
		await rates.rate('BTC', '2026-09-26');
		assert.equal(krakenCalls(), 2);
		await rates.rate('BTC', '2026-09-25');
		assert.equal(krakenCalls(), 2);
	});
});

describe('GET /rates', () => {
	test('needs the token, checks the asset, answers with the rate', async () => {
		const token = 'paired-token-for-the-rates-test';
		const { fetch } = fakeFetch({ 'https://api.coingecko.com/': coingecko(3.5, 4) });
		const bridge = createBridgeServer({
			config: { ...defaultConfig(), appOrigins: [] },
			pairing: createPairing({
				getHashes: () => [{ hash: hashToken(token), createdAt: '2026-09-01T00:00:00Z' }],
				saveHashes: async () => {}
			}),
			hibiscus: null,
			rates: createRateService({ fetch, now: NOW })
		});
		const { port } = await bridge.listen({ port: 0 });
		try {
			const auth = { authorization: `Bearer ${token}` };
			assert.equal((await request(port, '/rates?asset=AKT&date=2026-09-01')).status, 401);
			assert.equal(
				(await request(port, '/rates?asset=akt;rm&date=2026-09-01', { headers: auth })).status,
				400
			);
			const ok = await request(port, '/rates?asset=AKT&date=2026-09-01', { headers: auth });
			assert.equal(ok.status, 200);
			assert.equal(ok.json.rate, '3.5');
			assert.equal(ok.json.source, 'coingecko');
			const bad = await request(port, '/rates?asset=AKT&date=2026-09-01&prefer=binance', {
				headers: auth
			});
			assert.equal(bad.status, 400);
			const future = await request(port, '/rates?asset=AKT&date=2027-01-01', { headers: auth });
			assert.equal(future.status, 400);
		} finally {
			await new Promise((resolve) => bridge.server.close(resolve));
		}
	});
});

test('a token not in the list: its rate by its contract, whatever it calls itself', async () => {
	const contract = `0x${'5e'.repeat(20)}`;
	/** @type {string[]} */
	const asked = [];
	const service = createRateService({
		now: () => new Date('2026-09-27T12:00:00Z'),
		fetch: /** @type {any} */ (
			async (/** @type {string} */ url) => {
				asked.push(url);
				if (url.includes(`/coins/ethereum/contract/${contract}`)) {
					return { ok: true, json: async () => ({ id: 'xyz-token' }) };
				}
				if (url.includes('/coins/xyz-token/history')) {
					return {
						ok: true,
						json: async () => ({ market_data: { current_price: { eur: 0.0042, usd: 0.0046 } } })
					};
				}
				return { ok: false, json: async () => ({}) };
			}
		)
	});
	const r = await service.rate('USDC', '2026-07-19', { contract, chain: 'ethereum' });
	assert.equal(r.rate, '0.0042');
	assert.equal(r.source, 'coingecko');
	// The symbol said USDC; only the contract was asked, never the listed coin.
	assert.equal(
		asked.some((u) => u.includes('usd-coin')),
		false
	);
	await assert.rejects(service.rate('XYZ', '2026-07-19', { contract, chain: 'nyx' }), /EVM chain/);
});

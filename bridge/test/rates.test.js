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
			const future = await request(port, '/rates?asset=AKT&date=2027-01-01', { headers: auth });
			assert.equal(future.status, 400);
		} finally {
			await new Promise((resolve) => bridge.server.close(resolve));
		}
	});
});

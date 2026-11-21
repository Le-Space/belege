// The bridge's /rates route: the token, the checks of asset and day, the
// answer. The rate itself is @le-space/rates (its own tests are there); the
// source is faked, nothing goes to the network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateService } from '@le-space/rates';
import { createBridgeServer } from '../src/server.js';
import { createPairing, hashToken } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { request } from './support/http.js';

const NOW = () => new Date('2026-09-26T10:00:00Z');

/** @param {Record<string, unknown>} answers prefix → JSON body, or a number for an HTTP status */
function fakeFetch(answers) {
	/** @type {typeof fetch} */
	const f = async (input) => {
		const url = String(input);
		const prefix = Object.keys(answers).find((p) => url.startsWith(p));
		const body = prefix === undefined ? 404 : answers[prefix];
		if (typeof body === 'number') return new Response('{}', { status: body });
		return new Response(JSON.stringify(body), { status: 200 });
	};
	return { fetch: f };
}

const coingecko = (/** @type {number} */ eur, /** @type {number} */ usd) => ({
	market_data: { current_price: { eur, usd } }
});

describe('GET /rates', () => {
	test('needs the token, checks the asset, answers with the rate', async () => {
		const token = 'paired-token-for-the-rates-test';
		const { fetch } = fakeFetch({ 'https://api.coingecko.com/': coingecko(3.5, 4) });
		const bridge = createBridgeServer({
			legacyRoutes: true,
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

	test('a period of days: the token, the checks, one answer for all days', async () => {
		const token = 'paired-token-for-the-rates-test';
		const at = (/** @type {string} */ d) => Date.parse(`${d}T00:00:00Z`);
		/** @type {string[]} */
		const asked = [];
		/** @type {typeof fetch} */
		const fetch = async (input) => {
			const url = String(input);
			asked.push(url);
			if (!url.includes('/coins/akash-network/market_chart/range')) {
				return new Response('{}', { status: 404 });
			}
			const usd = url.includes('vs_currency=usd');
			return new Response(
				JSON.stringify({
					prices: [
						[at('2026-09-01'), usd ? 4 : 3.5],
						[at('2026-09-03'), usd ? 4.1 : 3.6]
					]
				}),
				{ status: 200 }
			);
		};
		const bridge = createBridgeServer({
			legacyRoutes: true,
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
			const path = '/rates/range?asset=AKT&from=2026-09-01&to=2026-09-03';
			assert.equal((await request(port, path)).status, 401);
			for (const bad of [
				'/rates/range?asset=akt;rm&from=2026-09-01&to=2026-09-03',
				'/rates/range?asset=AKT&from=2026-09-01',
				'/rates/range?asset=AKT&from=2026-09-31&to=2026-10-02',
				'/rates/range?asset=AKT&from=2026-09-03&to=2026-09-01',
				'/rates/range?asset=AKT&from=2026-06-17&to=2026-09-25',
				'/rates/range?asset=AKT&from=2026-09-01&to=2027-01-01',
				'/rates/range?asset=DOGE&from=2026-09-01&to=2026-09-03'
			]) {
				assert.equal((await request(port, bad, { headers: auth })).status, 400, bad);
			}
			assert.equal(asked.length, 0);
			const ok = await request(port, path, { headers: auth });
			assert.equal(ok.status, 200);
			// The 2nd has no rate: left out, not carried.
			assert.deepEqual(
				ok.json.rates.map((/** @type {any} */ r) => [r.date, r.rate, r.usdRate, r.source]),
				[
					['2026-09-01', '3.5', '4', 'coingecko'],
					['2026-09-03', '3.6', '4.1', 'coingecko']
				]
			);
			// CoinGecko twice (EUR, USD), and Kraken's candles once for the day without a point.
			assert.equal(asked.filter((u) => u.includes('api.coingecko.com')).length, 2);
			assert.equal(asked.length, 3);
		} finally {
			await new Promise((resolve) => bridge.server.close(resolve));
		}
	});
});

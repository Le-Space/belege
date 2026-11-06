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

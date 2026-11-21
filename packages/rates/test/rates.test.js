// Exchange rates: which source answers, and what "the rate of a day" is. The
// sources are faked; nothing goes to the network. The bridge's /rates route
// has its own test there (bridge/test/rates-route.test.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	createRateService,
	invert,
	toDecimal,
	RateError,
	TARGET_CURRENCIES
} from '../src/rates.js';

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
		if (typeof body === 'string') return new Response(body, { status: 200 });
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

	test('ECB: the days of a month are one request, each with its own rate', async () => {
		// Thu 1, Fri 2, Mon 5 October 2026 and Mon 2 November; the weekend has none.
		const { fetch, calls } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [
					{ series: { '0:0:0:0:0': { observations: { 0: [1.25], 1: [1.6], 2: [2], 3: [4] } } } }
				],
				structure: {
					dimensions: {
						observation: [
							{
								values: [
									{ id: '2026-10-01' },
									{ id: '2026-10-02' },
									{ id: '2026-10-05' },
									{ id: '2026-11-02' }
								]
							}
						]
					}
				}
			}
		});
		const rates = createRateService({ fetch, now: () => new Date('2026-11-20T10:00:00Z') });
		const got = [];
		for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
			const r = await rates.rate('USD', day);
			got.push(`${r.at.slice(0, 10)} ${r.rate}`);
		}
		assert.deepEqual(got, [
			'2026-10-01 0.8',
			'2026-10-02 0.625',
			'2026-10-02 0.625',
			'2026-10-02 0.625',
			'2026-10-05 0.5'
		]);
		assert.equal(calls.length, 1);
		// The window reaches 45 days to each side of the first day asked for.
		assert.match(calls[0], /startPeriod=2026-08-17&endPeriod=2026-11-15/);
	});

	test('ECB: a day the window has no later rate for is asked for again', async () => {
		// Asked on Friday 20 November before the day's rate is out: Thursday's counts, and is not kept for the 20th.
		const { fetch, calls } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [1.25], 1: [2] } } } }],
				structure: {
					dimensions: { observation: [{ values: [{ id: '2026-11-18' }, { id: '2026-11-19' }] }] }
				}
			}
		});
		const rates = createRateService({
			fetch,
			now: () => new Date('2026-11-20T10:00:00Z'),
			cacheSize: 0
		});
		assert.equal((await rates.rate('USD', '2026-11-18')).at, '2026-11-18T00:00:00Z');
		assert.equal((await rates.rate('USD', '2026-11-19')).at, '2026-11-19T00:00:00Z');
		assert.equal(calls.length, 1);
		assert.equal((await rates.rate('USD', '2026-11-20')).at, '2026-11-19T00:00:00Z');
		assert.equal(calls.length, 2);
		assert.match(calls[1], /endPeriod=2026-11-20/);
	});

	test('ECB: a rate more than a week before the day does not count', async () => {
		const { fetch } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [1.25] } } } }],
				structure: { dimensions: { observation: [{ values: [{ id: '2026-10-01' }] }] } }
			}
		});
		const rates = createRateService({ fetch, now: () => new Date('2026-11-20T10:00:00Z') });
		await assert.rejects(rates.rate('USD', '2026-10-20'), RateError);
	});

	test('another ECB currency: TRY, inverted, without a USD rate', async () => {
		const { fetch, calls } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [40] } } } }],
				structure: { dimensions: { observation: [{ values: [{ id: '2026-08-31' }] }] } }
			}
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('TRY', '2026-08-31');
		assert.equal(rate.rate, '0.025');
		assert.equal(rate.source, 'ecb');
		assert.equal(rate.usdRate, null);
		assert.match(calls[0], /EXR\/D\.TRY\.EUR\.SP00\.A/);
	});

	// A made-up answer in the shape of the Bank of Russia's XML_daily.asp.
	const cbrDaily = (
		/** @type {string} */ date,
		/** @type {string} */ nominal,
		/** @type {string} */ value
	) =>
		`<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="${date}" name="Foreign Currency Market">` +
		'<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>80,0000</Value><VunitRate>80</VunitRate></Valute>' +
		`<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>${nominal}</Nominal><Name>x</Name><Value>${value}</Value><VunitRate>x</VunitRate></Valute>` +
		'</ValCurs>';

	test('RUB without an ECB rate: the Bank of Russia rate valid on the day, inverted', async () => {
		const { fetch, calls } = fakeFetch({
			'https://data-api.ecb.europa.eu/': { dataSets: [{ series: {} }], structure: {} },
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrDaily('29.08.2026', '1', '100,0000')
		});
		// 2026-08-31 is a Monday: the rate set on Saturday counts.
		const rate = await createRateService({ fetch, now: NOW }).rate('RUB', '2026-08-31');
		assert.equal(rate.rate, '0.01');
		assert.equal(rate.source, 'cbr');
		assert.equal(rate.at, '2026-08-29T00:00:00Z');
		assert.equal(rate.usdRate, null);
		assert.ok(calls.some((u) => u.endsWith('XML_daily.asp?date_req=31/08/2026')));
	});

	test('RUB: per nominal, and a rate set for a later day is not taken', async () => {
		const per10 = fakeFetch({
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrDaily('29.08.2026', '10', '1000,0000')
		});
		const rate = await createRateService({ fetch: per10.fetch, now: NOW }).rate(
			'RUB',
			'2026-08-31'
		);
		assert.equal(Number(rate.rate), 0.01);
		const later = fakeFetch({
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrDaily('01.09.2026', '1', '100,0000')
		});
		await assert.rejects(
			createRateService({ fetch: later.fetch, now: NOW }).rate('RUB', '2026-08-31'),
			RateError
		);
	});

	// Made-up answers in the shape of the Bank of Russia's file with more currencies,
	// and of the National Bank of Kazakhstan's get_rates.cfm.
	const cbrWith = (/** @type {string} */ date, /** @type {string} */ lines) =>
		`<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="${date}" name="Foreign Currency Market">` +
		'<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>x</Name><Value>100,0000</Value><VunitRate>100</VunitRate></Valute>' +
		lines +
		'</ValCurs>';
	const valute = (
		/** @type {string} */ code,
		/** @type {string} */ nominal,
		/** @type {string} */ value
	) =>
		`<Valute ID="R0"><NumCode>0</NumCode><CharCode>${code}</CharCode><Nominal>${nominal}</Nominal><Name>x</Name><Value>${value}</Value><VunitRate>x</VunitRate></Valute>`;
	const nbkRates = (/** @type {string} */ date, /** @type {string} */ eur) =>
		`<?xml version="1.0" encoding="utf-8"?><rates><title>x</title><date>${date}</date>` +
		'<item><fullname>x</fullname><title>USD</title><description>400.00</description><quant>1</quant></item>' +
		`<item><fullname>x</fullname><title>EUR</title><description>${eur}</description><quant>1</quant></item></rates>`;

	test('KZT: the National Bank of Kazakhstan, inverted, with the day it is valid for (#325)', async () => {
		const { fetch, calls } = fakeFetch({
			'https://nationalbank.kz/rss/get_rates.cfm': nbkRates('31.08.2026', '500.00')
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('KZT', '2026-08-31');
		assert.equal(rate.rate, '0.002');
		assert.equal(rate.source, 'nbk');
		assert.equal(rate.at, '2026-08-31T00:00:00Z');
		assert.ok(calls[0].endsWith('get_rates.cfm?fdate=31.08.2026'));
		assert.equal(calls.length, 1);
	});

	test('KZT without an answer from Almaty: the cross rate through the ruble', async () => {
		const { fetch } = fakeFetch({
			'https://nationalbank.kz/rss/get_rates.cfm': 503,
			// 100 KZT = 20 RUB, 1 EUR = 100 RUB → 1 KZT = 0.002 EUR.
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrWith(
				'29.08.2026',
				valute('KZT', '100', '20,0000')
			)
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('KZT', '2026-08-31');
		assert.equal(rate.rate, '0.002');
		assert.equal(rate.source, 'cbr-cross');
		assert.equal(rate.at, '2026-08-29T00:00:00Z');
	});

	test('a currency only the Bank of Russia lists: a cross rate, one file for the day', async () => {
		const { fetch, calls } = fakeFetch({
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrWith(
				'29.08.2026',
				valute('UZS', '10000', '80,0000') + valute('GEL', '1', '25,0000')
			)
		});
		const service = createRateService({ fetch, now: NOW });
		const uzs = await service.rate('UZS', '2026-08-31');
		assert.equal(uzs.rate, '0.00008'); // 80 RUB per 10 000 UZS, 100 RUB per EUR
		assert.equal(uzs.source, 'cbr-cross');
		assert.equal((await service.rate('GEL', '2026-08-31')).rate, '0.25');
		assert.equal(calls.length, 1);
		// A currency neither lists: still no source; one the file leaves out: no rate.
		await assert.rejects(service.rate('XYZ', '2026-08-31'), /no rate source for XYZ/);
		await assert.rejects(service.rate('AMD', '2026-08-31'), /no rate found for AMD/);
	});

	test('a rates file for a later day is not taken, for the cross rate either', async () => {
		const { fetch } = fakeFetch({
			'https://nationalbank.kz/rss/get_rates.cfm': nbkRates('01.09.2026', '500.00'),
			'https://www.cbr.ru/scripts/XML_daily.asp': cbrWith(
				'01.09.2026',
				valute('KZT', '100', '20,0000')
			)
		});
		await assert.rejects(
			createRateService({ fetch, now: NOW }).rate('KZT', '2026-08-31'),
			RateError
		);
	});

	test('RUB before March 2022: the ECB rate still', async () => {
		const { fetch, calls } = fakeFetch({
			'https://data-api.ecb.europa.eu/': {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [80] } } } }],
				structure: { dimensions: { observation: [{ values: [{ id: '2021-06-01' }] }] } }
			}
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('RUB', '2021-06-01');
		assert.equal(rate.rate, '0.0125');
		assert.equal(rate.source, 'ecb');
		assert.equal(calls.length, 1);
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

	test('NEAR and USDT are listed: CoinGecko at 00:00 UTC, then their Kraken EUR pair', async () => {
		// Made-up prices.
		const { fetch, calls } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/near/history': coingecko(2.5, 2.75),
			'https://api.coingecko.com/api/v3/coins/tether/': 429,
			'https://api.kraken.com/0/public/OHLC?pair=USDTEUR': {
				error: [],
				result: {
					USDTZEUR: [
						[DAY_START - 86400, '0.91', '0', '0', '0', '0', '0', 0],
						[DAY_START, '0.92', '0', '0', '0', '0', '0', 0]
					],
					last: DAY_START
				}
			}
		});
		const rates = createRateService({ fetch, now: NOW });
		const near = await rates.rate('NEAR', '2026-09-01');
		assert.deepEqual(
			[near.rate, near.usdRate, near.source, near.at],
			['2.5', '2.75', 'coingecko', '2026-09-01T00:00:00Z']
		);
		const usdt = await rates.rate('USDT', '2026-09-01');
		assert.deepEqual([usdt.rate, usdt.source, usdt.at], ['0.92', 'kraken', '2026-09-01T00:00:00Z']);
		assert.ok(calls.some((c) => /coins\/tether\/history\?date=01-09-2026/.test(c)));
		assert.ok(calls.some((c) => /pair=USDTEUR/.test(c)));
	});

	test('prefer kraken: NEAR by NEAREUR', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.kraken.com/0/public/OHLC': {
				error: [],
				result: { NEAREUR: [[DAY_START, '2.4', '0', '0', '0', '0', '0', 0]], last: DAY_START }
			}
		});
		const rate = await createRateService({ fetch, now: NOW }).rate('NEAR', '2026-09-01', {
			prefer: 'kraken'
		});
		assert.equal(rate.rate, '2.4');
		assert.equal(rate.source, 'kraken');
		assert.match(calls[0], /pair=NEAREUR/);
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
	/** Kraken's first XBTEUR trade (2013-09-10), in seconds. */
	const LISTED = 1378856827.16;

	/**
	 * Kraken as it behaves: CoinGecko refuses days older than 365 (401), and
	 * Kraken answers "too many requests" (in a 200) after `allowed` calls in a row.
	 *
	 * @param {{ allowed?: number, throttleFirst?: number }} [options]
	 */
	function throttlingKraken({ allowed = 1, throttleFirst = 0 } = {}) {
		/** @type {string[]} */
		const calls = [];
		/** @type {string[]} */
		const trades = [];
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
			if (url.startsWith('https://api.kraken.com/0/public/Trades')) {
				trades.push(url);
				const since = Number(new URL(url).searchParams.get('since'));
				// Listed on 2013-09-10: before that, the first trade ever (not that day's).
				const at = Math.max(since + 3600.25, LISTED);
				return new Response(
					JSON.stringify({
						error: [],
						result: { XXBTZEUR: [['12345.6', '0.1', at, 's', 'l', '', 4711]], last: String(at) }
					}),
					{ status: 200 }
				);
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
		return { fetch: f, calls, trades, krakenCalls: () => kraken };
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

	test('a day before the candles: the first trade of that day, from the trade history', async () => {
		const { fetch, krakenCalls, trades } = throttlingKraken({ allowed: 1 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		await rates.rate('BTC', '2025-08-25');
		const old = await rates.rate('BTC', '2024-01-01');
		assert.equal(old.source, 'kraken');
		assert.equal(old.rate, '12345.6');
		assert.equal(old.at, '2024-01-01T01:00:00.250Z');
		assert.equal(old.ref, 'kraken-trade:4711');
		assert.equal(krakenCalls(), 1, 'the candles are not asked again');
		assert.deepEqual(trades, [
			`https://api.kraken.com/0/public/Trades?pair=XBTEUR&since=${day('2024-01-01')}&count=1`
		]);
		// Asked again, the day is kept.
		await rates.rate('BTC', '2024-01-01');
		assert.equal(trades.length, 1);
	});

	test('a day before the pair was listed: no rate (the first trade ever is not that day)', async () => {
		const { fetch } = throttlingKraken({ allowed: 1 });
		const rates = createRateService({ fetch, now: NOW, delay: async () => {} });
		await assert.rejects(rates.rate('BTC', '2012-05-01'), /no rate found/);
	});

	test('old days ask the trade history one after the other, spaced', async () => {
		const { fetch, trades } = throttlingKraken({ allowed: 1 });
		/** @type {number[]} */
		const waited = [];
		const rates = createRateService({
			fetch,
			now: NOW,
			delay: async (ms) => {
				waited.push(ms);
			}
		});
		const days = ['2023-01-02', '2023-02-03', '2023-03-04'];
		const found = await Promise.all(days.map((d) => rates.rate('BTC', d)));
		assert.deepEqual(
			found.map((r) => r.at.slice(0, 10)),
			days
		);
		assert.equal(trades.length, 3);
		assert.ok(waited.filter((ms) => ms >= 1000).length >= 2, `${waited}`);
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

// A rate into another currency than the euro (Le-Space/eigenbeleg-agent#72).
describe('a rate into another currency', () => {
	/** An ECB answer with one rate per day. @param {Record<string, number>} days */
	const ecb = (days) => ({
		dataSets: [
			{
				series: {
					'0:0:0:0:0': {
						observations: Object.fromEntries(Object.values(days).map((v, i) => [i, [v]]))
					}
				}
			}
		],
		structure: {
			dimensions: { observation: [{ values: Object.keys(days).map((id) => ({ id })) }] }
		}
	});
	const ECB_CHF = 'https://data-api.ecb.europa.eu/service/data/EXR/D.CHF.EUR';
	const ECB_USD = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR';
	const LATER = () => new Date('2026-11-20T10:00:00Z');

	test('CHF: the euro rate times the ECB reference rate of the day, both legs named', async () => {
		const { fetch } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/near/history': coingecko(4, 5),
			[ECB_CHF]: ecb({ '2026-10-01': 0.95, '2026-10-02': 0.9 })
		});
		const rate = await createRateService({ fetch, now: LATER }).rate('NEAR', '2026-10-01', {
			currency: 'CHF'
		});
		assert.deepEqual(rate, {
			asset: 'NEAR',
			date: '2026-10-01',
			currency: 'CHF',
			rate: '3.8',
			usdRate: '5',
			source: 'coingecko',
			at: '2026-10-01T00:00:00Z',
			eurRate: '4',
			fx: { currency: 'CHF', perEur: '0.95', source: 'ecb', at: '2026-10-01T00:00:00Z' }
		});
	});

	test('a month of days costs one ECB request for the currency; a weekend takes the last rate before it', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/near/history': coingecko(4, 5),
			[ECB_CHF]: ecb({ '2026-10-01': 0.95, '2026-10-02': 0.9, '2026-10-05': 0.8 })
		});
		const rates = createRateService({ fetch, now: LATER });
		const got = [];
		for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
			const r = await rates.rate('NEAR', day, { currency: 'CHF' });
			got.push(`${r.fx?.at.slice(0, 10)} ${r.rate}`);
		}
		assert.deepEqual(got, [
			'2026-10-01 3.8',
			'2026-10-02 3.6',
			'2026-10-02 3.6',
			'2026-10-02 3.6',
			'2026-10-05 3.2'
		]);
		assert.equal(calls.filter((u) => u.startsWith(ECB_CHF)).length, 1);
		// The euro rate is the one an EUR document gets, and is kept: asked for again, nothing is fetched.
		const before = calls.length;
		assert.equal((await rates.rate('NEAR', '2026-10-01')).rate, '4');
		await rates.rate('NEAR', '2026-10-03', { currency: 'CHF' });
		assert.equal(calls.length, before);
	});

	test('USD where CoinGecko has its own USD price: still the euro rate times the ECB rate', async () => {
		const { fetch, calls } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/usd-coin/history': coingecko(0.8, 1.0002),
			[ECB_USD]: ecb({ '2026-10-01': 1.25 })
		});
		const rate = await createRateService({ fetch, now: LATER }).rate('USDC', '2026-10-01', {
			currency: 'USD'
		});
		assert.equal(rate.rate, '1');
		assert.equal(rate.eurRate, '0.8');
		assert.equal(rate.currency, 'USD');
		assert.equal(rate.source, 'coingecko');
		assert.deepEqual(rate.fx, {
			currency: 'USD',
			perEur: '1.25',
			source: 'ecb',
			at: '2026-10-01T00:00:00Z'
		});
		assert.equal(calls.filter((u) => u.startsWith(ECB_USD)).length, 1);
	});

	test('USD from a Kraken rate: the same ECB leg', async () => {
		const { fetch } = fakeFetch({
			'https://api.kraken.com/0/public/OHLC': {
				error: [],
				result: {
					NEAREUR: [[Date.parse('2026-10-01T00:00:00Z') / 1000, '4', '5', '3', '4', '4', '1', 1]],
					last: 0
				}
			},
			[ECB_USD]: ecb({ '2026-10-01': 1.25 })
		});
		const rate = await createRateService({ fetch, now: LATER }).rate('NEAR', '2026-10-01', {
			currency: 'USD'
		});
		assert.equal(rate.source, 'kraken');
		assert.equal(rate.rate, '5');
		assert.deepEqual(rate.fx, {
			currency: 'USD',
			perEur: '1.25',
			source: 'ecb',
			at: '2026-10-01T00:00:00Z'
		});
	});

	test('RUB: the Bank of Russia rate valid on the day, per nominal', async () => {
		const cbr = (/** @type {string} */ nominal, /** @type {string} */ value) =>
			`<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="30.09.2026" name="x">` +
			`<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>${nominal}</Nominal><Name>x</Name><Value>${value}</Value></Valute></ValCurs>`;
		for (const [nominal, value] of [
			['1', '100,5000'],
			['10', '1005,0000']
		]) {
			const { fetch } = fakeFetch({
				'https://api.coingecko.com/api/v3/coins/near/history': coingecko(4, 5),
				'https://data-api.ecb.europa.eu/': { dataSets: [{ series: {} }], structure: {} },
				'https://www.cbr.ru/scripts/XML_daily.asp': cbr(nominal, value)
			});
			const rate = await createRateService({ fetch, now: LATER }).rate('NEAR', '2026-10-01', {
				currency: 'RUB'
			});
			assert.equal(rate.rate, '402');
			assert.equal(rate.fx?.source, 'cbr');
			assert.equal(Number(rate.fx?.perEur), 100.5);
			assert.equal(rate.fx?.at, '2026-09-30T00:00:00Z');
		}
	});

	test('a currency in itself is 1; a currency in another goes through the euro', async () => {
		const { fetch, calls } = fakeFetch({
			[ECB_USD]: ecb({ '2026-10-01': 1.25 }),
			[ECB_CHF]: ecb({ '2026-10-01': 0.95 })
		});
		const rates = createRateService({ fetch, now: LATER });
		const same = await rates.rate('CHF', '2026-10-01', { currency: 'CHF' });
		assert.equal(same.rate, '1');
		assert.equal(same.source, 'same');
		assert.equal(calls.length, 0);
		const usd = await rates.rate('USD', '2026-10-01', { currency: 'CHF' });
		assert.equal(usd.eurRate, '0.8');
		assert.equal(usd.rate, '0.76');
	});

	test('no second leg on the day: no rate, and nothing made up', async () => {
		const { fetch } = fakeFetch({
			'https://api.coingecko.com/api/v3/coins/near/history': coingecko(4, 5),
			[ECB_CHF]: ecb({ '2026-09-01': 0.95 })
		});
		await assert.rejects(
			createRateService({ fetch, now: LATER }).rate('NEAR', '2026-10-01', { currency: 'CHF' }),
			(e) => e instanceof RateError && e.status === 502
		);
	});

	test('only currencies with an official rate against the euro: a cross through the ruble is refused', async () => {
		const { fetch, calls } = fakeFetch({});
		const rates = createRateService({ fetch, now: LATER });
		for (const currency of ['UAH', 'KZT', 'XXX', 'chf', 'BTC']) {
			await assert.rejects(
				rates.rate('NEAR', '2026-10-01', { currency }),
				(e) => e instanceof RateError && e.status === 400
			);
		}
		assert.equal(calls.length, 0);
		assert.ok(TARGET_CURRENCIES.includes('EUR') && TARGET_CURRENCIES.includes('RUB'));
	});
});

describe('a period of days in one call', () => {
	const ms = (/** @type {string} */ d) => Date.parse(`${d}T00:00:00Z`);
	const RANGE = 'https://api.coingecko.com/api/v3/coins/nym/market_chart/range';
	const OHLC = 'https://api.kraken.com/0/public/OHLC?pair=NYMEUR';

	/**
	 * CoinGecko's daily points and Kraken's daily candles, made up; what was asked is recorded.
	 *
	 * @param {object} p
	 * @param {Record<string, number> | number} p.eur day → price, or an HTTP status
	 * @param {Record<string, number> | number} [p.usd]
	 * @param {Record<string, string>} [p.kraken] day → open
	 * @param {number[][]} [p.extra] points that are none of a day
	 */
	function sources({ eur, usd = {}, kraken, extra = [] }) {
		/** @type {string[]} */
		const calls = [];
		/** @type {typeof fetch} */
		const f = async (input) => {
			const url = String(input);
			calls.push(url);
			if (url.startsWith(RANGE)) {
				const q = new URL(url).searchParams;
				const table = q.get('vs_currency') === 'eur' ? eur : usd;
				if (typeof table === 'number') return new Response('{}', { status: table });
				const from = Number(q.get('from')) * 1000;
				const to = Number(q.get('to')) * 1000;
				const prices = Object.entries(table)
					.map(([d, price]) => [ms(d), price])
					.filter(([at]) => at >= from && at <= to);
				return new Response(JSON.stringify({ prices: [...prices, ...extra] }), { status: 200 });
			}
			if (url.startsWith(OHLC) && kraken) {
				const candles = Object.entries(kraken).map(([d, open]) => [ms(d) / 1000, open]);
				return new Response(JSON.stringify({ error: [], result: { NYMEUR: candles, last: 0 } }), {
					status: 200
				});
			}
			return new Response('{}', { status: 404 });
		};
		return { fetch: f, calls };
	}

	test('CoinGecko answers the whole period in two calls; the days are those of rate()', async () => {
		const eur = {
			'2026-09-22': 0.05,
			'2026-09-23': 0.051,
			'2026-09-24': 0.052,
			'2026-09-25': 2e-7
		};
		const usd = { '2026-09-22': 0.06, '2026-09-23': 0.061, '2026-09-24': 0.062 };
		const { fetch, calls } = sources({ eur, usd });
		const rates = createRateService({ fetch, now: NOW });
		const answer = await rates.rates('NYM', '2026-09-22', '2026-09-25');
		assert.equal(calls.length, 2);
		assert.match(
			calls[0],
			new RegExp(
				`vs_currency=eur&from=${ms('2026-09-22') / 1000}&to=${ms('2026-09-25') / 1000}&interval=daily&precision=full$`
			)
		);
		assert.match(calls[1], /vs_currency=usd/);
		assert.deepEqual(
			{ asset: answer.asset, from: answer.from, to: answer.to, currency: answer.currency },
			{ asset: 'NYM', from: '2026-09-22', to: '2026-09-25', currency: 'EUR' }
		);
		assert.deepEqual(answer.rates[0], {
			asset: 'NYM',
			date: '2026-09-22',
			currency: 'EUR',
			rate: '0.05',
			usdRate: '0.06',
			source: 'coingecko',
			at: '2026-09-22T00:00:00Z'
		});
		assert.deepEqual(
			answer.rates.map((r) => [r.date, r.rate, r.usdRate]),
			[
				['2026-09-22', '0.05', '0.06'],
				['2026-09-23', '0.051', '0.061'],
				['2026-09-24', '0.052', '0.062'],
				['2026-09-25', '0.0000002', null]
			]
		);
		// Kept under rate()'s keys: neither asks again.
		assert.deepEqual(await rates.rate('NYM', '2026-09-23'), answer.rates[1]);
		assert.deepEqual(await rates.rates('NYM', '2026-09-22', '2026-09-25'), answer);
		assert.equal(calls.length, 2);
	});

	test('only the days not kept yet are asked for; today is asked again', async () => {
		const eur = Object.fromEntries(
			['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'].map((d) => [d, 0.05])
		);
		const { fetch, calls } = sources({ eur, usd: eur });
		const rates = createRateService({ fetch, now: NOW });
		await rates.rates('NYM', '2026-09-22', '2026-09-23');
		const answer = await rates.rates('NYM', '2026-09-22', '2026-09-26');
		assert.equal(answer.rates.length, 5);
		assert.match(
			calls[2],
			new RegExp(`from=${ms('2026-09-24') / 1000}&to=${ms('2026-09-26') / 1000}`)
		);
		await rates.rates('NYM', '2026-09-22', '2026-09-26');
		assert.match(
			calls[4],
			new RegExp(`from=${ms('2026-09-26') / 1000}&to=${ms('2026-09-26') / 1000}`)
		);
		assert.equal(calls.length, 6);
	});

	test('a day missing in the answer stays missing: nothing is carried', async () => {
		const { fetch } = sources({
			eur: { '2026-09-22': 0.05, '2026-09-24': 0.052 },
			// A point of a running day is none of a day.
			extra: [[ms('2026-09-23') + 3600_000, 0.07]]
		});
		const answer = await createRateService({ fetch, now: NOW }).rates(
			'NYM',
			'2026-09-22',
			'2026-09-24'
		);
		assert.deepEqual(
			answer.rates.map((r) => r.date),
			['2026-09-22', '2026-09-24']
		);
	});

	test('a day CoinGecko has none for: Kraken, one call; CoinGecko refusing: Kraken for all', async () => {
		const kraken = { '2026-09-22': '0.04', '2026-09-23': '0.041', '2026-09-24': '0.042' };
		const partly = sources({ eur: { '2026-09-22': 0.05, '2026-09-24': 0.052 }, kraken });
		const some = await createRateService({ fetch: partly.fetch, now: NOW }).rates(
			'NYM',
			'2026-09-22',
			'2026-09-25'
		);
		assert.deepEqual(
			some.rates.map((r) => [r.date, r.rate, r.source]),
			[
				['2026-09-22', '0.05', 'coingecko'],
				['2026-09-23', '0.041', 'kraken'],
				['2026-09-24', '0.052', 'coingecko']
			]
		);
		const refused = sources({ eur: 429, kraken });
		const rates = createRateService({ fetch: refused.fetch, now: NOW });
		const all = await rates.rates('NYM', '2026-09-22', '2026-09-24');
		assert.deepEqual(
			all.rates.map((r) => [r.rate, r.source]),
			[
				['0.04', 'kraken'],
				['0.041', 'kraken'],
				['0.042', 'kraken']
			]
		);
		// One call each: CoinGecko (refused), Kraken's candles.
		assert.equal(refused.calls.length, 2);
		assert.equal((await rates.rate('NYM', '2026-09-23')).source, 'kraken');
		assert.equal(refused.calls.length, 2);
	});

	test('without the USD prices the days are not kept: rate() asks for its own snapshot', async () => {
		const { fetch, calls } = sources({ eur: { '2026-09-22': 0.05 }, usd: 429 });
		const rates = createRateService({ fetch, now: NOW });
		const answer = await rates.rates('NYM', '2026-09-22', '2026-09-22');
		assert.deepEqual(
			answer.rates.map((r) => [r.rate, r.usdRate]),
			[['0.05', null]]
		);
		await assert.rejects(rates.rate('NYM', '2026-09-22'));
		assert.match(/** @type {string} */ (calls.at(-2)), /\/coins\/nym\/history\?date=22-09-2026/);
	});

	test('days older than a year are not asked of CoinGecko', async () => {
		const { fetch, calls } = sources({ eur: {}, kraken: { '2025-09-01': '0.2' } });
		const answer = await createRateService({ fetch, now: NOW }).rates(
			'NYM',
			'2025-09-01',
			'2025-09-02'
		);
		assert.deepEqual(
			answer.rates.map((r) => [r.date, r.rate, r.source]),
			[['2025-09-01', '0.2', 'kraken']]
		);
		assert.ok(calls.every((c) => c.startsWith(OHLC)));
	});

	test('a currency goes by the ECB window', async () => {
		const ECB_USD = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A';
		const { fetch, calls } = fakeFetch({
			[ECB_USD]: {
				dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [1.25], 1: [1.6] } } } }],
				structure: {
					dimensions: { observation: [{ values: [{ id: '2026-09-22' }, { id: '2026-09-23' }] }] }
				}
			}
		});
		const answer = await createRateService({ fetch, now: NOW }).rates(
			'USD',
			'2026-09-22',
			'2026-09-23'
		);
		assert.deepEqual(
			answer.rates.map((r) => [r.date, r.rate, r.source]),
			[
				['2026-09-22', '0.8', 'ecb'],
				['2026-09-23', '0.625', 'ecb']
			]
		);
		assert.equal(calls.length, 1);
	});

	test('refused before anything is asked: an unlisted asset, bad days, too long a period', async () => {
		const { fetch, calls } = sources({ eur: {} });
		const rates = createRateService({ fetch, now: NOW });
		for (const [asset, from, to] of [
			['DOGE', '2026-09-01', '2026-09-02'],
			['toString', '2026-09-01', '2026-09-02'],
			['NYM', '2026-9-1', '2026-09-02'],
			['NYM', '2026-09-01', '2026-02-30x'],
			['NYM', '2026-09-02', '2026-09-01'],
			['NYM', '2026-09-01', '2026-09-27'],
			['NYM', '2026-06-18', '2026-09-26']
		]) {
			await assert.rejects(
				rates.rates(asset, from, to),
				(e) => e instanceof RateError && e.status === 400,
				`${asset} ${from} ${to}`
			);
		}
		assert.equal(calls.length, 0);
		// A hundred days, both ends included, are answered.
		assert.deepEqual((await rates.rates('NYM', '2026-06-19', '2026-09-26')).rates, []);
	});
});

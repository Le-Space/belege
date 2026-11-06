// SPDX-License-Identifier: AGPL-3.0-or-later
// The day's rate in a browser: CoinGecko with the caller's key, Kraken's
// daily open when CoinGecko fails, the ECB, the Bank of Russia's
// windows-1251 file, and a Uniswap V4 pool id (keccak over hex, no Buffer).
// browser.test.js runs it in Node and in Chromium and compares. The sources
// are faked with made-up numbers; nothing goes to the network.
import { createRateService, v4PoolId } from '../../src/index.js';

const DAY_START = Date.parse('2026-09-01T00:00:00Z') / 1000;
/** `Евро` in windows-1251, as the Bank of Russia sends it. */
const EURO_1251 = [0xc5, 0xe2, 0xf0, 0xee];
const ascii = (/** @type {string} */ s) => Array.from(s, (c) => c.charCodeAt(0));
const cbr = new Uint8Array([
	...ascii(
		'<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="29.08.2026" name="Foreign Currency Market">' +
			'<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>'
	),
	...EURO_1251,
	...ascii('</Name><Value>100,0000</Value><VunitRate>100</VunitRate></Valute></ValCurs>')
]);

/** @type {Record<string, unknown>} */
const answers = {
	'https://api.coingecko.com/api/v3/coins/akash-network/': {
		market_data: { current_price: { eur: 3.5, usd: 4 } }
	},
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
	},
	'https://data-api.ecb.europa.eu/service/data/EXR/D.USD': {
		dataSets: [{ series: { '0:0:0:0:0': { observations: { 0: [1.25], 1: [1.1] } } } }],
		structure: {
			dimensions: { observation: [{ values: [{ id: '2026-08-28' }, { id: '2026-08-31' }] }] }
		}
	},
	'https://data-api.ecb.europa.eu/': { dataSets: [{ series: {} }], structure: {} },
	'https://www.cbr.ru/scripts/XML_daily.asp': cbr
};

export default async function scenario() {
	/** @type {string[]} */
	const keys = [];
	/** @type {typeof fetch} */
	const fetch = async (input, init) => {
		const url = String(input);
		const key = new Headers(init?.headers).get('x-cg-demo-api-key');
		if (key) keys.push(key);
		const prefix = Object.keys(answers).find((p) => url.startsWith(p));
		const body = prefix === undefined ? 404 : answers[prefix];
		if (typeof body === 'number') return new Response('{}', { status: body });
		if (body instanceof Uint8Array) return new Response(body, { status: 200 });
		return new Response(JSON.stringify(body), { status: 200 });
	};
	const rates = createRateService({
		fetch,
		coingeckoKey: async () => 'demo-key-for-tests',
		now: () => new Date('2026-09-26T10:00:00Z'),
		delay: async () => {}
	});
	return {
		akt: await rates.rate('AKT', '2026-09-01'),
		btc: await rates.rate('BTC', '2026-09-01'),
		usd: await rates.rate('USD', '2026-08-30'),
		rub: await rates.rate('RUB', '2026-08-31'),
		keys: [...new Set(keys)],
		pool: v4PoolId(`0x${'5e'.repeat(20)}`, `0x${'00'.repeat(20)}`, 3000, 60)
	};
}

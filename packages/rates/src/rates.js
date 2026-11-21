// SPDX-License-Identifier: AGPL-3.0-or-later
// Exchange rates for the day of a booking: how many euros one unit of an
// asset was worth. The one definition of "the rate of a day" for Le Space's
// tools (Belege, the Eigenbeleg API and web UI; Le-Space/eigenbeleg-agent#6,
// decided 2026-11-06: the price at 00:00 UTC).
//
// It runs wherever `fetch` reaches the sources. Belege's browser cannot ask
// CoinGecko, Kraken or the ECB itself (CORS, and the CoinGecko key stays in
// the keychain), so there the bridge runs it; the caller hands in `fetch` and
// the keys (`coingeckoKey`, and the Alchemy key for dex-rate.js).
//
// What "the rate of a day" means, the same for every source:
//   - a crypto asset: its price at 00:00 UTC of that day
//       1. CoinGecko /coins/{id}/history (its daily snapshot at 00:00 UTC)
//       2. failing that, Kraken's daily candle of that day, its open price
//       3. a day before Kraken's daily candles: Kraken's first trade of the pair
//          at or after 00:00 UTC of that day – the price the candle would have
//          opened with; none on that day, no rate
//     CoinGecko's public and demo API answer for the last 365 days only. Kraken
//     answers one call with its last 720 daily candles; the completed ones are
//     kept per pair, so a wallet with bookings on many days costs one Kraken
//     call per asset, not one per day – Kraken's public API refuses more than a
//     handful in a row ("EGeneral:Too many requests"), and those days then had
//     no rate at all. A day older than the candles costs one call to Kraken's
//     trade history, one at a time and spaced, for the same reason.
//     With `prefer: 'kraken'` (a booking on the Kraken exchange) the order
//     turns: Kraken's own EUR price first, CoinGecko as the fallback; and
//     Kraken can then price any asset it trades against EUR (`<SYMBOL>EUR`),
//     also one Belege does not list yet.
//     A period of days (`rates(asset, from, to)`, for a chart of two months):
//     CoinGecko /coins/{id}/market_chart/range with `interval=daily` answers
//     with one point per day at 00:00 UTC – the same figure /history gives for
//     that day (compared against the live API on 2026-11-21, digit for digit,
//     EUR and USD) – so a period costs two calls (EUR, USD) instead of one per
//     day, which the public API refuses after about ten. A day without a point
//     goes to Kraken as above; a day neither has stays without a rate.
//   - a currency: the ECB reference rate of that day, or the last one before
//     it (weekends, holidays), inverted: EUR per unit
//   - RUB: the ECB publishes none since 2022-03-01; then the Bank of Russia's
//     official rate valid on that day (RUB per EUR, set on the working day
//     before), inverted
//   - KZT: the National Bank of Kazakhstan's official rate of the day (KZT per
//     EUR), inverted (#325)
//   - a currency neither publishes against the euro, but the Bank of Russia
//     lists (UZS, GEL, AMD, …): a cross rate through the ruble from the same
//     day's file, EUR per unit = (RUB per unit) / (RUB per EUR); marked
//     `cbr-cross`, so nobody takes it for an official EUR rate

//
// A rate into another currency than the euro (`currency`, for a document kept
// in CHF, USD, RUB …; Le-Space/eigenbeleg-agent#72) is that euro rate times
// the currency's units per euro of the day: the ECB reference rate, or the
// last one before it; for RUB since 2022-03-01 the Bank of Russia's official
// rate valid on the day. The answer carries both legs (`eurRate`, `fx`). USD
// too: the euro is converted with the ECB's reference rate for every currency
// but the ruble, also where CoinGecko has a USD price of its own.

// Every answer says which source it came from and for what moment, so a
// booking can show where its euro amount came from.
//
// Rates are decimal strings, never floats: `60123.45`, `0.000012`.
// Nothing about the person's bookings leaves the bridge: a request names an
// asset and a day, nothing else.

import { multiplyRates } from './dex-rate.js';

/**
 * @typedef {object} AssetSources
 * @property {string} [coingecko] CoinGecko coin id
 * @property {string} [kraken] Kraken OHLC pair against EUR
 * @property {boolean} [ecb] a currency with an ECB reference rate
 * @property {boolean} [cbr] the Bank of Russia's official rate, where the ECB has none
 * @property {boolean} [nbk] the National Bank of Kazakhstan's official rate against EUR
 * @property {boolean} [cbrCross] a cross rate through the ruble, from the Bank of Russia's daily rates
 */

/**
 * The currencies with an ECB reference rate (BGN until the end of 2025, RUB
 * until 2022-03-01; a day without one falls through to the next source).
 */
export const ECB_CURRENCIES = Object.freeze(
	'USD JPY BGN CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR RUB'.split(
		' '
	)
);

/**
 * The currencies a rate can be given in (`rate(asset, date, { currency })`):
 * the euro, and every currency with an official rate against it from the ECB
 * or, for RUB, the Bank of Russia. A cross rate through the ruble is none.
 */
export const TARGET_CURRENCIES = Object.freeze(['EUR', ...ECB_CURRENCIES]);

/**
 * The currencies the Bank of Russia rates daily and the ECB does not: priced
 * as a cross rate through the ruble (#325). Its SDR line (XDR) is no currency.
 */
export const CBR_CROSS_CURRENCIES = Object.freeze(
	'AED AMD AZN BYN EGP GEL KGS KZT MDL QAR RSD TJS TMT UAH UZS VND'.split(' ')
);

/** The assets the bridge can price, by the symbol the app uses. */
export const RATE_SOURCES = /** @type {Readonly<Record<string, AssetSources>>} */ (
	Object.freeze({
		BTC: { coingecko: 'bitcoin', kraken: 'XBTEUR' },
		ETH: { coingecko: 'ethereum', kraken: 'ETHEUR' },
		USDC: { coingecko: 'usd-coin', kraken: 'USDCEUR' },
		ALEPH: { coingecko: 'aleph' },
		NYM: { coingecko: 'nym', kraken: 'NYMEUR' },
		AKT: { coingecko: 'akash-network', kraken: 'AKTEUR' },
		FIL: { coingecko: 'filecoin', kraken: 'FILEUR' },
		XMR: { coingecko: 'monero', kraken: 'XMREUR' },
		POL: { coingecko: 'polygon-ecosystem-token', kraken: 'POLEUR' },
		// NEAR (Eigenbeleg's NEAR reader) and USDT: CoinGecko first, Kraken's EUR pair after.
		NEAR: { coingecko: 'near', kraken: 'NEAREUR' },
		USDT: { coingecko: 'tether', kraken: 'USDTEUR' },
		// No EUR pair on Kraken; a swap's other side prices it where CoinGecko has no rate (#163).
		USDFC: { coingecko: 'usdfc' },
		...Object.fromEntries(ECB_CURRENCIES.map((c) => [c, { ecb: true }])),
		RUB: { ecb: true, cbr: true },
		...Object.fromEntries(CBR_CROSS_CURRENCIES.map((c) => [c, { cbrCross: true }])),
		// The country's central bank first; the cross rate when it has no answer.
		KZT: { nbk: true, cbrCross: true }
	})
);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class RateError extends Error {
	/** @param {string} message @param {number} status */
	constructor(message, status) {
		super(message);
		this.name = 'RateError';
		this.status = status;
	}
}

/**
 * A number from a JSON API as a plain decimal string, without an exponent.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function toDecimal(value) {
	const n = typeof value === 'string' ? Number(value) : value;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
	const plain = String(n);
	if (!/e/i.test(plain)) return plain;
	return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 1 / rate, as a decimal string with 12 significant digits after the point.
 *
 * @param {string} rate
 */
export function invert(rate) {
	const [int, frac = ''] = rate.split('.');
	const scale = 10n ** BigInt(frac.length);
	const value = BigInt(int + frac);
	if (value === 0n) throw new RateError('rate is zero', 502);
	const digits = 12n;
	const q = (scale * 10n ** digits * 10n) / value; // one extra digit to round
	const rounded = (q + 5n) / 10n;
	const s = rounded.toString().padStart(Number(digits) + 1, '0');
	const out = `${s.slice(0, -Number(digits))}.${s.slice(-Number(digits))}`;
	return out.replace(/0+$/, '').replace(/\.$/, '');
}

/** `2026-09-01` → `01-09-2026` (CoinGecko's date format) */
const ddmmyyyy = (/** @type {string} */ day) => day.split('-').reverse().join('-');

/** A day, `n` days later (earlier for a negative `n`). */
const addDays = (/** @type {string} */ day, /** @type {number} */ n) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** How far back from a day its ECB rate may lie (weekends, holidays). */
const ECB_LOOKBACK_DAYS = 7;
/** How many days before and after a day one ECB request reads. */
const ECB_WINDOW_DAYS = 45;
/** How many such windows are kept per currency. */
const ECB_WINDOWS_KEPT = 8;

/** @param {string} day */
const startOfDay = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);

/** The longest period `rates()` answers at once, both ends included. */
export const MAX_RANGE_DAYS = 100;
/**
 * How many days back CoinGecko's public and demo API are asked for a period:
 * they answer for "the past 365 days" counted from the moment of the call, and
 * refuse the whole period (401) when its first day lies before that.
 */
const COINGECKO_DAYS_BACK = 364;

/** Waits before Kraken is asked again after "too many requests", in ms. */
const KRAKEN_RETRIES = Object.freeze([1000, 2000, 4000, 8000]);
/** The pause between two calls to Kraken's trade history (one per day older than the candles). */
const KRAKEN_TRADES_GAP_MS = 1100;

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {() => Promise<string | null>} [options.coingeckoKey] a CoinGecko demo key, if the caller has one
 * @param {() => Date} [options.now]
 * @param {number} [options.cacheSize]
 * @param {(ms: number) => Promise<void>} [options.delay] the wait before Kraken is asked again after it said "too many requests"
 * @param {ReturnType<typeof import('./dex-rate.js').createDexRates> | null} [options.dex]
 *   a token's pool rate at a block, when CoinGecko has none (issue #163)
 */
/**
 * CoinGecko's platform ids of the EVM chains a wallet can be on, for a token's
 * rate by its contract (issue #115: a token not in the list).
 */
export const COINGECKO_PLATFORMS = Object.freeze({
	ethereum: 'ethereum',
	base: 'base',
	arbitrum: 'arbitrum-one',
	optimism: 'optimistic-ethereum',
	polygon: 'polygon-pos'
});

export function createRateService({
	fetch: f = fetch,
	coingeckoKey = async () => null,
	now = () => new Date(),
	cacheSize = 500,
	dex = null,
	delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
	/** @type {Map<string, Rate>} */
	const cache = new Map();
	/** @type {Map<string, string | null>} `<platform>:<contract>` → CoinGecko coin id */
	const ids = new Map();
	/** @type {Map<string, { from: string, days: { date: string, perEur: string }[] }[]>} currency → the ECB windows read */
	const ecbWindows = new Map();

	/**
	 * @param {string} url
	 * @param {Record<string, string>} [headers]
	 */
	async function getJson(url, headers = {}) {
		let res;
		try {
			res = await f(url, { headers: { accept: 'application/json', ...headers } });
		} catch {
			return null;
		}
		if (!res.ok) return null;
		return res.json().catch(() => null);
	}

	/** @param {string} id @param {string} day */
	async function fromCoinGecko(id, day) {
		const key = await coingeckoKey().catch(() => null);
		const body = await getJson(
			`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/history?date=${ddmmyyyy(day)}&localization=false`,
			key ? { 'x-cg-demo-api-key': key } : {}
		);
		const eur = toDecimal(body?.market_data?.current_price?.eur);
		if (!eur) return null;
		return {
			rate: eur,
			usdRate: toDecimal(body?.market_data?.current_price?.usd),
			source: 'coingecko',
			at: `${day}T00:00:00Z`
		};
	}

	/**
	 * CoinGecko's daily points of a coin from one day to another, in one
	 * currency: its price at 00:00 UTC of each day, by day. Null when CoinGecko
	 * did not answer with a series; a point at another moment (the newest one
	 * of a running day) is none of a day.
	 *
	 * @param {string} id
	 * @param {string} from YYYY-MM-DD
	 * @param {string} to YYYY-MM-DD
	 * @param {'eur' | 'usd'} currency
	 * @returns {Promise<Map<string, string> | null>}
	 */
	async function coinGeckoDays(id, from, to, currency) {
		const key = await coingeckoKey().catch(() => null);
		const body = await getJson(
			`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=${currency}&from=${startOfDay(from)}&to=${startOfDay(to)}&interval=daily&precision=full`,
			key ? { 'x-cg-demo-api-key': key } : {}
		);
		if (!Array.isArray(body?.prices)) return null;
		/** @type {Map<string, string>} */
		const days = new Map();
		for (const point of body.prices) {
			const at = Array.isArray(point) ? point[0] : null;
			const price = Array.isArray(point) ? toDecimal(point[1]) : null;
			if (!Number.isSafeInteger(at) || at % 86400_000 !== 0 || !price) continue;
			const day = new Date(at).toISOString().slice(0, 10);
			if (day >= from && day <= to) days.set(day, price);
		}
		return days;
	}

	/**
	 * A token's CoinGecko id by its contract; null when CoinGecko does not know it.
	 *
	 * @param {string} platform
	 * @param {string} contract 0x + 40 hex, lower case
	 */
	async function idOfContract(platform, contract) {
		const k = `${platform}:${contract}`;
		if (ids.has(k)) return ids.get(k) ?? null;
		const key = await coingeckoKey().catch(() => null);
		const body = await getJson(
			`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(platform)}/contract/${contract}`,
			key ? { 'x-cg-demo-api-key': key } : {}
		);
		const id = typeof body?.id === 'string' && /^[a-z0-9-]{1,100}$/.test(body.id) ? body.id : null;
		ids.set(k, id);
		return id;
	}

	/**
	 * Per Kraken pair: the open of each completed day, by its 00:00 UTC in
	 * seconds, and the start of the day the series was asked on. Days before
	 * its first candle Kraken has no daily candle for; days from `until` on
	 * need a newer series.
	 *
	 * @type {Map<string, { until: number, opens: Map<number, string> }>}
	 */
	const krakenSeries = new Map();
	/** @type {Map<string, Promise<{ until: number, opens: Map<number, string> } | null>>} one call per pair at a time */
	const krakenAsking = new Map();

	/** Kraken's daily candles of a pair; on "too many requests" it is asked again, a few times, waiting longer each time. @param {string} pair */
	async function krakenOhlc(pair) {
		const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=1440`;
		for (let attempt = 0; ; attempt++) {
			let res;
			try {
				res = await f(url, { headers: { accept: 'application/json' } });
			} catch {
				return null;
			}
			const body = res.ok ? await res.json().catch(() => null) : null;
			const errors = Array.isArray(body?.error) ? body.error.map(String) : [];
			const throttled =
				res.status === 429 || errors.some((e) => /too many requests|rate limit/i.test(e));
			if (throttled && attempt < KRAKEN_RETRIES.length) {
				await delay(KRAKEN_RETRIES[attempt]);
				continue;
			}
			if (!body || errors.length) return null;
			const key = Object.keys(body.result ?? {}).find((k) => k !== 'last');
			const candles = key ? body.result[key] : null;
			return Array.isArray(candles) ? /** @type {unknown[][]} */ (candles) : null;
		}
	}

	/** @param {string} pair */
	function loadKraken(pair) {
		let asking = krakenAsking.get(pair);
		if (!asking) {
			asking = (async () => {
				const candles = await krakenOhlc(pair);
				if (!candles) return null;
				const until = startOfDay(now().toISOString().slice(0, 10));
				/** @type {Map<number, string>} */
				const opens = new Map();
				for (const c of candles) {
					const time = Array.isArray(c) ? Number(c[0]) : NaN;
					const open = Array.isArray(c) ? toDecimal(c[1]) : null;
					if (Number.isSafeInteger(time) && open) opens.set(time, open);
				}
				// Today's candle is kept out, as the day's answer is (see rate()).
				const done = new Map([...opens].filter(([time]) => time < until));
				if (done.size) krakenSeries.set(pair, { until, opens: done });
				return { until, opens };
			})().finally(() => krakenAsking.delete(pair));
			krakenAsking.set(pair, asking);
		}
		return asking;
	}

	/** @param {string} pair @param {string} day */
	async function fromKraken(pair, day) {
		const time = startOfDay(day);
		const kept = krakenSeries.get(pair);
		const series = kept && time < kept.until ? kept : await loadKraken(pair);
		const open = series?.opens.get(time);
		if (open) return { rate: open, usdRate: null, source: 'kraken', at: `${day}T00:00:00Z` };
		// Older than the 720 candles: the first trade of that day.
		const first = series?.opens.size ? Math.min(...series.opens.keys()) : null;
		return first !== null && time < first ? fromKrakenTrades(pair, time) : null;
	}

	/** Calls to the trade history, one after the other, spaced (Kraken counts them). */
	let tradesQueue = Promise.resolve();

	/**
	 * Kraken's first trade of a pair at or after `time` (00:00 UTC of a day, in
	 * seconds), if it falls on that day: the price the day's candle would have
	 * opened with. Before a pair was listed Kraken answers with its first trade
	 * ever, which is not that day's.
	 *
	 * @param {string} pair
	 * @param {number} time
	 */
	function fromKrakenTrades(pair, time) {
		const url = `https://api.kraken.com/0/public/Trades?pair=${encodeURIComponent(pair)}&since=${time}&count=1`;
		const ask = tradesQueue.then(async () => {
			for (let attempt = 0; ; attempt++) {
				let res;
				try {
					res = await f(url, { headers: { accept: 'application/json' } });
				} catch {
					return null;
				}
				const body = res.ok ? await res.json().catch(() => null) : null;
				const errors = Array.isArray(body?.error) ? body.error.map(String) : [];
				const throttled =
					res.status === 429 || errors.some((e) => /too many requests|rate limit/i.test(e));
				if (throttled && attempt < KRAKEN_RETRIES.length) {
					await delay(KRAKEN_RETRIES[attempt]);
					continue;
				}
				if (!body || errors.length) return null;
				const key = Object.keys(body.result ?? {}).find((k) => k !== 'last');
				const trade = key && Array.isArray(body.result[key]) ? body.result[key][0] : null;
				const price = Array.isArray(trade) ? toDecimal(trade[0]) : null;
				const at = Array.isArray(trade) ? Number(trade[2]) : NaN;
				if (!price || !Number.isFinite(at) || at < time || at >= time + 86400) return null;
				return /** @type {const} */ ({
					rate: price,
					usdRate: null,
					source: 'kraken',
					at: new Date(Math.floor(at * 1000)).toISOString(),
					ref: `kraken-trade:${trade[6] ?? ''}`
				});
			}
		});
		tradesQueue = ask.then(
			() => delay(KRAKEN_TRADES_GAP_MS),
			() => delay(KRAKEN_TRADES_GAP_MS)
		);
		return ask;
	}

	/**
	 * A token's rate from its deepest pool against ETH or USDC at the booking's
	 * block, times that quote's rate of the day (dex-rate.js, issue #163).
	 *
	 * @param {{ contract: string, chain: string, block: number, decimals: number }} p
	 * @param {string} day
	 */
	async function fromPool(p, day) {
		/** @type {Map<string, Promise<string | null>>} */
		const quotes = new Map();
		/** @param {'ETH' | 'USDC'} q */
		const quoteEur = (q) => {
			if (!quotes.has(q)) {
				quotes.set(
					q,
					rate(q, day).then(
						(r) => r.rate,
						() => null
					)
				);
			}
			return /** @type {Promise<string | null>} */ (quotes.get(q));
		};
		const price = await dex?.poolPrice({ ...p, quoteEur }).catch(() => null);
		if (!price) return null;
		const eur = await quoteEur(price.quote);
		if (!eur) return null;
		return {
			rate: multiplyRates(price.price, eur),
			usdRate: null,
			source: /** @type {const} */ ('dex'),
			at: price.at || `${day}T00:00:00Z`,
			ref: `uniswap-v${price.version}:${price.pool}@${price.block}`
		};
	}

	/**
	 * The ECB's reference rates of a currency in a window of days, or null when
	 * the ECB did not answer with a series.
	 *
	 * @param {string} currency
	 * @param {string} from YYYY-MM-DD
	 * @param {string} to YYYY-MM-DD
	 * @returns {Promise<{ date: string, perEur: string }[] | null>} newest first
	 */
	async function ecbWindow(currency, from, to) {
		const body = await getJson(
			`https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${from}&endPeriod=${to}&format=jsondata`
		);
		const series = body?.dataSets?.[0]?.series?.['0:0:0:0:0']?.observations;
		const dates = body?.structure?.dimensions?.observation?.[0]?.values;
		if (!series || !Array.isArray(dates)) return null;
		/** @type {{ date: string, perEur: string }[]} */
		const days = [];
		for (const [index, obs] of Object.entries(series)) {
			const date = dates[Number(index)]?.id;
			const value = toDecimal(/** @type {any} */ (obs)?.[0]);
			if (typeof date === 'string' && value) days.push({ date, perEur: value });
		}
		return days.sort((a, b) => (a.date < b.date ? 1 : -1));
	}

	/**
	 * The ECB reference rate of a currency (units per EUR) of the day or the
	 * last one before it.
	 *
	 * One request reads the weeks around the day, and the days near it are
	 * answered from that: a month of daily rates is one request, not thirty.
	 * A window answers a day only when it reaches a week back from it and holds
	 * a rate of that day or a later one – then the ECB has published everything
	 * up to the day, and a published reference rate does not change. The newest
	 * days, which may still get a rate of their own, are asked for each time.
	 *
	 * @param {string} currency
	 * @param {string} day
	 * @returns {Promise<{ date: string, perEur: string } | null>}
	 */
	async function ecbRate(currency, day) {
		const start = addDays(day, -ECB_LOOKBACK_DAYS);
		let windows = ecbWindows.get(currency);
		let days = windows?.find((w) => w.from <= start && w.days[0]?.date >= day)?.days;
		if (!days) {
			const today = now().toISOString().slice(0, 10);
			const from = addDays(day, -ECB_WINDOW_DAYS);
			const ahead = addDays(day, ECB_WINDOW_DAYS);
			const to = ahead < today ? ahead : day > today ? day : today;
			const fetched = await ecbWindow(currency, from, to);
			if (!fetched) return null;
			days = fetched;
			if (!windows) ecbWindows.set(currency, (windows = []));
			if (windows.length >= ECB_WINDOWS_KEPT) windows.shift();
			windows.push({ from, days });
		}
		return days.find((d) => d.date <= day && d.date >= start) ?? null;
	}

	/** EUR per unit of a currency: its ECB reference rate (ecbRate), inverted. @param {string} currency @param {string} day */
	async function fromEcb(currency, day) {
		const last = await ecbRate(currency, day);
		if (!last) return null;
		return {
			rate: invert(last.perEur),
			usdRate: currency === 'USD' ? '1' : null,
			source: 'ecb',
			at: `${last.date}T00:00:00Z`
		};
	}

	/**
	 * The text of an official rates file, or null when it cannot be had.
	 *
	 * @param {string} url
	 * @param {string} encoding
	 */
	async function getText(url, encoding) {
		try {
			const res = await f(url, { headers: { accept: 'application/xml' } });
			if (!res.ok) return null;
			return new TextDecoder(encoding).decode(await res.arrayBuffer());
		} catch {
			return null;
		}
	}

	/**
	 * @typedef {object} CbrDay
	 * @property {string} date YYYY-MM-DD the rates are valid for
	 * @property {Map<string, { nominal: string, value: string }>} valutes RUB per `nominal` units, by code
	 */

	/** @type {Map<string, Promise<CbrDay | null>>} one file per day, for RUB and every cross rate */
	const cbrDays = new Map();

	/**
	 * The Bank of Russia's official rates valid on the day: `XML_daily.asp`
	 * answers with the last rates set for it (on the working day before; none
	 * on weekends and holidays), RUB per `Nominal` units of each currency.
	 * Null when the file is not to be had, or is for a later day.
	 *
	 * @param {string} day
	 * @returns {Promise<CbrDay | null>}
	 */
	function cbrDay(day) {
		const known = cbrDays.get(day);
		if (known) return known;
		const loading = (async () => {
			// windows-1251; the dates, codes and numbers read here are ASCII.
			const text = await getText(
				`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${ddmmyyyy(day).replaceAll('-', '/')}`,
				'latin1'
			);
			if (!text) return null;
			const valid = /<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(text);
			if (!valid) return null;
			const date = `${valid[3]}-${valid[2]}-${valid[1]}`;
			if (date > day) return null;
			/** @type {Map<string, { nominal: string, value: string }>} */
			const valutes = new Map();
			for (const [entry] of text.matchAll(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/g)) {
				const code = /<CharCode>([A-Z]{3})<\/CharCode>/.exec(entry)?.[1];
				const nominal = /<Nominal>([1-9]\d*)<\/Nominal>/.exec(entry)?.[1];
				const value = /<Value>(\d+),(\d+)<\/Value>/.exec(entry);
				if (code && nominal && value && /[1-9]/.test(value[1] + value[2])) {
					valutes.set(code, { nominal, value: `${value[1]}.${value[2]}` });
				}
			}
			return { date, valutes };
		})();
		cbrDays.set(day, loading);
		// A failed answer is asked again next time; only the last days are kept.
		loading.then((d) => {
			if (!d) cbrDays.delete(day);
		});
		if (cbrDays.size > 60) cbrDays.delete(/** @type {string} */ (cbrDays.keys().next().value));
		return loading;
	}

	/**
	 * EUR per RUB on the day: the Bank of Russia's RUB per `nominal` EUR, inverted.
	 *
	 * @param {CbrDay} d
	 */
	function eurPerRub(d) {
		const eur = d.valutes.get('EUR');
		if (!eur) return null;
		const perRub = invert(eur.value);
		return eur.nominal === '1' ? perRub : multiplyRates(perRub, eur.nominal);
	}

	/** EUR per RUB from the Bank of Russia's official rates valid on the day. @param {string} day */
	async function fromCbr(day) {
		const d = await cbrDay(day);
		const rate = d && eurPerRub(d);
		if (!d || !rate) return null;
		return { rate, usdRate: null, source: 'cbr', at: `${d.date}T00:00:00Z` };
	}

	/**
	 * A cross rate through the ruble, from one day's file: EUR per unit =
	 * (RUB per unit) × (EUR per RUB). Not an official EUR rate, and named so.
	 *
	 * @param {string} currency
	 * @param {string} day
	 */
	async function fromCbrCross(currency, day) {
		const d = await cbrDay(day);
		const line = d?.valutes.get(currency);
		const perRub = d && eurPerRub(d);
		if (!d || !line || !perRub) return null;
		const perNominal = multiplyRates(line.value, perRub);
		return {
			rate: line.nominal === '1' ? perNominal : multiplyRates(perNominal, invert(line.nominal)),
			usdRate: null,
			source: 'cbr-cross',
			at: `${d.date}T00:00:00Z`
		};
	}

	/**
	 * EUR per KZT from the National Bank of Kazakhstan's official rates of the
	 * day (`get_rates.cfm`, KZT per `quant` units of each currency; it answers
	 * for weekends too, with the last rate set).
	 *
	 * @param {string} day
	 */
	async function fromNbk(day) {
		const [y, m, d] = day.split('-');
		const text = await getText(
			`https://nationalbank.kz/rss/get_rates.cfm?fdate=${d}.${m}.${y}`,
			'utf-8'
		);
		if (!text) return null;
		const valid = /<date>(\d{2})\.(\d{2})\.(\d{4})<\/date>/.exec(text);
		const item =
			/<item>(?:(?!<\/item>)[\s\S])*?<title>EUR<\/title>(?:(?!<\/item>)[\s\S])*?<\/item>/.exec(
				text
			)?.[0] ?? '';
		const value = /<description>(\d+(?:\.\d+)?)<\/description>/.exec(item)?.[1];
		const quant = /<quant>([1-9]\d*)<\/quant>/.exec(item)?.[1];
		if (!valid || !value || !quant || !/[1-9]/.test(value)) return null;
		const date = `${valid[3]}-${valid[2]}-${valid[1]}`;
		if (date > day) return null;
		// `value` KZT per `quant` EUR: EUR per KZT = quant / value.
		const perKzt = invert(value);
		return {
			rate: quant === '1' ? perKzt : multiplyRates(perKzt, quant),
			usdRate: null,
			source: 'nbk',
			at: `${date}T00:00:00Z`
		};
	}

	/**
	 * How many units of a currency one euro is on the day: the ECB reference
	 * rate, else (RUB) the Bank of Russia's official rate valid on the day.
	 * Null where neither has one.
	 *
	 * @param {string} currency
	 * @param {string} day
	 * @returns {Promise<Fx | null>}
	 */
	async function perEuro(currency, day) {
		const sources = RATE_SOURCES[currency];
		const ecb = sources.ecb ? await ecbRate(currency, day) : null;
		if (ecb) return { currency, perEur: ecb.perEur, source: 'ecb', at: `${ecb.date}T00:00:00Z` };
		const d = sources.cbr ? await cbrDay(day) : null;
		const eur = d?.valutes.get('EUR');
		if (!d || !eur) return null;
		return {
			currency,
			perEur: eur.nominal === '1' ? eur.value : multiplyRates(eur.value, invert(eur.nominal)),
			source: 'cbr',
			at: `${d.date}T00:00:00Z`
		};
	}

	/**
	 * @typedef {{ currency: string, perEur: string, source: 'ecb' | 'cbr', at: string }} Fx
	 *   the second leg of a rate into another currency: its units per euro, from whom, of which day
	 */

	/**
	 * @typedef {{ asset: string, date: string, currency: string, rate: string, usdRate: string | null, source: 'coingecko' | 'kraken' | 'ecb' | 'cbr' | 'nbk' | 'cbr-cross' | 'dex' | 'same', at: string, ref?: string, eurRate?: string, fx?: Fx }} Rate
	 *   `ref` for `dex`: `uniswap-v2:<pool>@<block>`, V4 with its pool id.
	 *   With a `currency` other than EUR: `rate` is in that currency, `source`
	 *   and `at` are those of the euro rate (`eurRate`), and `fx` is the leg
	 *   from the euro into the currency (ECB, for RUB the Bank of Russia) –
	 *   absent only for the currency in itself (`same`, rate 1).
	 */

	/**
	 * The rate of one unit of `asset` in another currency than the euro.
	 *
	 * @param {string} asset
	 * @param {string} date
	 * @param {string} currency from TARGET_CURRENCIES, not EUR
	 * @param {Parameters<typeof rate>[2]} options
	 * @returns {Promise<Rate>}
	 */
	async function rateIn(asset, date, currency, options) {
		if (!TARGET_CURRENCIES.includes(currency)) {
			throw new RateError(`no rate into ${String(currency).slice(0, 10)}`, 400);
		}
		if (asset === currency && !options?.contract) {
			if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
				throw new RateError('date must be YYYY-MM-DD', 400);
			}
			return {
				asset,
				date,
				currency,
				rate: '1',
				usdRate: currency === 'USD' ? '1' : null,
				source: 'same',
				at: `${date}T00:00:00Z`
			};
		}
		const eur = await rate(asset, date, options);
		const fx = await perEuro(currency, date);
		if (!fx) throw new RateError(`no rate found for EUR in ${currency} on ${date}`, 502);
		return { ...eur, currency, rate: multiplyRates(eur.rate, fx.perEur), eurRate: eur.rate, fx };
	}

	/**
	 * The rate of one unit of `asset` on `date`, in EUR unless another `currency` is asked for.
	 *
	 * @param {string} asset a symbol from RATE_SOURCES; with prefer 'kraken', any symbol
	 * @param {string} date YYYY-MM-DD, not in the future
	 * @param {{ prefer?: 'kraken' | null, contract?: string | null, chain?: string | null, block?: number | null, decimals?: number | null, currency?: string }} [options]
	 *   `contract` and `chain`: a token not in the list, by its contract only – its
	 *   symbol is its own claim and says nothing (issue #115); with `block` and
	 *   `decimals`, the DEX pool at that block when CoinGecko has no rate (#163);
	 *   `currency`: one of TARGET_CURRENCIES, the euro rate times that currency's
	 *   official rate of the day (see the head of this file)
	 * @returns {Promise<Rate>}
	 */
	async function rate(
		asset,
		date,
		{
			prefer = null,
			contract = null,
			chain = null,
			block = null,
			decimals = null,
			currency = 'EUR'
		} = {}
	) {
		if (currency !== 'EUR') {
			return rateIn(asset, date, currency, { prefer, contract, chain, block, decimals });
		}
		const platform =
			contract && chain && Object.hasOwn(COINGECKO_PLATFORMS, chain)
				? COINGECKO_PLATFORMS[/** @type {keyof typeof COINGECKO_PLATFORMS} */ (chain)]
				: null;
		if (contract && (!platform || !/^0x[0-9a-f]{40}$/.test(contract))) {
			throw new RateError('a token rate needs a contract and an EVM chain', 400);
		}
		const listed = Object.hasOwn(RATE_SOURCES, asset) ? RATE_SOURCES[asset] : null;
		const byContract =
			contract && platform
				? await (async () => {
						const id = await idOfContract(platform, contract);
						return id ? { coingecko: id } : null;
					})()
				: undefined;
		const sources =
			byContract !== undefined
				? byContract
				: prefer === 'kraken' && /^[A-Z0-9]{2,10}$/.test(asset)
					? {
							...listed,
							kraken:
								listed?.ecb || listed?.cbrCross || listed?.nbk
									? undefined
									: (listed?.kraken ?? `${asset}EUR`)
						}
					: listed;
		const pool =
			contract && chain && block && decimals !== null && dex
				? { contract, chain, block, decimals }
				: null;
		if (!sources && !pool) throw new RateError(`no rate source for ${asset}`, contract ? 502 : 400);
		if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
			throw new RateError('date must be YYYY-MM-DD', 400);
		}
		if (date > now().toISOString().slice(0, 10)) {
			throw new RateError('date lies in the future', 400);
		}
		const key = `${contract ?? asset}@${date}@${prefer ?? ''}@${pool ? block : ''}`;
		const cached = cache.get(key);
		if (cached) return cached;

		const coingecko = async () =>
			sources?.coingecko ? fromCoinGecko(sources.coingecko, date) : null;
		const kraken = async () => (sources?.kraken ? fromKraken(sources.kraken, date) : null);
		const found =
			(sources?.ecb ? await fromEcb(asset, date) : null) ??
			(sources?.cbr ? await fromCbr(date) : null) ??
			(sources?.nbk ? await fromNbk(date) : null) ??
			(sources?.cbrCross ? await fromCbrCross(asset, date) : null) ??
			(prefer === 'kraken'
				? ((await kraken()) ?? (await coingecko()))
				: ((await coingecko()) ?? (await kraken()))) ??
			(pool ? await fromPool(pool, date) : null);
		if (!found) throw new RateError(`no rate found for ${asset} on ${date}`, 502);

		/** @type {Rate} */
		const result = { asset, date, currency: 'EUR', ...found };
		keep(key, result);
		return result;
	}

	/**
	 * Today's rate may still change until the day is over; only past days are kept.
	 *
	 * @param {string} key
	 * @param {Rate} result
	 */
	function keep(key, result) {
		if (result.date >= now().toISOString().slice(0, 10)) return;
		if (cache.size >= cacheSize) cache.delete(/** @type {string} */ (cache.keys().next().value));
		cache.set(key, result);
	}

	/**
	 * The euro rate of one unit of a listed asset on each day of a period: what
	 * `rate(asset, day)` answers for each of them, asked for together. A crypto
	 * asset costs CoinGecko two calls for the whole period (its EUR and its USD
	 * price at 00:00 UTC of each day) and Kraken at most one more; a currency
	 * goes day by day, as its sources answer by the day or by the window anyway.
	 *
	 * A day without a rate is left out: nothing is carried from the day before.
	 * A token by its contract, a DEX pool, `prefer` and another currency than
	 * the euro stay with `rate`.
	 *
	 * @param {string} asset a symbol from RATE_SOURCES
	 * @param {string} from YYYY-MM-DD
	 * @param {string} to YYYY-MM-DD, not before `from`, not in the future, at most MAX_RANGE_DAYS days with `from`
	 * @returns {Promise<{ asset: string, from: string, to: string, currency: 'EUR', rates: Rate[] }>} the days with a rate, oldest first
	 */
	async function rates(asset, from, to) {
		const sources = Object.hasOwn(RATE_SOURCES, asset) ? RATE_SOURCES[asset] : null;
		if (!sources) throw new RateError(`no rate source for ${String(asset).slice(0, 10)}`, 400);
		for (const day of [from, to]) {
			if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
				throw new RateError('from and to must be YYYY-MM-DD', 400);
			}
		}
		const today = now().toISOString().slice(0, 10);
		if (to > today) throw new RateError('to lies in the future', 400);
		if (from > to) throw new RateError('from lies after to', 400);
		if (addDays(from, MAX_RANGE_DAYS - 1) < to) {
			throw new RateError(`at most ${MAX_RANGE_DAYS} days at once`, 400);
		}
		/** @type {string[]} */
		const days = [];
		for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
		const keyOf = (/** @type {string} */ day) => `${asset}@${day}@@`;
		/** @type {Map<string, Rate>} */
		const found = new Map();
		for (const day of days) {
			const cached = cache.get(keyOf(day));
			if (cached) found.set(day, cached);
		}
		const open = () => days.filter((day) => !found.has(day));

		if (!sources.coingecko && !sources.kraken) {
			// A currency: the ECB's window holds the days around; the other banks answer by the day.
			for (const day of open()) {
				const r = await rate(asset, day).catch(() => null);
				if (r) found.set(day, r);
			}
		} else {
			// CoinGecko has nothing older than a year: those days are Kraken's, as for `rate`.
			const oldest = addDays(today, -COINGECKO_DAYS_BACK);
			const asked = open().filter((day) => day >= oldest);
			if (sources.coingecko && asked.length) {
				const first = asked[0];
				const last = /** @type {string} */ (asked.at(-1));
				const eur = await coinGeckoDays(sources.coingecko, first, last, 'eur');
				const usd = eur?.size ? await coinGeckoDays(sources.coingecko, first, last, 'usd') : null;
				for (const day of asked) {
					const price = eur?.get(day);
					if (!price) continue;
					/** @type {Rate} */
					const r = {
						asset,
						date: day,
						currency: 'EUR',
						rate: price,
						usdRate: usd?.get(day) ?? null,
						source: 'coingecko',
						at: `${day}T00:00:00Z`
					};
					found.set(day, r);
					// Kept only with the USD price a rate in dollars is taken from (rateIn).
					if (usd) keep(keyOf(day), r);
				}
			}
			if (sources.kraken) {
				for (const day of open()) {
					const k = await fromKraken(sources.kraken, day);
					if (!k) continue;
					/** @type {Rate} */
					const r = { asset, date: day, currency: 'EUR', ...k };
					found.set(day, r);
					keep(keyOf(day), r);
				}
			}
		}
		return {
			asset,
			from,
			to,
			currency: 'EUR',
			rates: days.flatMap((day) => found.get(day) ?? [])
		};
	}

	return { rate, rates };
}

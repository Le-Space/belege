// Exchange rates for the day of a booking: how many euros one unit of an
// asset was worth. The browser cannot ask CoinGecko, Kraken or the ECB
// itself (CORS, and the CoinGecko key stays in the keychain), so it asks
// the bridge.
//
// What "the rate of a day" means, the same for every source:
//   - a crypto asset: its price at 00:00 UTC of that day
//       1. CoinGecko /coins/{id}/history (its daily snapshot at 00:00 UTC)
//       2. failing that, Kraken's daily candle of that day, its open price
//     CoinGecko's public and demo API answer for the last 365 days only. Kraken
//     answers one call with its last 720 daily candles; the completed ones are
//     kept per pair, so a wallet with bookings on many days costs one Kraken
//     call per asset, not one per day – Kraken's public API refuses more than a
//     handful in a row ("EGeneral:Too many requests"), and those days then had
//     no rate at all.
//     With `prefer: 'kraken'` (a booking on the Kraken exchange) the order
//     turns: Kraken's own EUR price first, CoinGecko as the fallback; and
//     Kraken can then price any asset it trades against EUR (`<SYMBOL>EUR`),
//     also one Belege does not list yet.
//   - a currency: the ECB reference rate of that day, or the last one before
//     it (weekends, holidays), inverted: EUR per unit
//   - RUB: the ECB publishes none since 2022-03-01; then the Bank of Russia's
//     official rate valid on that day (RUB per EUR, set on the working day
//     before), inverted

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
		// No EUR pair on Kraken; a swap's other side prices it where CoinGecko has no rate (#163).
		USDFC: { coingecko: 'usdfc' },
		...Object.fromEntries(ECB_CURRENCIES.map((c) => [c, { ecb: true }])),
		RUB: { ecb: true, cbr: true }
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

/** @param {string} day */
const startOfDay = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);

/** Waits before Kraken is asked again after "too many requests", in ms. */
const KRAKEN_RETRIES = Object.freeze([1000, 2000, 4000, 8000]);

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {() => Promise<string | null>} [options.coingeckoKey] a CoinGecko demo key, if one is in the keychain
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
		if (!open) return null;
		return { rate: open, usdRate: null, source: 'kraken', at: `${day}T00:00:00Z` };
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
	 * EUR per unit of a currency from the ECB reference rate of the day or the
	 * last one before it.
	 *
	 * @param {string} currency
	 * @param {string} day
	 */
	async function fromEcb(currency, day) {
		const start = new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86400_000)
			.toISOString()
			.slice(0, 10);
		const body = await getJson(
			`https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${start}&endPeriod=${day}&format=jsondata`
		);
		const series = body?.dataSets?.[0]?.series?.['0:0:0:0:0']?.observations;
		const dates = body?.structure?.dimensions?.observation?.[0]?.values;
		if (!series || !Array.isArray(dates)) return null;
		/** @type {{ date: string, usdPerEur: string }[]} */
		const days = [];
		for (const [index, obs] of Object.entries(series)) {
			const date = dates[Number(index)]?.id;
			const value = toDecimal(/** @type {any} */ (obs)?.[0]);
			if (typeof date === 'string' && date <= day && value) days.push({ date, usdPerEur: value });
		}
		const last = days.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
		if (!last) return null;
		return {
			rate: invert(last.usdPerEur),
			usdRate: currency === 'USD' ? '1' : null,
			source: 'ecb',
			at: `${last.date}T00:00:00Z`
		};
	}

	/**
	 * EUR per RUB from the Bank of Russia's official rates valid on the day:
	 * `XML_daily.asp` answers with the last rates set for it (on the working
	 * day before; none on weekends and holidays), RUB per `Nominal` EUR.
	 *
	 * @param {string} day
	 */
	async function fromCbr(day) {
		let text;
		try {
			const res = await f(
				`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${ddmmyyyy(day).replaceAll('-', '/')}`,
				{
					headers: { accept: 'application/xml' }
				}
			);
			if (!res.ok) return null;
			// windows-1251; the dates, codes and numbers read here are ASCII.
			text = new TextDecoder('latin1').decode(await res.arrayBuffer());
		} catch {
			return null;
		}
		const valid = /<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(text);
		const eur =
			/<Valute\b[^>]*>(?:(?!<\/Valute>)[\s\S])*?<CharCode>EUR<\/CharCode>(?:(?!<\/Valute>)[\s\S])*?<\/Valute>/.exec(
				text
			)?.[0] ?? '';
		const nominal = /<Nominal>(\d+)<\/Nominal>/.exec(eur)?.[1];
		const value = /<Value>(\d+),(\d+)<\/Value>/.exec(eur);
		if (!valid || !nominal || !value) return null;
		const date = `${valid[3]}-${valid[2]}-${valid[1]}`;
		if (date > day) return null;
		// `value` RUB per `nominal` EUR: EUR per RUB = nominal / value.
		const perRub = invert(`${value[1]}.${value[2]}`);
		return {
			rate: nominal === '1' ? perRub : multiplyRates(perRub, nominal),
			usdRate: null,
			source: 'cbr',
			at: `${date}T00:00:00Z`
		};
	}

	/**
	 * @typedef {{ asset: string, date: string, currency: 'EUR', rate: string, usdRate: string | null, source: 'coingecko' | 'kraken' | 'ecb' | 'cbr' | 'dex', at: string, ref?: string }} Rate
	 *   `ref` for `dex`: `uniswap-v2:<pool>@<block>`, V4 with its pool id
	 */

	/**
	 * The rate of one unit of `asset` in EUR on `date`.
	 *
	 * @param {string} asset a symbol from RATE_SOURCES; with prefer 'kraken', any symbol
	 * @param {string} date YYYY-MM-DD, not in the future
	 * @param {{ prefer?: 'kraken' | null, contract?: string | null, chain?: string | null, block?: number | null, decimals?: number | null }} [options]
	 *   `contract` and `chain`: a token not in the list, by its contract only – its
	 *   symbol is its own claim and says nothing (issue #115); with `block` and
	 *   `decimals`, the DEX pool at that block when CoinGecko has no rate (#163)
	 * @returns {Promise<Rate>}
	 */
	async function rate(
		asset,
		date,
		{ prefer = null, contract = null, chain = null, block = null, decimals = null } = {}
	) {
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
					? { ...listed, kraken: listed?.ecb ? undefined : (listed?.kraken ?? `${asset}EUR`) }
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
			(prefer === 'kraken'
				? ((await kraken()) ?? (await coingecko()))
				: ((await coingecko()) ?? (await kraken()))) ??
			(pool ? await fromPool(pool, date) : null);
		if (!found) throw new RateError(`no rate found for ${asset} on ${date}`, 502);

		/** @type {Rate} */
		const result = { asset, date, currency: 'EUR', ...found };
		// Today's rate may still change until the day is over; only past days are kept.
		if (date < now().toISOString().slice(0, 10)) {
			if (cache.size >= cacheSize) cache.delete(/** @type {string} */ (cache.keys().next().value));
			cache.set(key, result);
		}
		return result;
	}

	return { rate };
}

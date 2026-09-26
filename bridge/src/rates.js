// Exchange rates for the day of a booking: how many euros one unit of an
// asset was worth. The browser cannot ask CoinGecko, Kraken or the ECB
// itself (CORS, and the CoinGecko key stays in the keychain), so it asks
// the bridge.
//
// What "the rate of a day" means, the same for every source:
//   - a crypto asset: its price at 00:00 UTC of that day
//       1. CoinGecko /coins/{id}/history (its daily snapshot at 00:00 UTC)
//       2. failing that, Kraken's daily candle of that day, its open price
//   - USD: the ECB reference rate of that day, or the last one before it
//     (weekends, holidays), inverted: EUR per USD
// Every answer says which source it came from and for what moment, so a
// booking can show where its euro amount came from.
//
// Rates are decimal strings, never floats: `60123.45`, `0.000012`.
// Nothing about the person's bookings leaves the bridge: a request names an
// asset and a day, nothing else.

/**
 * @typedef {object} AssetSources
 * @property {string} [coingecko] CoinGecko coin id
 * @property {string} [kraken] Kraken OHLC pair against EUR
 * @property {boolean} [ecb] a currency with an ECB reference rate
 */

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
		USD: { ecb: true }
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

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {() => Promise<string | null>} [options.coingeckoKey] a CoinGecko demo key, if one is in the keychain
 * @param {() => Date} [options.now]
 * @param {number} [options.cacheSize]
 */
export function createRateService({
	fetch: f = fetch,
	coingeckoKey = async () => null,
	now = () => new Date(),
	cacheSize = 500
} = {}) {
	/** @type {Map<string, Rate>} */
	const cache = new Map();

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

	/** @param {string} pair @param {string} day */
	async function fromKraken(pair, day) {
		const since = startOfDay(day) - 1;
		const body = await getJson(
			`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=1440&since=${since}`
		);
		if (!body || (Array.isArray(body.error) && body.error.length)) return null;
		const key = Object.keys(body.result ?? {}).find((k) => k !== 'last');
		/** @type {unknown[][]} */
		const candles = key ? body.result[key] : [];
		const candle = candles.find((c) => Number(c[0]) === startOfDay(day));
		const open = candle ? toDecimal(candle[1]) : null;
		if (!open) return null;
		return { rate: open, usdRate: null, source: 'kraken', at: `${day}T00:00:00Z` };
	}

	/** EUR per USD from the ECB reference rate of the day or the last one before it. @param {string} day */
	async function fromEcb(day) {
		const start = new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86400_000)
			.toISOString()
			.slice(0, 10);
		const body = await getJson(
			`https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${start}&endPeriod=${day}&format=jsondata`
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
			usdRate: '1',
			source: 'ecb',
			at: `${last.date}T00:00:00Z`
		};
	}

	/**
	 * @typedef {{ asset: string, date: string, currency: 'EUR', rate: string, usdRate: string | null, source: 'coingecko' | 'kraken' | 'ecb', at: string }} Rate
	 */

	/**
	 * The rate of one unit of `asset` in EUR on `date`.
	 *
	 * @param {string} asset a symbol from RATE_SOURCES
	 * @param {string} date YYYY-MM-DD, not in the future
	 * @returns {Promise<Rate>}
	 */
	async function rate(asset, date) {
		const sources = Object.hasOwn(RATE_SOURCES, asset) ? RATE_SOURCES[asset] : null;
		if (!sources) throw new RateError(`no rate source for ${asset}`, 400);
		if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
			throw new RateError('date must be YYYY-MM-DD', 400);
		}
		if (date > now().toISOString().slice(0, 10)) {
			throw new RateError('date lies in the future', 400);
		}
		const key = `${asset}@${date}`;
		const cached = cache.get(key);
		if (cached) return cached;

		const found =
			(sources.ecb ? await fromEcb(date) : null) ??
			(sources.coingecko ? await fromCoinGecko(sources.coingecko, date) : null) ??
			(sources.kraken ? await fromKraken(sources.kraken, date) : null);
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

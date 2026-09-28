// Exchange rates for the day of a booking: how many euros one unit of an
// asset was worth. The browser cannot ask CoinGecko, Kraken or the ECB
// itself (CORS, and the CoinGecko key stays in the keychain), so it asks
// the bridge.
//
// What "the rate of a day" means, the same for every source:
//   - a crypto asset: its price at 00:00 UTC of that day
//       1. CoinGecko /coins/{id}/history (its daily snapshot at 00:00 UTC)
//       2. failing that, Kraken's daily candle of that day, its open price
//     With `prefer: 'kraken'` (a booking on the Kraken exchange) the order
//     turns: Kraken's own EUR price first, CoinGecko as the fallback; and
//     Kraken can then price any asset it trades against EUR (`<SYMBOL>EUR`),
//     also one Belege does not list yet.
//   - USD: the ECB reference rate of that day, or the last one before it
//     (weekends, holidays), inverted: EUR per USD
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
		POL: { coingecko: 'polygon-ecosystem-token', kraken: 'POLEUR' },
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
	dex = null
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

	/**
	 * A token's rate from its deepest WETH pool at the booking's block, times
	 * ETH's rate of the day (dex-rate.js, issue #163).
	 *
	 * @param {{ contract: string, chain: string, block: number, decimals: number }} p
	 * @param {string} day
	 */
	async function fromPool(p, day) {
		const price = await dex?.poolPrice(p).catch(() => null);
		if (!price) return null;
		const eth = await rate('ETH', day).catch(() => null);
		if (!eth) return null;
		return {
			rate: multiplyRates(price.ethPerToken, eth.rate),
			usdRate: null,
			source: /** @type {const} */ ('dex'),
			at: price.at || `${day}T00:00:00Z`,
			ref: `uniswap-v${price.version}:${price.pool}@${price.block}`
		};
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
	 * @typedef {{ asset: string, date: string, currency: 'EUR', rate: string, usdRate: string | null, source: 'coingecko' | 'kraken' | 'ecb' | 'dex', at: string, ref?: string }} Rate
	 *   `ref` for `dex`: `uniswap-v2:<pool>@<block>`
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
			(sources?.ecb ? await fromEcb(date) : null) ??
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

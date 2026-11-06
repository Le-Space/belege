// A token's rate from a DEX pool at the block of its booking (issue #163), for
// tokens CoinGecko does not price on that day. Read on chain through the
// Alchemy key (`pnpm setup:alchemy`), so it needs no further service; without
// a key there is no pool rate.
//
// How:
//   1. the token's pools against ETH and against USDC:
//      - Uniswap V2 (`getPair`) and V3 (`getPool`, 0.05 %, 0.3 %, 1 %) against
//        WETH and USDC, from the factories below;
//      - Uniswap V4 (one PoolManager for all pools, read through its
//        `StateView`): the pool ids of the token against native ETH
//        (`address(0)`) and USDC at the usual fee tiers, without hooks – a pool
//        with hooks has an id nobody can guess and is not found;
//   2. how deep each pool is on its quote side at the booking's block: V2 the
//      quote token it holds (`balanceOf`); V3 and V4 the reserve their active
//      liquidity amounts to at the current price (`liquidity`, the square
//      root price) – what moving the price costs, and alike for both, where a
//      V3 pool's balance would count liquidity far from the price and V4 has
//      no balance of its own – in euros, by the quote's rate of the day; the
//      deepest counts, and only when it holds at least `minEur` (a thin
//      pool's price is easily bent);
//   3. its price at that block: V2 `getReserves`, V3 `slot0`, V4 `getSlot0`;
//   4. times the quote's euro rate of the day (rates.js).
// Every call is an `eth_call` at that block, so the result can be recomputed
// by anyone: pool (or V4 pool id) and block go with the rate.
//
// Addresses checked against the chains: V2/V3 on 2026-09-28 (`getPair` /
// `getPool` of USDC/WETH give the well-known pools), V4's StateView on
// 2026-09-29 (the ETH/USDC pools at 0.05 % and 0.3 % give ~2,700 USDC per ETH).

import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * @typedef {object} DexChain
 * @property {string} network Alchemy's network, the host's first label
 * @property {string} weth
 * @property {string} usdc
 * @property {string} v2Factory Uniswap V2
 * @property {string} v3Factory Uniswap V3
 * @property {string} v4StateView Uniswap V4's read-only view of its PoolManager
 */

/** @type {Readonly<Record<string, DexChain>>} */
export const DEX_CHAINS = Object.freeze({
	ethereum: {
		network: 'eth-mainnet',
		weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
		usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
		v2Factory: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
		v3Factory: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
		v4StateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227'
	},
	base: {
		network: 'base-mainnet',
		weth: '0x4200000000000000000000000000000000000006',
		usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
		v2Factory: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6',
		v3Factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
		v4StateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71'
	}
});

/** Uniswap V3's fee tiers, in hundredths of a basis point. */
const V3_FEES = [500, 3000, 10000];
/** Uniswap V4's usual fee tiers with their tick spacing. */
const V4_TIERS = [
	[100, 1],
	[500, 10],
	[3000, 60],
	[10000, 200]
];
/** The least a pool must hold on its quote side, in euros, for its price to count. */
export const MIN_POOL_EUR = 3000;

/** @param {string} signature */
const selectorOf = (signature) =>
	`0x${Buffer.from(keccak_256(new TextEncoder().encode(signature)))
		.toString('hex')
		.slice(0, 8)}`;

const SELECTOR = {
	getPair: '0xe6a43905',
	getPool: '0x1698ee82',
	balanceOf: '0x70a08231',
	token0: '0x0dfe1681',
	getReserves: '0x0902f1ac',
	slot0: '0x3850c7bd',
	liquidity: '0x1a686502',
	getSlot0: selectorOf('getSlot0(bytes32)'),
	getLiquidity: selectorOf('getLiquidity(bytes32)')
};

const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO = `0x${'0'.repeat(40)}`;

/** @param {string} a */
const word = (a) => a.replace(/^0x/, '').padStart(64, '0');
/** @param {bigint} n */
const uint = (n) => n.toString(16).padStart(64, '0');
/** The n-th 32-byte word of an ABI answer. @param {string} hex @param {number} n */
const nth = (hex, n) => BigInt(`0x${hex.replace(/^0x/, '').slice(n * 64, (n + 1) * 64) || '0'}`);
/** An address in an ABI answer's first word. @param {string} hex */
const addressOf = (hex) => `0x${hex.replace(/^0x/, '').slice(24, 64)}`.toLowerCase();

/**
 * A Uniswap V4 pool's id: keccak256 of its key (currency0, currency1, fee,
 * tickSpacing, hooks), the currencies sorted by address.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} fee
 * @param {number} tickSpacing
 * @param {string} [hooks]
 */
export function v4PoolId(a, b, fee, tickSpacing, hooks = ZERO) {
	const [c0, c1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
	const key = word(c0) + word(c1) + uint(BigInt(fee)) + uint(BigInt(tickSpacing)) + word(hooks);
	return `0x${Buffer.from(keccak_256(Buffer.from(key, 'hex'))).toString('hex')}`;
}

/**
 * `value / 10^scale` as a decimal string without trailing zeros.
 *
 * @param {bigint} value
 * @param {number} scale
 */
export function decimalOf(value, scale) {
	const s = value.toString().padStart(scale + 1, '0');
	const out = `${s.slice(0, -scale)}.${s.slice(-scale)}`;
	return out.replace(/0+$/, '').replace(/\.$/, '');
}

/** A decimal string as `[value, scale]`. @param {string} d */
function scaled(d) {
	const [int, frac = ''] = d.split('.');
	return [BigInt(int + frac), frac.length];
}

/** A decimal string scaled by 10^18, cut after 18 places. @param {string} d */
const wei = (d) => {
	const [int, frac = ''] = d.split('.');
	return BigInt(int + frac.slice(0, 18).padEnd(18, '0'));
};

/**
 * @typedef {{ version: 2, tokenIsToken0: boolean, reserve0: bigint, reserve1: bigint } | { version: 3 | 4, tokenIsToken0: boolean, sqrtPriceX96: bigint }} PoolState
 */

/**
 * The quote per whole token at a pool's price, scaled by 10^18.
 *
 * @param {PoolState} pool
 * @param {number} decimals the token's
 * @param {number} [quoteDecimals] the quote's (WETH/ETH 18, USDC 6)
 * @returns {bigint}
 */
export function quotePerToken(pool, decimals, quoteDecimals = 18) {
	const up = 10n ** BigInt(decimals) * 10n ** 18n;
	const down = 10n ** BigInt(quoteDecimals);
	if (pool.version === 2) {
		const [token, quote] = pool.tokenIsToken0
			? [pool.reserve0, pool.reserve1]
			: [pool.reserve1, pool.reserve0];
		if (token === 0n) return 0n;
		return (quote * up) / (token * down);
	}
	// V3/V4: price = token1 per token0 in raw units = sqrtPriceX96² / 2^192.
	const p2 = pool.sqrtPriceX96 * pool.sqrtPriceX96;
	const q192 = 1n << 192n;
	if (p2 === 0n) return 0n;
	return pool.tokenIsToken0 ? (p2 * up) / (q192 * down) : (q192 * up) / (p2 * down);
}

/** ETH per whole token, in wei (a WETH-quoted pool). @param {PoolState} pool @param {number} decimals */
export const ethPerToken = (pool, decimals) => quotePerToken(pool, decimals, 18);

/**
 * A V3/V4 pool's virtual reserve of one side in raw units, from its active
 * liquidity: token0 = L·2^96/√P, token1 = L·√P/2^96.
 *
 * @param {bigint} liquidity
 * @param {bigint} sqrtPriceX96
 * @param {boolean} ofToken0
 */
export function virtualReserve(liquidity, sqrtPriceX96, ofToken0) {
	if (sqrtPriceX96 === 0n) return 0n;
	return ofToken0 ? (liquidity << 96n) / sqrtPriceX96 : (liquidity * sqrtPriceX96) >> 96n;
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetch]
 * @param {() => Promise<string | null>} options.alchemyKey
 * @param {(network: string) => string} [options.alchemyBaseUrl]
 * @param {number} [options.minEur]
 */
export function createDexRates({
	fetch: f = fetch,
	alchemyKey,
	alchemyBaseUrl = (network) => `https://${network}.g.alchemy.com/v2`,
	minEur = MIN_POOL_EUR
}) {
	/**
	 * The token's price in a quote at a block, from its deepest pool; null when
	 * there is no pool, no key, or none deep enough.
	 *
	 * @param {{ chain: string, contract: string, block: number, decimals: number, quoteEur: (quote: 'ETH' | 'USDC') => Promise<string | null> }} params
	 *   `quoteEur`: the quote's euro rate of the day, to weigh the pools
	 * @returns {Promise<{ price: string, quote: 'ETH' | 'USDC', pool: string, version: 2 | 3 | 4, block: number, at: string, depth: string } | null>}
	 */
	async function poolPrice({ chain, contract, block, decimals, quoteEur }) {
		const dex = Object.hasOwn(DEX_CHAINS, chain) ? DEX_CHAINS[chain] : null;
		const token = String(contract).toLowerCase();
		if (!dex || !ADDRESS.test(token) || !Number.isSafeInteger(block) || block <= 0) return null;
		if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
		const key = await alchemyKey().catch(() => null);
		if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return null;
		const url = `${alchemyBaseUrl(dex.network)}/${key}`;
		const tag = `0x${block.toString(16)}`;

		/** @param {string} to @param {string} data @returns {Promise<string>} */
		async function ethCall(to, data) {
			let res;
			try {
				res = await f(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'eth_call',
						params: [{ to, data }, tag]
					})
				});
			} catch {
				// The URL holds the key: the message names the host only.
				throw new Error(`${dex.network}.g.alchemy.com is not reachable`);
			}
			const body = await res.json().catch(() => null);
			if (!res.ok || body?.error || typeof body?.result !== 'string') {
				throw new Error(`${dex.network}.g.alchemy.com refused eth_call`);
			}
			return body.result;
		}

		const quotes = /** @type {const} */ ([
			{ symbol: 'ETH', erc20: dex.weth, v4: ZERO, decimals: 18 },
			{ symbol: 'USDC', erc20: dex.usdc, v4: dex.usdc, decimals: 6 }
		]);
		/** @type {Map<string, bigint | null>} quote → EUR per whole unit, scaled by 10^18 */
		const eurOf = new Map();
		/** @param {'ETH' | 'USDC'} q */
		const eurRate = async (q) => {
			if (!eurOf.has(q)) {
				const r = await quoteEur(q).catch(() => null);
				eurOf.set(q, typeof r === 'string' && /^\d+(\.\d+)?$/.test(r) ? wei(r) : null);
			}
			return eurOf.get(q) ?? null;
		};

		// Each pool's depth first; its price only for the one that counts.
		/** @type {{ pool: string, version: 2 | 3 | 4, quote: (typeof quotes)[number], depthRaw: bigint, state: () => Promise<PoolState> }[]} */
		const found = [];
		for (const q of quotes) {
			const v2 = addressOf(
				await ethCall(dex.v2Factory, SELECTOR.getPair + word(token) + word(q.erc20))
			);
			if (v2 !== ZERO) {
				found.push({
					pool: v2,
					version: 2,
					quote: q,
					depthRaw: nth(await ethCall(q.erc20, SELECTOR.balanceOf + word(v2)), 0),
					state: async () => {
						const tokenIsToken0 = addressOf(await ethCall(v2, SELECTOR.token0)) === token;
						const r = await ethCall(v2, SELECTOR.getReserves);
						return { version: 2, tokenIsToken0, reserve0: nth(r, 0), reserve1: nth(r, 1) };
					}
				});
			}
			for (const fee of V3_FEES) {
				const v3 = addressOf(
					await ethCall(
						dex.v3Factory,
						SELECTOR.getPool + word(token) + word(q.erc20) + uint(BigInt(fee))
					)
				);
				if (v3 === ZERO) continue;
				const tokenIsToken0 = addressOf(await ethCall(v3, SELECTOR.token0)) === token;
				const sqrt = nth(await ethCall(v3, SELECTOR.slot0), 0);
				const liquidity = nth(await ethCall(v3, SELECTOR.liquidity), 0);
				found.push({
					pool: v3,
					version: 3,
					quote: q,
					depthRaw: virtualReserve(liquidity, sqrt, !tokenIsToken0),
					state: async () => ({ version: 3, tokenIsToken0, sqrtPriceX96: sqrt })
				});
			}
			for (const [fee, spacing] of V4_TIERS) {
				const id = v4PoolId(token, q.v4, fee, spacing);
				const sqrt = nth(await ethCall(dex.v4StateView, SELECTOR.getSlot0 + id.slice(2)), 0);
				// An empty slot: no such pool.
				if (sqrt === 0n) continue;
				const liquidity = nth(
					await ethCall(dex.v4StateView, SELECTOR.getLiquidity + id.slice(2)),
					0
				);
				const tokenIsToken0 = BigInt(token) < BigInt(q.v4);
				found.push({
					pool: id,
					version: 4,
					quote: q,
					// The quote is the other currency.
					depthRaw: virtualReserve(liquidity, sqrt, !tokenIsToken0),
					state: async () => ({ version: 4, tokenIsToken0, sqrtPriceX96: sqrt })
				});
			}
		}

		let best = null;
		let bestEur = 0n;
		for (const c of found) {
			const rate = await eurRate(c.quote.symbol);
			if (rate === null) continue;
			// Euros on the quote side, scaled by 10^18.
			const eur = (c.depthRaw * rate) / 10n ** BigInt(c.quote.decimals);
			if (eur > bestEur) {
				best = c;
				bestEur = eur;
			}
		}
		if (!best || bestEur < BigInt(minEur) * 10n ** 18n) return null;
		const price = quotePerToken(await best.state(), decimals, best.quote.decimals);
		if (price <= 0n) return null;

		// When: the block's own time.
		let at = '';
		try {
			const res = await f(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_getBlockByNumber',
					params: [tag, false]
				})
			});
			const ts = Number(BigInt((await res.json())?.result?.timestamp ?? '0x0'));
			if (ts > 0) at = new Date(ts * 1000).toISOString().replace(/\.000Z$/, 'Z');
		} catch {
			at = '';
		}
		return {
			price: decimalOf(price, 18),
			quote: best.quote.symbol,
			pool: best.pool,
			version: best.version,
			block,
			at,
			depth: decimalOf(best.depthRaw, best.quote.decimals)
		};
	}

	return { poolPrice };
}

/**
 * EUR per token: ETH per token × EUR per ETH, as a decimal string with at
 * most 18 decimals (a token can be worth a millionth of a cent).
 *
 * @param {string} ethPerTokenDecimal
 * @param {string} eurPerEth
 */
export function multiplyRates(ethPerTokenDecimal, eurPerEth) {
	const [a, as] = scaled(ethPerTokenDecimal);
	const [b, bs] = scaled(eurPerEth);
	const product = a * b; // scale as + bs
	const scale = as + bs;
	const keep = 18;
	const value =
		scale > keep
			? (product + 5n * 10n ** BigInt(scale - keep - 1)) / 10n ** BigInt(scale - keep)
			: product * 10n ** BigInt(keep - scale);
	return decimalOf(value, keep);
}

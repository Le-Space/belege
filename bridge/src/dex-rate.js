// A token's rate from a DEX pool at the block of its booking (issue #163,
// step 3), for tokens CoinGecko does not price on that day. Read on chain
// through the Alchemy key (`pnpm setup:alchemy`), so it needs no further
// service; without a key there is no pool rate.
//
// How:
//   1. the token's pools against WETH: Uniswap V2 (`getPair`) and V3
//      (`getPool`, fee tiers 0.05 %, 0.3 %, 1 %), from the factories below;
//   2. at the booking's block, how much WETH each pool holds
//      (`WETH.balanceOf(pool)`); the deepest pool counts, and only when it
//      holds at least `minWeth` – a thin pool's price is easily bent;
//   3. its price at that block: V2 `getReserves`, V3 `slot0` (the square
//      root price); ETH per token;
//   4. times ETH's euro rate of the day (rates.js, CoinGecko or Kraken).
// Every call is an `eth_call` at that block, so the result can be recomputed
// by anyone: pool and block go with the rate.
//
// The contract addresses were checked against the chains on 2026-09-28
// (`getPair`/`getPool` of USDC/WETH give the well-known pools).

/**
 * @typedef {object} DexChain
 * @property {string} network Alchemy's network, the host's first label
 * @property {string} weth
 * @property {string} v2Factory Uniswap V2
 * @property {string} v3Factory Uniswap V3
 */

/** @type {Readonly<Record<string, DexChain>>} */
export const DEX_CHAINS = Object.freeze({
	ethereum: {
		network: 'eth-mainnet',
		weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
		v2Factory: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
		v3Factory: '0x1f98431c8ad98523631ae4a59f267346ea31f984'
	},
	base: {
		network: 'base-mainnet',
		weth: '0x4200000000000000000000000000000000000006',
		v2Factory: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6',
		v3Factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd'
	}
});

/** Uniswap V3's fee tiers, in hundredths of a basis point. */
const V3_FEES = [500, 3000, 10000];
/** The least WETH a pool must hold for its price to count: 2 ETH. */
export const MIN_WETH_WEI = 2n * 10n ** 18n;

const SELECTOR = {
	getPair: '0xe6a43905',
	getPool: '0x1698ee82',
	balanceOf: '0x70a08231',
	token0: '0x0dfe1681',
	getReserves: '0x0902f1ac',
	slot0: '0x3850c7bd'
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

/**
 * ETH per whole token at a pool's price, 18 decimals.
 *
 * @param {{ version: 2, tokenIsToken0: boolean, reserve0: bigint, reserve1: bigint } | { version: 3, tokenIsToken0: boolean, sqrtPriceX96: bigint }} pool
 * @param {number} decimals the token's
 * @returns {bigint} wei of ETH per whole token
 */
export function ethPerToken(pool, decimals) {
	const unit = 10n ** BigInt(decimals);
	if (pool.version === 2) {
		const [token, weth] = pool.tokenIsToken0
			? [pool.reserve0, pool.reserve1]
			: [pool.reserve1, pool.reserve0];
		if (token === 0n) return 0n;
		return (weth * unit) / token;
	}
	// V3: price = token1 per token0 in raw units = sqrtPriceX96² / 2^192.
	const p2 = pool.sqrtPriceX96 * pool.sqrtPriceX96;
	const q192 = 1n << 192n;
	if (p2 === 0n) return 0n;
	return pool.tokenIsToken0 ? (p2 * unit) / q192 : (q192 * unit) / p2;
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetch]
 * @param {() => Promise<string | null>} options.alchemyKey
 * @param {(network: string) => string} [options.alchemyBaseUrl]
 * @param {bigint} [options.minWeth]
 */
export function createDexRates({
	fetch: f = fetch,
	alchemyKey,
	alchemyBaseUrl = (network) => `https://${network}.g.alchemy.com/v2`,
	minWeth = MIN_WETH_WEI
}) {
	/**
	 * ETH per whole token at a block, with the pool it came from; null when
	 * there is no pool, no key, or none deep enough.
	 *
	 * @param {{ chain: string, contract: string, block: number, decimals: number }} params
	 * @returns {Promise<{ ethPerToken: string, pool: string, version: 2 | 3, block: number, at: string, wethInPool: string } | null>}
	 */
	async function poolPrice({ chain, contract, block, decimals }) {
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

		/** @type {{ address: string, version: 2 | 3 }[]} */
		const candidates = [];
		const v2 = addressOf(
			await ethCall(dex.v2Factory, SELECTOR.getPair + word(token) + word(dex.weth))
		);
		if (v2 !== ZERO) candidates.push({ address: v2, version: 2 });
		for (const fee of V3_FEES) {
			const v3 = addressOf(
				await ethCall(
					dex.v3Factory,
					SELECTOR.getPool + word(token) + word(dex.weth) + uint(BigInt(fee))
				)
			);
			if (v3 !== ZERO) candidates.push({ address: v3, version: 3 });
		}
		let best = null;
		let bestWeth = 0n;
		for (const c of candidates) {
			const weth = nth(await ethCall(dex.weth, SELECTOR.balanceOf + word(c.address)), 0);
			if (weth > bestWeth) {
				best = c;
				bestWeth = weth;
			}
		}
		if (!best || bestWeth < minWeth) return null;

		const tokenIsToken0 = addressOf(await ethCall(best.address, SELECTOR.token0)) === token;
		const state = await ethCall(
			best.address,
			best.version === 2 ? SELECTOR.getReserves : SELECTOR.slot0
		);
		const wei = ethPerToken(
			best.version === 2
				? { version: 2, tokenIsToken0, reserve0: nth(state, 0), reserve1: nth(state, 1) }
				: { version: 3, tokenIsToken0, sqrtPriceX96: nth(state, 0) },
			decimals
		);
		if (wei <= 0n) return null;

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
			ethPerToken: decimalOf(wei, 18),
			pool: best.address,
			version: best.version,
			block,
			at,
			wethInPool: decimalOf(bestWeth, 18)
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

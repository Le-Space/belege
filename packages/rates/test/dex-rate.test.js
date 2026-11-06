// A token's rate from its DEX pool at a block (issue #163, step 3). The chain
// is faked: an Alchemy endpoint that answers eth_call from a table, as strict
// as a node (unknown calls fail). Made-up tokens, pools and amounts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DEX_CHAINS,
	createDexRates,
	decimalOf,
	ethPerToken,
	multiplyRates,
	quotePerToken,
	v4PoolId,
	virtualReserve
} from '../src/dex-rate.js';
import { createRateService } from '../src/rates.js';

const KEY = 'test-key-1234';
const TOKEN = `0x${'5e'.repeat(20)}`;
const V2_PAIR = `0x${'a2'.repeat(20)}`;
const V3_POOL = `0x${'a3'.repeat(20)}`;
const USDC_PAIR = `0x${'c2'.repeat(20)}`;
const NATIVE = `0x${'0'.repeat(40)}`;
const eth = DEX_CHAINS.ethereum;
const E18 = 10n ** 18n;

const word = (/** @type {string} */ a) => a.replace(/^0x/, '').padStart(64, '0');
const uint = (/** @type {bigint} */ n) => n.toString(16).padStart(64, '0');
const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;

/**
 * A fake Alchemy: eth_call answered by `to|data`, at the one block asked.
 *
 * @param {Record<string, string>} calls `${to}|${data}` → result hex
 * @param {{ block?: number }} [opts]
 */
function fakeChain(calls, { block = 1000 } = {}) {
	/** @type {any[]} */
	const asked = [];
	/** @type {typeof fetch} */
	const f = async (input, init) => {
		const url = String(input);
		if (!url.startsWith(`https://eth-mainnet.g.alchemy.com/v2/${KEY}`)) {
			return new Response('{}', { status: 404 });
		}
		const body = JSON.parse(String(init?.body));
		asked.push(body);
		if (body.method === 'eth_getBlockByNumber') {
			return Response.json({ jsonrpc: '2.0', id: 1, result: { timestamp: '0x6a0d6b40' } });
		}
		if (body.method !== 'eth_call' || body.params[1] !== `0x${block.toString(16)}`) {
			return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no' } });
		}
		const { to, data } = body.params[0];
		const result = calls[`${to}|${data}`];
		if (result === undefined) {
			return Response.json({
				jsonrpc: '2.0',
				id: 1,
				error: { code: -32000, message: 'execution reverted' }
			});
		}
		return Response.json({ jsonrpc: '2.0', id: 1, result });
	};
	return { fetch: f, asked };
}

/**
 * What the factories and V4's StateView answer: the pools given, and "none"
 * (the zero address, an empty slot) for every other one.
 *
 * @param {{ v2?: string, v3?: Record<number, string>, usdcV2?: string, v4?: Record<string, { sqrt: bigint, liquidity: bigint }> }} [pools]
 *   `v4`: by pool id
 */
function factories({ v2 = V2_PAIR, v3 = {}, usdcV2 = '', v4 = {} } = {}) {
	/** @type {Record<string, string>} */
	const table = {};
	for (const [quote, pair] of [
		[eth.weth, v2],
		[eth.usdc, usdcV2]
	]) {
		table[`${eth.v2Factory}|0xe6a43905${word(TOKEN)}${word(quote)}`] = pair
			? `0x${word(pair)}`
			: ZERO_ADDRESS;
		for (const fee of [500, 3000, 10000]) {
			const pool = quote === eth.weth ? v3[fee] : '';
			table[`${eth.v3Factory}|0x1698ee82${word(TOKEN)}${word(quote)}${uint(BigInt(fee))}`] = pool
				? `0x${word(pool)}`
				: ZERO_ADDRESS;
		}
	}
	for (const quote of [NATIVE, eth.usdc]) {
		for (const [fee, spacing] of [
			[100, 1],
			[500, 10],
			[3000, 60],
			[10000, 200]
		]) {
			const id = v4PoolId(TOKEN, quote, fee, spacing);
			const pool = v4[id];
			table[`${eth.v4StateView}|0xc815641c${id.slice(2)}`] =
				`0x${uint(pool?.sqrt ?? 0n)}${uint(0n)}${uint(0n)}${uint(0n)}`;
			if (pool) table[`${eth.v4StateView}|0xfa6793d5${id.slice(2)}`] = `0x${uint(pool.liquidity)}`;
		}
	}
	return table;
}
const wethIn = (/** @type {string} */ pool, /** @type {bigint} */ wei) => ({
	[`${eth.weth}|0x70a08231${word(pool)}`]: `0x${uint(wei)}`
});
const usdcIn = (/** @type {string} */ pool, /** @type {bigint} */ units) => ({
	[`${eth.usdc}|0x70a08231${word(pool)}`]: `0x${uint(units)}`
});
/** The quotes' euro rates of the day, as rates.js hands them over. */
const quoteEur = async (/** @type {string} */ q) =>
	q === 'ETH' ? '2000' : q === 'USDC' ? '0.9' : null;

describe('the price of a pool', () => {
	test('V2: WETH reserve over token reserve, in either order', () => {
		// 1,000,000 tokens (18 decimals) against 10 WETH: 0.00001 ETH each.
		const reserveToken = 1_000_000n * E18;
		const reserveWeth = 10n * E18;
		const asToken0 = ethPerToken(
			{ version: 2, tokenIsToken0: true, reserve0: reserveToken, reserve1: reserveWeth },
			18
		);
		const asToken1 = ethPerToken(
			{ version: 2, tokenIsToken0: false, reserve0: reserveWeth, reserve1: reserveToken },
			18
		);
		assert.equal(decimalOf(asToken0, 18), '0.00001');
		assert.equal(asToken1, asToken0);
		// A token with 6 decimals: the same pool in whole units.
		assert.equal(
			decimalOf(
				ethPerToken(
					{
						version: 2,
						tokenIsToken0: true,
						reserve0: 1_000_000n * 10n ** 6n,
						reserve1: reserveWeth
					},
					6
				),
				18
			),
			'0.00001'
		);
	});

	test('V3: the square root price, in either order', () => {
		// price token1/token0 = 1/4 → sqrtPriceX96 = 2^96 / 2.
		const sqrt = (1n << 96n) / 2n;
		assert.equal(
			decimalOf(ethPerToken({ version: 3, tokenIsToken0: true, sqrtPriceX96: sqrt }, 18), 18),
			'0.25'
		);
		assert.equal(
			decimalOf(ethPerToken({ version: 3, tokenIsToken0: false, sqrtPriceX96: sqrt }, 18), 18),
			'4'
		);
	});

	test('a USDC pool: the quote has 6 decimals', () => {
		// 1,000,000 tokens against 5,000 USDC: 0.005 USDC each.
		const pool = /** @type {const} */ ({
			version: 2,
			tokenIsToken0: true,
			reserve0: 1_000_000n * E18,
			reserve1: 5_000n * 10n ** 6n
		});
		assert.equal(decimalOf(quotePerToken(pool, 18, 6), 18), '0.005');
		// V3/V4 the same way: price token1/token0 in raw units 4·10^-12 → 4 USDC per token.
		const sqrt = BigInt(Math.round(Math.sqrt(4e-12) * 2 ** 48)) << 48n;
		const four = Number(
			decimalOf(quotePerToken({ version: 4, tokenIsToken0: true, sqrtPriceX96: sqrt }, 18, 6), 18)
		);
		assert.ok(Math.abs(four - 4) < 1e-6);
	});

	test('V4: the pool id is the hash of its key; its virtual reserves', () => {
		// The key is sorted: the same id whichever currency comes first.
		assert.equal(v4PoolId(TOKEN, NATIVE, 3000, 60), v4PoolId(NATIVE, TOKEN, 3000, 60));
		assert.notEqual(v4PoolId(TOKEN, NATIVE, 3000, 60), v4PoolId(TOKEN, NATIVE, 500, 10));
		assert.match(v4PoolId(TOKEN, NATIVE, 3000, 60), /^0x[0-9a-f]{64}$/);
		// √P = 2 (price 4): L = 10 → 5 of token0, 20 of token1.
		const sqrt = 2n << 96n;
		assert.equal(virtualReserve(10n, sqrt, true), 5n);
		assert.equal(virtualReserve(10n, sqrt, false), 20n);
	});

	test('ETH per token times EUR per ETH, without floats', () => {
		assert.equal(multiplyRates('0.00001', '2000'), '0.02');
		const tiny = multiplyRates('0.000000333333333333', '1725.5434572557583');
		assert.equal(tiny, '0.000575181152418011');
		assert.ok(Math.abs(Number(tiny) - 0.000000333333333333 * 1725.5434572557583) < 1e-15);
	});
});

describe('the pool at a block', () => {
	const dex = (/** @type {typeof fetch} */ f) =>
		createDexRates({ fetch: f, alchemyKey: async () => KEY });
	const ask = { chain: 'ethereum', contract: TOKEN, block: 1000, decimals: 18, quoteEur };

	test('the deepest pool counts; its price at that block', async () => {
		const chain = fakeChain({
			...factories({ v3: { 3000: V3_POOL } }),
			...wethIn(V2_PAIR, 10n * E18),
			// The V3 pool: token1 = WETH, √P = 1 (a token per ETH), L = 3·10^18 → 3 ETH virtually.
			[`${V3_POOL}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V3_POOL}|0x3850c7bd`]: `0x${uint(1n << 96n)}${uint(0n)}`,
			[`${V3_POOL}|0x1a686502`]: `0x${uint(3n * E18)}`,
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(1_000_000n * E18)}${uint(10n * E18)}${uint(0n)}`
		});
		const price = await dex(chain.fetch).poolPrice(ask);
		assert.deepEqual(price, {
			price: '0.00001',
			quote: 'ETH',
			pool: V2_PAIR,
			version: 2,
			block: 1000,
			at: new Date(0x6a0d6b40 * 1000).toISOString().replace(/\.000Z$/, 'Z'),
			depth: '10'
		});
		// Every call at that block; the key only in the URL, never in a body.
		for (const body of chain.asked.filter((b) => b.method === 'eth_call')) {
			assert.equal(body.params[1], '0x3e8');
		}
		assert.ok(!JSON.stringify(chain.asked).includes(KEY));

		// More active liquidity in the V3 pool (30 ETH virtually): V3's price.
		const deeperV3 = fakeChain({
			...factories({ v3: { 3000: V3_POOL } }),
			...wethIn(V2_PAIR, 10n * E18),
			[`${V3_POOL}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V3_POOL}|0x3850c7bd`]: `0x${uint(1n << 96n)}${uint(0n)}`,
			[`${V3_POOL}|0x1a686502`]: `0x${uint(30n * E18)}`
		});
		const v3 = await dex(deeperV3.fetch).poolPrice(ask);
		assert.deepEqual([v3?.version, v3?.pool, v3?.price, v3?.depth], [3, V3_POOL, '1', '30']);
	});

	test('deeper in euros wins: a USDC pool over a thin WETH pool', async () => {
		// WETH pool: 2 ETH ≈ 4,000 €; USDC pool: 50,000 USDC ≈ 45,000 €.
		const chain = fakeChain({
			...factories({ usdcV2: USDC_PAIR }),
			...wethIn(V2_PAIR, 2n * E18),
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(1_000n * E18)}${uint(2n * E18)}${uint(0n)}`,
			...usdcIn(USDC_PAIR, 50_000n * 10n ** 6n),
			[`${USDC_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${USDC_PAIR}|0x0902f1ac`]: `0x${uint(10_000n * E18)}${uint(50_000n * 10n ** 6n)}${uint(0n)}`
		});
		const price = await dex(chain.fetch).poolPrice(ask);
		assert.equal(price?.quote, 'USDC');
		assert.equal(price?.pool, USDC_PAIR);
		assert.equal(price?.price, '5');
		assert.equal(price?.depth, '50000');
	});

	test('a V4 pool against native ETH, read through StateView', async () => {
		const id = v4PoolId(TOKEN, NATIVE, 3000, 60);
		// Native ETH (0x0) is currency0; price token/ETH = 4 → 0.25 ETH per token; √P = 2.
		// L = 10^19: 5 ETH virtually on the ETH side ≈ 10,000 €.
		const chain = fakeChain(
			factories({ v2: '', v4: { [id]: { sqrt: 2n << 96n, liquidity: 10n * E18 } } })
		);
		const price = await dex(chain.fetch).poolPrice(ask);
		assert.equal(price?.version, 4);
		assert.equal(price?.pool, id);
		assert.equal(price?.quote, 'ETH');
		assert.equal(price?.price, '0.25');
		assert.equal(price?.depth, '5');
	});

	test('a pool thinner than the floor, no pool, no key or another chain: none', async () => {
		// 1 ETH ≈ 2,000 €: below the floor.
		const thin = fakeChain({
			...factories(),
			...wethIn(V2_PAIR, E18),
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(1_000n * E18)}${uint(E18)}${uint(0n)}`
		});
		assert.equal(await dex(thin.fetch).poolPrice(ask), null);
		const none = fakeChain(factories({ v2: '' }));
		assert.equal(await dex(none.fetch).poolPrice(ask), null);
		// Without the quote's euro rate a pool cannot be weighed.
		const deep = fakeChain({
			...factories(),
			...wethIn(V2_PAIR, 10n * E18),
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(1_000n * E18)}${uint(10n * E18)}${uint(0n)}`
		});
		assert.equal(await dex(deep.fetch).poolPrice({ ...ask, quoteEur: async () => null }), null);
		const keyless = createDexRates({ fetch: thin.fetch, alchemyKey: async () => null });
		assert.equal(await keyless.poolPrice(ask), null);
		assert.equal(await dex(thin.fetch).poolPrice({ ...ask, chain: 'nyx' }), null);
	});
});

describe('the rate service with a pool', () => {
	test('CoinGecko knows no such contract: the pool at the block, times ETH', async () => {
		const chain = fakeChain({
			...factories(),
			...wethIn(V2_PAIR, 10n * E18),
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(eth.weth)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(10n * E18)}${uint(1_000_000n * E18)}${uint(0n)}`
		});
		/** @type {typeof fetch} */
		const coingecko = async (input) => {
			const url = String(input);
			if (url.includes('/contract/')) return new Response('{}', { status: 404 });
			if (url.includes('/coins/ethereum/history')) {
				return Response.json({ market_data: { current_price: { eur: 2000, usd: 2200 } } });
			}
			return new Response('{}', { status: 404 });
		};
		const rates = createRateService({
			fetch: coingecko,
			now: () => new Date('2026-09-28T10:00:00Z'),
			dex: createDexRates({ fetch: chain.fetch, alchemyKey: async () => KEY })
		});
		const r = await rates.rate('XYZ', '2026-05-02', {
			contract: TOKEN,
			chain: 'ethereum',
			block: 1000,
			decimals: 18
		});
		assert.equal(r.source, 'dex');
		assert.equal(r.rate, '0.02');
		assert.equal(r.ref, `uniswap-v2:${V2_PAIR}@1000`);
		// Without a block, as before: no rate.
		await assert.rejects(rates.rate('XYZ', '2026-05-02', { contract: TOKEN, chain: 'ethereum' }));
	});
});

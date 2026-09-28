// A token's rate from its DEX pool at a block (issue #163, step 3). The chain
// is faked: an Alchemy endpoint that answers eth_call from a table, as strict
// as a node (unknown calls fail). Made-up tokens, pools and amounts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DEX_CHAINS,
	MIN_WETH_WEI,
	createDexRates,
	decimalOf,
	ethPerToken,
	multiplyRates
} from '../src/dex-rate.js';
import { createRateService } from '../src/rates.js';

const KEY = 'test-key-1234';
const TOKEN = `0x${'5e'.repeat(20)}`;
const V2_PAIR = `0x${'a2'.repeat(20)}`;
const V3_POOL = `0x${'a3'.repeat(20)}`;
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

/** The factory answers: a V2 pair, and V3 pools only where given. */
function factories({ v2 = V2_PAIR, v3 = /** @type {Record<number, string>} */ ({}) } = {}) {
	/** @type {Record<string, string>} */
	const table = {
		[`${eth.v2Factory}|0xe6a43905${word(TOKEN)}${word(eth.weth)}`]: v2
			? `0x${word(v2)}`
			: ZERO_ADDRESS
	};
	for (const fee of [500, 3000, 10000]) {
		table[`${eth.v3Factory}|0x1698ee82${word(TOKEN)}${word(eth.weth)}${uint(BigInt(fee))}`] = v3[
			fee
		]
			? `0x${word(v3[fee])}`
			: ZERO_ADDRESS;
	}
	return table;
}
const wethIn = (/** @type {string} */ pool, /** @type {bigint} */ wei) => ({
	[`${eth.weth}|0x70a08231${word(pool)}`]: `0x${uint(wei)}`
});

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

	test('the deepest WETH pool counts; its price at that block', async () => {
		const chain = fakeChain({
			...factories({ v3: { 3000: V3_POOL } }),
			...wethIn(V2_PAIR, 10n * E18),
			...wethIn(V3_POOL, 3n * E18),
			[`${V2_PAIR}|0x0dfe1681`]: `0x${word(TOKEN)}`,
			[`${V2_PAIR}|0x0902f1ac`]: `0x${uint(1_000_000n * E18)}${uint(10n * E18)}${uint(0n)}`
		});
		const price = await dex(chain.fetch).poolPrice({
			chain: 'ethereum',
			contract: TOKEN,
			block: 1000,
			decimals: 18
		});
		assert.deepEqual(price, {
			ethPerToken: '0.00001',
			pool: V2_PAIR,
			version: 2,
			block: 1000,
			at: new Date(0x6a0d6b40 * 1000).toISOString().replace(/\.000Z$/, 'Z'),
			wethInPool: '10'
		});
		// Every call at that block; the key only in the URL, never in a body.
		for (const body of chain.asked.filter((b) => b.method === 'eth_call')) {
			assert.equal(body.params[1], '0x3e8');
		}
		assert.ok(!JSON.stringify(chain.asked).includes(KEY));
	});

	test('a pool thinner than the floor, no pool, no key or another chain: none', async () => {
		const thin = fakeChain({ ...factories(), ...wethIn(V2_PAIR, MIN_WETH_WEI - 1n) });
		assert.equal(
			await dex(thin.fetch).poolPrice({
				chain: 'ethereum',
				contract: TOKEN,
				block: 1000,
				decimals: 18
			}),
			null
		);
		const none = fakeChain(factories({ v2: '' }));
		assert.equal(
			await dex(none.fetch).poolPrice({
				chain: 'ethereum',
				contract: TOKEN,
				block: 1000,
				decimals: 18
			}),
			null
		);
		const keyless = createDexRates({ fetch: thin.fetch, alchemyKey: async () => null });
		assert.equal(
			await keyless.poolPrice({ chain: 'ethereum', contract: TOKEN, block: 1000, decimals: 18 }),
			null
		);
		assert.equal(
			await dex(thin.fetch).poolPrice({ chain: 'nyx', contract: TOKEN, block: 1000, decimals: 18 }),
			null
		);
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

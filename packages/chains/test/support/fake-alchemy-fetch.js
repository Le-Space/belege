// SPDX-License-Identifier: AGPL-3.0-or-later
// A fake Alchemy as a fetch, without a server, so it runs in a browser too
// (test/browser/scenario.js): a short made-up Ethereum history of one wallet
// with a token the chain does not list (#93), and a poisoning contract's
// fake transfer "from" the wallet. It answers only what the
// reader asks for such a history; every address, hash and amount is made up.

const hex = (/** @type {number | bigint} */ n) => `0x${n.toString(16)}`;
const pad = (/** @type {string} */ s) => s.repeat(40 / s.length);

export const TOKENS_WALLET = `0x${pad('a1')}`;
const FRIEND = `0x${pad('b2')}`;
const SHOP = `0x${pad('c3')}`;
/** A token not in the list, which the wallet sends on: booked by its contract. */
export const XYZ = `0x${pad('5e')}`;
/** A token the wallet only received (an airdrop): not booked unless named. */
export const DROP = `0x${pad('d7')}`;
/** A token calling itself USDC: never booked, named or not. */
export const FAKE_USDC = `0x${pad('fa')}`;
/**
 * Address poisoning: a contract that emits a transfer "from" the wallet in a
 * transaction someone else sent. The wallet never sent it: not booked.
 */
export const POISON = `0x${pad('9e')}`;
const SPAMMER = `0x${pad('e4')}`;

const T0 = Date.parse('2026-10-01T10:00:00Z') / 1000;
const time = (/** @type {number} */ block) => new Date((T0 + block * 3600) * 1000).toISOString();
const txHash = (/** @type {string} */ s) => `0x${s.repeat(64 / s.length)}`;

/** @type {{ hash: string, block: number, from: string, to: string, value: bigint, gasUsed: bigint, gasPrice: bigint, logs: { i: number, contract: string, symbol: string, decimals: number, from: string, to: string, value: bigint }[] }[]} */
const TXS = [
	{
		hash: txHash('01'),
		block: 10,
		from: FRIEND,
		to: TOKENS_WALLET,
		value: 500_000_000_000_000_000n,
		gasUsed: 21000n,
		gasPrice: 1_000_000_000n,
		logs: []
	},
	{
		hash: txHash('02'),
		block: 20,
		from: FRIEND,
		to: XYZ,
		value: 0n,
		gasUsed: 50000n,
		gasPrice: 1_000_000_000n,
		logs: [
			{
				i: 0,
				contract: XYZ,
				symbol: 'XYZ',
				decimals: 18,
				from: FRIEND,
				to: TOKENS_WALLET,
				value: 300n * 10n ** 18n
			},
			{
				i: 1,
				contract: DROP,
				symbol: 'DROP',
				decimals: 6,
				from: FRIEND,
				to: TOKENS_WALLET,
				value: 5_000_000n
			}
		]
	},
	{
		hash: txHash('03'),
		block: 30,
		from: TOKENS_WALLET,
		to: XYZ,
		value: 0n,
		gasUsed: 60000n,
		gasPrice: 2_000_000_000n,
		logs: [
			{
				i: 3,
				contract: XYZ,
				symbol: 'XYZ',
				decimals: 18,
				from: TOKENS_WALLET,
				to: SHOP,
				value: 100n * 10n ** 18n
			}
		]
	},
	{
		hash: txHash('04'),
		block: 40,
		from: FRIEND,
		to: FAKE_USDC,
		value: 0n,
		gasUsed: 50000n,
		gasPrice: 1_000_000_000n,
		logs: [
			{
				i: 0,
				contract: FAKE_USDC,
				symbol: 'USDC',
				decimals: 6,
				from: FRIEND,
				to: TOKENS_WALLET,
				value: 9_000_000n
			}
		]
	},
	{
		hash: txHash('05'),
		block: 45,
		from: SPAMMER,
		to: POISON,
		value: 0n,
		gasUsed: 70000n,
		gasPrice: 1_000_000_000n,
		logs: [
			{
				i: 0,
				contract: POISON,
				symbol: 'ERC',
				decimals: 18,
				from: TOKENS_WALLET,
				to: SPAMMER,
				value: 1400n * 10n ** 18n
			}
		]
	}
];
const HEAD = 50;
const SENT_GAS = 60000n * 2_000_000_000n;
const BALANCES = /** @type {Record<string, bigint>} */ ({
	native: 500_000_000_000_000_000n - SENT_GAS,
	[XYZ]: 200n * 10n ** 18n,
	[DROP]: 5_000_000n,
	[FAKE_USDC]: 9_000_000n
});

/** Every transfer in Alchemy's shape. */
function transfers() {
	/** @type {any[]} */
	const out = [];
	for (const t of TXS) {
		const common = {
			blockNum: hex(t.block),
			hash: t.hash,
			metadata: { blockTimestamp: time(t.block) }
		};
		if (t.value > 0n) {
			out.push({
				...common,
				uniqueId: `${t.hash}:external`,
				category: 'external',
				from: t.from,
				to: t.to,
				asset: 'ETH',
				rawContract: { value: hex(t.value), address: null, decimal: '0x12' }
			});
		}
		for (const l of t.logs) {
			out.push({
				...common,
				uniqueId: `${t.hash}:log:${l.i}`,
				category: 'erc20',
				from: l.from,
				to: l.to,
				asset: l.symbol,
				rawContract: { value: hex(l.value), address: l.contract, decimal: hex(l.decimals) }
			});
		}
	}
	return out;
}

/** @param {string} method @param {any[]} params */
function answer(method, params) {
	const byHash = (/** @type {string} */ h) => TXS.find((t) => t.hash === h);
	switch (method) {
		case 'eth_chainId':
			return '0x1';
		case 'eth_blockNumber':
			return hex(HEAD);
		case 'eth_getTransactionCount': {
			const at = Number(BigInt(params[1]));
			return hex(TXS.filter((t) => t.from === TOKENS_WALLET && t.block <= at).length);
		}
		case 'alchemy_getAssetTransfers': {
			const q = params[0];
			const list = transfers().filter((t) =>
				q.fromAddress ? t.from === q.fromAddress : t.to === q.toAddress
			);
			return { transfers: list };
		}
		case 'eth_getTransactionByHash': {
			const t = byHash(params[0]);
			return t
				? { hash: t.hash, from: t.from, to: t.to, value: hex(t.value), gasPrice: hex(t.gasPrice) }
				: null;
		}
		case 'eth_getTransactionReceipt': {
			const t = byHash(params[0]);
			return t
				? {
						status: '0x1',
						blockNumber: hex(t.block),
						transactionIndex: '0x0',
						gasUsed: hex(t.gasUsed),
						effectiveGasPrice: hex(t.gasPrice)
					}
				: null;
		}
		case 'eth_getBalance':
			return hex(params[0] === TOKENS_WALLET ? BALANCES.native : 0n);
		case 'alchemy_getTokenBalances':
			return {
				address: params[0],
				tokenBalances: params[1].map((/** @type {string} */ c) => ({
					contractAddress: c,
					tokenBalance: hex(params[0] === TOKENS_WALLET ? (BALANCES[c] ?? 0n) : 0n)
				}))
			};
		default:
			throw new Error(`the fake does not answer ${method}`);
	}
}

/**
 * The fake as a fetch; every alchemy_getTokenBalances call's contracts are
 * kept in `asked`, so a test can see which balances were read.
 */
export function fakeAlchemyFetch() {
	/** @type {string[][]} */
	const asked = [];
	/** @type {typeof fetch} */
	const f = async (_input, init) => {
		const body = JSON.parse(String(init?.body));
		const calls = Array.isArray(body) ? body : [body];
		const results = calls.map((c) => {
			if (c.method === 'alchemy_getTokenBalances') asked.push(c.params[1]);
			return { jsonrpc: '2.0', id: c.id, result: answer(c.method, c.params) };
		});
		return new Response(JSON.stringify(Array.isArray(body) ? results : results[0]), {
			headers: { 'content-type': 'application/json' }
		});
	};
	return { fetch: f, asked };
}

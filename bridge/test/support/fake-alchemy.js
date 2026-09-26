// A fake Alchemy on 127.0.0.1 for tests: JSON-RPC over POST
// `/<network>/v2/<key>`, single calls and batches, as strict as the real one
// about what it is asked (method names, the number and types of parameters:
// a string where a boolean belongs is refused) and answering in its shapes:
// hex quantities, `uniqueId`s, `rawContract`, errors as
// `{ code, message }` with HTTP 401 (key), 403 (network not enabled for
// the app), 429 (compute units per second).
//
// It serves a made-up chain (`evmChain`), which `blockscoutView` also turns
// into the lists a fake Blockscout serves (fake-chains.js), so one history
// can be read through both. Every address, hash and amount is made up.
import http from 'node:http';

import { EVM, fakeEvmAddress, fakeHash } from './fake-chains.js';

/** @typedef {{ trace: string, index: string, from: string, to: string, value: bigint }} FakeInternal */
/** @typedef {{ logIndex: number, contract: string, from: string, to: string, value: bigint }} FakeLog */
/**
 * @typedef {object} FakeTx
 * @property {string} hash
 * @property {number} block
 * @property {number} index position in the block
 * @property {string} from
 * @property {string | null} to
 * @property {bigint} value
 * @property {bigint} gasUsed
 * @property {bigint} gasPrice the effective one
 * @property {boolean} ok
 * @property {boolean} [preByzantium] its receipt carries no `status`
 * @property {FakeInternal[]} internal Alchemy's trace address and Blockscout's index of each
 * @property {FakeLog[]} logs ERC-20 Transfer events
 */

/** The networks the fake knows, with the chain id each answers. */
export const NETWORKS = /** @type {const} */ ({
	'eth-mainnet': { chainId: 1, internal: true },
	'base-mainnet': { chainId: 8453, internal: true },
	'arb-mainnet': { chainId: 42161, internal: false },
	'opt-mainnet': { chainId: 10, internal: false },
	'polygon-mainnet': { chainId: 137, internal: true }
});

/** A key of the right form, made up. */
export const FAKE_ALCHEMY_KEY = 'fakeAlchemyKey_0123456789abcdef';

export const blockTime = (/** @type {number} */ block) =>
	Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000) + (block - 100) * 12;

/**
 * @param {Partial<FakeTx> & { seed: string, block: number, from: string }} t
 * @returns {FakeTx}
 */
export function fakeTx({ seed, ...t }) {
	return {
		hash: fakeHash(seed, true),
		index: 0,
		to: null,
		value: 0n,
		gasUsed: 21000n,
		gasPrice: 1_000_000_000n,
		ok: true,
		internal: [],
		logs: [],
		...t
	};
}

/**
 * A made-up history of EVM.wallet: ETH and USDC in and out, a failed send,
 * an approval (gas, nothing moved), ETH from a contract (two internal
 * transfers in one transaction), a token that calls itself USDC, a USDC
 * transfer out of the wallet in someone else's transaction (transferFrom),
 * two identical USDC transfers in one transaction, and a claim the wallet
 * sent that only brought something in.
 *
 * @param {{ fillerTransfers?: number }} [options] this many more incoming USDC transfers
 * @returns {FakeTx[]}
 */
export function evmChain({ fillerTransfers = 0 } = {}) {
	const w = EVM.wallet;
	const spender = fakeEvmAddress('a spender contract');
	/** @type {FakeTx[]} */
	const txs = [
		fakeTx({ seed: 'a-eth-in', block: 100, from: EVM.friend, to: w, value: 500000000000000000n }),
		fakeTx({
			seed: 'a-usdc-in',
			block: 150,
			index: 2,
			from: EVM.friend,
			to: EVM.usdc,
			logs: [{ logIndex: 7, contract: EVM.usdc, from: EVM.friend, to: w, value: 750000000n }]
		}),
		fakeTx({
			seed: 'a-usdc-out',
			block: 200,
			from: w,
			to: EVM.usdc,
			gasUsed: 50000n,
			gasPrice: 2_000_000_000n,
			logs: [{ logIndex: 3, contract: EVM.usdc, from: w, to: EVM.exchange, value: 300000000n }]
		}),
		fakeTx({
			seed: 'a-approve',
			block: 220,
			from: w,
			to: EVM.usdc,
			gasUsed: 46000n
		}),
		fakeTx({
			seed: 'a-spam',
			block: 250,
			from: EVM.friend,
			to: EVM.spamToken,
			logs: [
				{ logIndex: 0, contract: EVM.spamToken, from: EVM.friend, to: w, value: 1000000000000n }
			]
		}),
		fakeTx({
			seed: 'a-failed',
			block: 300,
			from: w,
			to: EVM.friend,
			value: 100000000000000000n,
			gasPrice: 3_000_000_000n,
			ok: false
		}),
		fakeTx({
			seed: 'a-pulled',
			block: 350,
			from: spender,
			to: EVM.usdc,
			logs: [{ logIndex: 1, contract: EVM.usdc, from: w, to: spender, value: 5000000n }]
		}),
		fakeTx({
			seed: 'a-eth-out',
			block: 400,
			index: 1,
			from: w,
			to: EVM.friend,
			value: 100000000000000000n
		}),
		fakeTx({
			seed: 'a-contract-pays',
			block: 500,
			from: EVM.friend,
			to: EVM.contract,
			internal: [
				{ trace: '3_0', index: '1', from: EVM.contract, to: w, value: 20000000000000000n },
				{ trace: '0_3_0', index: '3', from: EVM.contract, to: w, value: 5000000000000000n }
			]
		}),
		fakeTx({
			seed: 'a-twice',
			block: 600,
			from: EVM.friend,
			to: EVM.usdc,
			logs: [
				{ logIndex: 4, contract: EVM.usdc, from: EVM.friend, to: w, value: 1000000n },
				{ logIndex: 9, contract: EVM.usdc, from: EVM.friend, to: w, value: 1000000n }
			]
		}),
		fakeTx({
			seed: 'a-claim',
			block: 700,
			from: w,
			to: EVM.contract,
			gasUsed: 80000n,
			logs: [{ logIndex: 2, contract: EVM.usdc, from: EVM.contract, to: w, value: 2000000n }]
		})
	];
	for (let i = 0; i < fillerTransfers; i++) {
		txs.push(
			fakeTx({
				seed: `a-filler-${i}`,
				block: 1000 + Math.floor(i / 3),
				index: i % 3,
				from: EVM.friend,
				to: EVM.usdc,
				logs: [{ logIndex: 0, contract: EVM.usdc, from: EVM.friend, to: w, value: 1n }]
			})
		);
	}
	return txs;
}

/**
 * The same chain as Blockscout's lists (for startFakeBlockscout): txlist,
 * txlistinternal (its index), tokentx (without a log index, as Blockscout).
 *
 * @param {FakeTx[]} txs
 */
export function blockscoutView(txs) {
	const time = (/** @type {number} */ b) => String(blockTime(b));
	return {
		normal: txs.map((t) => ({
			blockNumber: String(t.block),
			timeStamp: time(t.block),
			hash: t.hash,
			transactionIndex: String(t.index),
			from: t.from,
			to: t.to ?? '',
			value: String(t.value),
			gas: '100000',
			gasUsed: String(t.gasUsed),
			gasPrice: String(t.gasPrice),
			isError: t.ok ? '0' : '1',
			txreceipt_status: t.ok ? '1' : '0'
		})),
		internal: txs
			.filter((t) => t.ok)
			.flatMap((t) =>
				t.internal.map((i) => ({
					blockNumber: String(t.block),
					timeStamp: time(t.block),
					transactionHash: t.hash,
					index: i.index,
					from: i.from,
					to: i.to,
					value: String(i.value),
					isError: '0',
					type: 'call'
				}))
			),
		tokens: txs
			.filter((t) => t.ok)
			.flatMap((t) =>
				t.logs.map((l) => ({
					blockNumber: String(t.block),
					timeStamp: time(t.block),
					hash: t.hash,
					transactionIndex: String(t.index),
					from: l.from,
					to: l.to,
					value: String(l.value),
					contractAddress: l.contract,
					tokenSymbol: 'USDC',
					tokenDecimal: '6'
				}))
			)
	};
}

const hex = (/** @type {bigint | number} */ n) => `0x${n.toString(16)}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const TRANSFER_KEYS = new Set([
	'fromBlock',
	'toBlock',
	'fromAddress',
	'toAddress',
	'contractAddresses',
	'category',
	'order',
	'withMetadata',
	'excludeZeroValue',
	'maxCount',
	'pageKey'
]);
const CATEGORIES = new Set(['external', 'internal', 'erc20', 'erc721', 'erc1155', 'specialnft']);

class RpcError extends Error {
	/** @param {number} code @param {string} message */
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}
const invalid = (/** @type {string} */ nth, /** @type {string} */ why) =>
	new RpcError(-32602, `invalid ${nth} argument: ${why}`);

/**
 * @param {object} [options]
 * @param {FakeTx[]} [options.txs]
 * @param {string} [options.key] the only key it accepts
 * @param {Record<string, bigint>} [options.balances] `native` and contract (lower case) → units, of EVM.wallet
 * @param {string[]} [options.deniedNetworks] answer 403, as for a network not enabled for the app
 * @param {number} [options.rateLimitedRequests] this many HTTP requests answer 429 first
 * @param {number} [options.rateLimitedItems] this many batch items answer error 429 (in a 200) first
 * @param {Record<string, number>} [options.chainIds] a network answering another chain id
 * @param {boolean} [options.listFailedExternal] list the value of a reverted transaction as a
 *   transfer (not seen at Alchemy, but not ruled out either)
 */
export async function startFakeAlchemy({
	txs = evmChain(),
	key = FAKE_ALCHEMY_KEY,
	balances = { native: 310000000000000000n, [EVM.usdc]: 450000000n },
	deniedNetworks = [],
	rateLimitedRequests = 0,
	rateLimitedItems = 0,
	listFailedExternal = false,
	chainIds = {}
} = {}) {
	/** @type {{ network: string, method: string, params: any, url: string }[]} */
	const calls = [];
	/** @type {string[]} every request path, to look for the key */
	const paths = [];
	let limitedRequests = rateLimitedRequests;
	let limitedItems = rateLimitedItems;
	/** @type {Map<string, { filter: any, offset: number }>} */
	const pages = new Map();
	let pageSeq = 0;
	const head = Math.max(...txs.map((t) => t.block), 100) + 10;
	const byHash = new Map(txs.map((t) => [t.hash, t]));
	const sorted = [...txs].sort((a, b) => a.block - b.block || a.index - b.index);
	/** @param {FakeTx} t @param {string} from */
	const nonceOf = (t, from) => sorted.filter((s) => s.from === from).indexOf(t);

	/** @param {unknown} tag @param {string} nth */
	function blockOf(tag, nth) {
		if (tag === 'latest') return head;
		if (typeof tag !== 'string' || !QUANTITY.test(tag)) throw invalid(nth, 'invalid block tag');
		return Number(BigInt(tag));
	}

	/** @param {FakeTx} t */
	const txObject = (t) => ({
		hash: t.hash,
		blockNumber: hex(t.block),
		blockHash: fakeHash(`block ${t.block}`, true),
		transactionIndex: hex(t.index),
		from: t.from,
		to: t.to,
		value: hex(t.value),
		nonce: hex(nonceOf(t, t.from)),
		gas: hex(100000),
		gasPrice: hex(t.gasPrice),
		input: '0x',
		type: '0x2'
	});
	/** @param {FakeTx} t */
	const receiptObject = (t) => ({
		transactionHash: t.hash,
		blockNumber: hex(t.block),
		transactionIndex: hex(t.index),
		from: t.from,
		to: t.to,
		...(t.preByzantium
			? { root: fakeHash(`root ${t.hash}`, true) }
			: { status: t.ok ? '0x1' : '0x0' }),
		gasUsed: hex(t.gasUsed),
		cumulativeGasUsed: hex(t.gasUsed),
		effectiveGasPrice: hex(t.gasPrice),
		logs: [],
		type: '0x2'
	});

	/**
	 * Every transfer on the chain, in Alchemy's shape, oldest first.
	 * @param {string} network
	 */
	function transfersOf(network) {
		const iso = (/** @type {number} */ b) => new Date(blockTime(b) * 1000).toISOString();
		/** @type {any[]} */
		const out = [];
		for (const t of sorted) {
			// A reverted transaction moved nothing – at most its value is listed anyway.
			if (!t.ok && !(listFailedExternal && t.value > 0n)) continue;
			const common = {
				blockNum: hex(t.block),
				hash: t.hash,
				erc721TokenId: null,
				erc1155Metadata: null,
				tokenId: null,
				metadata: { blockTimestamp: iso(t.block) }
			};
			{
				out.push({
					...common,
					uniqueId: `${t.hash}:external`,
					from: t.from,
					to: t.to,
					value: Number(t.value) / 1e18,
					asset: 'ETH',
					category: 'external',
					rawContract: { value: hex(t.value), address: null, decimal: '0x12' }
				});
			}
			if (!t.ok) continue;
			if (NETWORKS[/** @type {keyof typeof NETWORKS} */ (network)].internal) {
				for (const i of t.internal) {
					out.push({
						...common,
						uniqueId: `${t.hash}:internal:${i.trace}`,
						from: i.from,
						to: i.to,
						value: Number(i.value) / 1e18,
						asset: 'ETH',
						category: 'internal',
						rawContract: { value: hex(i.value), address: null, decimal: '0x12' }
					});
				}
			}
			for (const l of t.logs) {
				out.push({
					...common,
					uniqueId: `${t.hash}:log:${l.logIndex}`,
					from: l.from,
					to: l.to,
					value: Number(l.value) / 1e6,
					// What the token says about itself: the spam token, too, calls itself USDC.
					asset: 'USDC',
					category: 'erc20',
					rawContract: { value: hex(l.value), address: l.contract, decimal: '0x6' }
				});
			}
		}
		return out;
	}

	/** @param {string} network @param {any[]} params */
	function assetTransfers(network, params) {
		if (!Array.isArray(params) || params.length !== 1) {
			throw new RpcError(-32602, 'expected 1 argument');
		}
		const p = params[0];
		if (!p || typeof p !== 'object' || Array.isArray(p)) throw invalid('1st', 'not an object');
		for (const k of Object.keys(p)) {
			if (!TRANSFER_KEYS.has(k)) throw invalid('1st', `unknown field ${k}`);
		}
		if (!Array.isArray(p.category) || !p.category.length) {
			throw invalid('1st', 'category is required');
		}
		for (const c of p.category) {
			if (typeof c !== 'string' || !CATEGORIES.has(c)) throw invalid('1st', `bad category ${c}`);
		}
		if (
			p.category.includes('internal') &&
			!NETWORKS[/** @type {keyof typeof NETWORKS} */ (network)].internal
		) {
			throw new RpcError(
				-32602,
				'internal category is only supported for ETH, MATIC and BASE mainnets'
			);
		}
		for (const k of ['withMetadata', 'excludeZeroValue']) {
			if (k in p && typeof p[k] !== 'boolean') throw invalid('1st', `${k} must be a boolean`);
		}
		for (const k of ['fromAddress', 'toAddress']) {
			if (k in p && (typeof p[k] !== 'string' || !ADDRESS.test(p[k]))) {
				throw invalid('1st', `${k} is not an address`);
			}
		}
		for (const k of ['fromBlock', 'toBlock']) {
			if (k in p) blockOf(p[k], '1st');
		}
		if ('maxCount' in p) {
			if (typeof p.maxCount !== 'string' || !QUANTITY.test(p.maxCount)) {
				throw invalid('1st', 'maxCount must be a hex string');
			}
			if (BigInt(p.maxCount) > 1000n) throw invalid('1st', 'maxCount must be at most 0x3e8');
		}
		if ('order' in p && p.order !== 'asc' && p.order !== 'desc') {
			throw invalid('1st', 'order must be asc or desc');
		}
		if ('pageKey' in p && typeof p.pageKey !== 'string') {
			throw invalid('1st', 'pageKey must be a string');
		}
		const max = Number(BigInt(p.maxCount ?? '0x3e8'));
		let offset = 0;
		if (p.pageKey) {
			const page = pages.get(p.pageKey);
			if (!page) throw new RpcError(-32602, 'invalid pageKey');
			offset = page.offset;
		}
		const from = String(p.fromAddress ?? '').toLowerCase();
		const to = String(p.toAddress ?? '').toLowerCase();
		const fromBlock = blockOf(p.fromBlock ?? '0x0', '1st');
		const toBlock = blockOf(p.toBlock ?? 'latest', '1st');
		const excludeZero = p.excludeZeroValue ?? true;
		let list = transfersOf(network).filter(
			(t) =>
				p.category.includes(t.category) &&
				(!from || t.from === from) &&
				(!to || t.to === to) &&
				Number(BigInt(t.blockNum)) >= fromBlock &&
				Number(BigInt(t.blockNum)) <= toBlock &&
				!(excludeZero && BigInt(t.rawContract.value) === 0n)
		);
		if (p.order === 'desc') list = list.reverse();
		const slice = list.slice(offset, offset + max).map((t) => {
			if (p.withMetadata) return t;
			const { metadata: _m, ...rest } = t;
			return rest;
		});
		/** @type {any} */
		const result = { transfers: slice };
		if (offset + max < list.length) {
			const pageKey = `fake-page-${++pageSeq}`;
			pages.set(pageKey, { filter: p, offset: offset + max });
			result.pageKey = pageKey;
		}
		return result;
	}

	/** @param {string} network @param {string} method @param {any} params */
	function answer(network, method, params) {
		if (!Array.isArray(params)) throw new RpcError(-32602, 'params must be an array');
		const exact = (/** @type {number} */ n) => {
			if (params.length !== n) throw new RpcError(-32602, `expected ${n} argument(s)`);
		};
		switch (method) {
			case 'eth_chainId':
				exact(0);
				return hex(
					chainIds[network] ?? NETWORKS[/** @type {keyof typeof NETWORKS} */ (network)].chainId
				);
			case 'eth_blockNumber':
				exact(0);
				return hex(head);
			case 'eth_getBalance': {
				exact(2);
				if (typeof params[0] !== 'string' || !ADDRESS.test(params[0]))
					throw invalid('1st', 'not an address');
				blockOf(params[1], '2nd');
				return hex(params[0].toLowerCase() === EVM.wallet ? (balances.native ?? 0n) : 0n);
			}
			case 'eth_getTransactionCount': {
				exact(2);
				if (typeof params[0] !== 'string' || !ADDRESS.test(params[0]))
					throw invalid('1st', 'not an address');
				const at = blockOf(params[1], '2nd');
				const who = params[0].toLowerCase();
				return hex(txs.filter((t) => t.from === who && t.block <= at).length);
			}
			case 'eth_getTransactionByHash':
			case 'eth_getTransactionReceipt': {
				exact(1);
				if (typeof params[0] !== 'string' || !HASH.test(params[0]))
					throw invalid('1st', 'not a hash');
				const t = byHash.get(params[0].toLowerCase());
				if (!t) return null;
				return method === 'eth_getTransactionByHash' ? txObject(t) : receiptObject(t);
			}
			case 'eth_getBlockByNumber': {
				exact(2);
				const at = blockOf(params[0], '1st');
				if (typeof params[1] !== 'boolean') throw invalid('2nd', 'must be a boolean');
				if (at > head) return null;
				const inBlock = sorted.filter((t) => t.block === at);
				return {
					number: hex(at),
					hash: fakeHash(`block ${at}`, true),
					timestamp: hex(blockTime(at)),
					transactions: params[1] ? inBlock.map(txObject) : inBlock.map((t) => t.hash)
				};
			}
			case 'alchemy_getTokenBalances': {
				if (params.length < 1 || params.length > 3)
					throw new RpcError(-32602, 'expected 1 to 3 arguments');
				if (typeof params[0] !== 'string' || !ADDRESS.test(params[0]))
					throw invalid('1st', 'not an address');
				const spec = params[1] ?? 'erc20';
				if (!Array.isArray(spec) && !['erc20', 'NATIVE_TOKEN', 'DEFAULT_TOKENS'].includes(spec)) {
					throw invalid('2nd', 'token spec');
				}
				if (Array.isArray(spec) && spec.some((c) => typeof c !== 'string' || !ADDRESS.test(c))) {
					throw invalid('2nd', 'not an address');
				}
				const mine = params[0].toLowerCase() === EVM.wallet;
				const contracts = Array.isArray(spec)
					? spec
					: Object.keys(balances).filter((k) => k !== 'native');
				return {
					address: params[0].toLowerCase(),
					tokenBalances: contracts.map((c) => ({
						contractAddress: c.toLowerCase(),
						tokenBalance: `0x${(mine ? (balances[c.toLowerCase()] ?? 0n) : 0n).toString(16).padStart(64, '0')}`
					}))
				};
			}
			case 'alchemy_getAssetTransfers':
				return assetTransfers(network, params);
			default:
				throw new RpcError(-32601, `Unsupported method: ${method}.`);
		}
	}

	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(body === undefined ? '' : JSON.stringify(body));
			};
			paths.push(req.url ?? '');
			const m = /^\/([a-z-]+)\/v2\/([^/?#]*)$/.exec(req.url ?? '');
			if (!m || !(m[1] in NETWORKS)) return send(404, { message: 'Not found' });
			const [, network, given] = m;
			if (req.method !== 'POST') return send(405, { message: 'Method not allowed' });
			if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
				return send(415, { message: 'Unsupported media type' });
			}
			let body;
			try {
				body = JSON.parse(raw);
			} catch {
				return send(400, {
					jsonrpc: '2.0',
					id: null,
					error: { code: -32700, message: 'Parse error' }
				});
			}
			const id = Array.isArray(body) ? null : (body?.id ?? null);
			if (given !== key) {
				return send(401, {
					jsonrpc: '2.0',
					id,
					error: { code: -32600, message: 'Must be authenticated!' }
				});
			}
			if (deniedNetworks.includes(network)) {
				return send(403, {
					jsonrpc: '2.0',
					id,
					error: {
						code: -32600,
						message: `${network.toUpperCase()} is not enabled for this app. Visit this page to enable the network: https://dashboard.alchemy.com/apps/fakeapp/networks`
					}
				});
			}
			if (limitedRequests > 0) {
				limitedRequests--;
				return send(429, {
					jsonrpc: '2.0',
					id,
					error: {
						code: 429,
						message: 'Your app has exceeded its compute units per second capacity.'
					}
				});
			}
			const one = (/** @type {any} */ item) => {
				const itemId = item?.id ?? null;
				if (
					!item ||
					item.jsonrpc !== '2.0' ||
					typeof item.method !== 'string' ||
					!(typeof itemId === 'number' || typeof itemId === 'string')
				) {
					return {
						jsonrpc: '2.0',
						id: itemId,
						error: { code: -32600, message: 'Invalid request' }
					};
				}
				calls.push({ network, method: item.method, params: item.params, url: req.url ?? '' });
				if (limitedItems > 0) {
					limitedItems--;
					return {
						jsonrpc: '2.0',
						id: itemId,
						error: {
							code: 429,
							message: 'Your app has exceeded its compute units per second capacity.'
						}
					};
				}
				try {
					return {
						jsonrpc: '2.0',
						id: itemId,
						result: answer(network, item.method, item.params ?? [])
					};
				} catch (/** @type {any} */ error) {
					if (!(error instanceof RpcError)) throw error;
					return {
						jsonrpc: '2.0',
						id: itemId,
						error: { code: error.code, message: error.message }
					};
				}
			};
			if (Array.isArray(body)) {
				if (!body.length || body.length > 1000) {
					return send(400, {
						jsonrpc: '2.0',
						id: null,
						error: { code: -32600, message: 'Invalid batch size' }
					});
				}
				// Answers come back in any order: the fake reverses them.
				return send(200, body.map(one).reverse());
			}
			const single = one(body);
			return send(200, single);
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	const url = `http://127.0.0.1:${port}`;
	return {
		url,
		baseUrl: (/** @type {string} */ network) => `${url}/${network}/v2`,
		calls,
		paths,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}

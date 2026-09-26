// An EVM wallet read through Alchemy, when a key is set up (`pnpm
// setup:alchemy`). Blockscout without a key answers only a few requests per
// half hour and IP address; Alchemy with a (free) key many more.
//
// The key goes into the request URL to Alchemy and nowhere else: not into a
// log line, an error message, an answer to the app. Messages name the host
// (`eth-mainnet.g.alchemy.com`), never the path that holds the key.
//
// What is asked, all JSON-RPC over POST to https://<network>.g.alchemy.com/v2/<key>:
//   eth_chainId                 the endpoint serves the chain it is meant for
//   alchemy_getAssetTransfers   fromAddress, then toAddress (both at once
//                               would mean "from AND to"), categories
//                               external + erc20 (+ internal where Alchemy
//                               offers it: Ethereum, Base, Polygon), oldest
//                               first, 1000 a page, pageKey paging
//   eth_getTransactionByHash +  for every transaction a transfer names this
//   eth_getTransactionReceipt   address as its sender: who sent it (a token
//                               can leave by transferFrom in someone else's
//                               transaction), its nonce, and the gas it
//                               cost: gasUsed × effectiveGasPrice;
//                               for value received, the receipt only: a
//                               reverted transaction books nothing
//   eth_blockNumber,            what the transfers cannot show: a transaction
//   eth_getTransactionCount,    this address sent that moved nothing (it
//   eth_getBlockByNumber        failed, or was an approval). The nonce counts
//                               every one of them; where the count rises in
//                               a block no known transaction explains, that
//                               block is fetched and its transaction found.
//   eth_getBalance,             the balance, native and of the listed tokens
//   alchemy_getTokenBalances
// Several calls go as one batch (a JSON array, at most 50).
//
// Alchemy counts compute units (CU) per call – in a batch each call its own
// – and a free app gets 300 CU a second, over a 10-second token bucket
// (docs: reference/compute-unit-costs, reference/throughput). The reader
// spends at most `computeUnitsPerSecond` (250 by default, below the free
// limit) and waits before a call that would spend more. Calls Alchemy still
// refuses with 429 – the key's budget is shared with anything else using it
// – are sent again, only they, after 1, 2, 4, 8, 16 and 16 seconds.
//
// The result has the shape of Blockscout's lists (txlist, txlistinternal,
// tokentx), so evm.js turns both into entries the same way and gives the same
// transfer the same id whichever source read it (docs/crypto.md): the value
// `<hash>:value`, the gas `<hash>:fee`, a token transfer
// `<hash>:erc20:<contract>:<from>:<to>:<value>:<n>` (Blockscout's tokentx has
// no log index, so neither id uses it). An internal transfer is the one
// exception: Blockscout numbers it by its place among all of the
// transaction's calls, Alchemy by its trace address among those that moved
// value – `<hash>:internal:<index>` against `<hash>:internal:trace:<address>`.
// The app pairs the two (wallets/wallet-sync.js, reconcileSourceIds), so a
// change of source books nothing twice.

import { createJsonFetcher, WalletError } from './http.js';

const PAGE = '0x3e8'; // 1000, Alchemy's most
const BATCH = 50; // Alchemy: "aim for batches under 50"
const SPLIT = 16; // a block range with an unexplained nonce is cut into this many parts

/** Compute units per call (Alchemy's table); a method not named costs 20. */
const COMPUTE_UNITS = /** @type {Record<string, number>} */ ({
	eth_chainId: 0,
	eth_blockNumber: 10,
	alchemy_getAssetTransfers: 120
});
/** @param {string} method */
export const computeUnitsOf = (method) => COMPUTE_UNITS[method] ?? 20;
const BURST_SECONDS = 4; // spent ahead at most; Alchemy's bucket holds 10 seconds
const LIMIT_ROUNDS = 7; // the first try and six more for calls refused with 429

/** @param {string} network */
export const alchemyBaseUrl = (network) => `https://${network}.g.alchemy.com/v2`;

/** What a key looks like: letters, digits, _ and -. Anything else is not sent anywhere. */
export const isAlchemyKey = (/** @type {unknown} */ key) =>
	typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);

const HEX = /^0x[0-9a-fA-F]+$/;

/** @param {unknown} v @returns {bigint} */
function big(v) {
	if (typeof v !== 'string' || !HEX.test(v)) {
		throw new WalletError('Alchemy answered a number that is none', 'WALLET_DATA');
	}
	return BigInt(v);
}

/** @param {unknown} v */
const dec = (v) => big(v).toString();

/** @param {unknown} iso @returns {string} seconds */
function secondsOf(iso) {
	const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
	if (!Number.isFinite(ms)) throw new WalletError('a transfer without a time', 'WALLET_DATA');
	return String(Math.floor(ms / 1000));
}

/** @param {unknown} v */
const lowerAddress = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.maxPages] per direction
 * @param {number} [options.maxHiddenBlocks] blocks fetched for transactions the transfers do not show
 * @param {number} [options.computeUnitsPerSecond] spent at most (Alchemy free: 300)
 * @param {() => number} [options.now] milliseconds (tests: a clock that `sleep` moves)
 */
export function createAlchemyReader({
	fetch: f = fetch,
	timeoutMs,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	maxPages = 50,
	maxHiddenBlocks = 300,
	computeUnitsPerSecond = 250,
	now = Date.now
} = {}) {
	// HTTP 429 is waited out below, with the calls refused inside a batch.
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep, retries: 1 });
	const burstUnits = computeUnitsPerSecond * BURST_SECONDS;

	// The budget as a token bucket kept by time: `due` is when all that was
	// spent is paid back; a call may go while that is at most BURST_SECONDS ahead.
	let due = 0;
	/** @param {number} units */
	async function spend(units) {
		const start = Math.max(due, now());
		due = start + (units / computeUnitsPerSecond) * 1000;
		const wait = due - now() - BURST_SECONDS * 1000;
		if (wait > 0) await sleep(Math.ceil(wait));
	}
	/** Alchemy refused: its bucket is empty, whatever this one thinks. */
	const drained = () => {
		due = Math.max(due, now() + BURST_SECONDS * 1000);
	};
	/** @param {number} round 1… */
	const backoff = (round) =>
		Math.min(1000 * 2 ** (round - 1), 16_000) + Math.floor(Math.random() * 250);

	/**
	 * Alchemy's refusals, in words that carry no key and no address.
	 *
	 * @param {any} error
	 * @param {string} key
	 */
	function explain(error, key) {
		if (!(error instanceof WalletError)) return error;
		const scrub = (/** @type {string} */ text) =>
			text
				.split(key)
				.join('…')
				.replace(/https?:\/\/\S+/g, '…')
				.replace(/0x[0-9a-fA-F]{8,}/g, '0x…')
				.slice(0, 100);
		if (error.code === 'WALLET_RATE_LIMIT') {
			return new WalletError(
				'Alchemy limits requests (compute units per second used up); try again in a minute',
				'WALLET_ALCHEMY_RATE_LIMIT',
				429
			);
		}
		if (error.httpStatus === 401) {
			return new WalletError(
				'Alchemy refused the API key: run `pnpm setup:alchemy` again',
				'WALLET_ALCHEMY_AUTH'
			);
		}
		if (error.httpStatus === 403) {
			const said = scrub(String(/** @type {any} */ (error.body)?.error?.message ?? ''));
			return new WalletError(
				`Alchemy refused access${said ? ` (${said})` : ''}: is the network enabled for this app in the Alchemy dashboard?`,
				'WALLET_ALCHEMY_DENIED'
			);
		}
		if (error.code === 'WALLET_ALCHEMY') error.message = scrub(error.message);
		return error;
	}

	/**
	 * @param {any} rpcError
	 * @param {string} method
	 */
	function rpcFailure(rpcError, method) {
		const code = Number(rpcError?.code);
		const message = String(rpcError?.message ?? '');
		if (code === -32600 && /authenticated|access key/i.test(message)) {
			return new WalletError(
				'Alchemy refused the API key: run `pnpm setup:alchemy` again',
				'WALLET_ALCHEMY_AUTH'
			);
		}
		const words = message.replace(/0x[0-9a-fA-F]{8,}/g, '0x…').slice(0, 80);
		return new WalletError(
			`Alchemy refused ${method} (${Number.isFinite(code) ? code : '?'}${words ? `: ${words}` : ''})`,
			'WALLET_ALCHEMY'
		);
	}

	/**
	 * @param {string} url
	 * @param {string} key
	 * @param {{ method: string, params: unknown[] }[]} calls
	 * @returns {Promise<any[]>} the results, in the order of the calls
	 */
	async function batch(url, key, calls) {
		/** @type {any[]} */
		const results = [];
		// Chunks of at most BATCH calls and at most the burst in compute units.
		/** @type {number[][]} indexes into calls */
		const chunks = [];
		let units = Infinity;
		calls.forEach((c, i) => {
			const cost = computeUnitsOf(c.method);
			const last = chunks[chunks.length - 1];
			if (!last || last.length >= BATCH || units + cost > burstUnits) {
				chunks.push([i]);
				units = cost;
			} else {
				last.push(i);
				units += cost;
			}
		});
		for (const chunk of chunks) {
			/** @type {number[]} */
			let pending = chunk;
			for (let round = 0; pending.length; round++) {
				if (round >= LIMIT_ROUNDS)
					throw explain(new WalletError('limited', 'WALLET_RATE_LIMIT'), key);
				if (round > 0) await sleep(backoff(round));
				await spend(pending.reduce((sum, i) => sum + computeUnitsOf(calls[i].method), 0));
				const body = pending.map((i) => ({ jsonrpc: '2.0', id: i + 1, ...calls[i] }));
				let answer;
				try {
					answer = await getJson(url, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body.length === 1 ? body[0] : body)
					});
				} catch (error) {
					if (/** @type {any} */ (error)?.code === 'WALLET_RATE_LIMIT') {
						drained();
						continue;
					}
					throw explain(error, key);
				}
				const items = Array.isArray(answer) ? answer : [answer];
				if (pending.length > 1 && !Array.isArray(answer)) {
					// A batch refused as a whole answers one error object.
					if (answer?.error?.code === 429) {
						drained();
						continue;
					}
					throw explain(rpcFailure(answer?.error, calls[pending[0]].method), key);
				}
				/** @type {Map<number, any>} */
				const byId = new Map(items.map((item) => [Number(item?.id), item]));
				/** @type {number[]} */
				const refused = [];
				for (const i of pending) {
					const item = byId.get(i + 1);
					if (!item) {
						throw new WalletError(`Alchemy left ${calls[i].method} unanswered`, 'WALLET_ALCHEMY');
					}
					if (item.error?.code === 429) refused.push(i);
					else if (item.error) throw explain(rpcFailure(item.error, calls[i].method), key);
					else results[i] = item.result;
				}
				if (refused.length) drained();
				pending = refused;
			}
		}
		return results;
	}

	/** @param {string} url @param {string} key @param {string} method @param {unknown[]} params */
	const call = async (url, key, method, params) => (await batch(url, key, [{ method, params }]))[0];

	/**
	 * @param {object} params
	 * @param {import('./registry.js').EvmChain} params.chain with `alchemy`
	 * @param {string} params.address lower case
	 * @param {string} params.key
	 * @param {string} params.baseUrl without the key, e.g. https://eth-mainnet.g.alchemy.com/v2
	 * @param {() => Promise<any[]>} [params.blockscoutInternal] internal transactions where
	 *   Alchemy has none (Arbitrum, Optimism)
	 */
	async function read({ chain, address, key, baseUrl, blockscoutInternal }) {
		if (!isAlchemyKey(key)) {
			throw new WalletError(
				'the stored Alchemy key has an unexpected form: run `pnpm setup:alchemy` again',
				'WALLET_ALCHEMY_AUTH'
			);
		}
		const network = /** @type {import('./registry.js').AlchemyNetwork} */ (chain.alchemy);
		const url = `${baseUrl}/${key}`;

		const chainId = await call(url, key, 'eth_chainId', []);
		if (typeof chainId !== 'string' || !HEX.test(chainId)) {
			throw new WalletError(
				'Alchemy does not say which chain it serves',
				'WALLET_CHAIN_UNVERIFIED'
			);
		}
		if (BigInt(chainId) !== BigInt(chain.chainId)) {
			throw new WalletError(
				`Alchemy serves chain ${BigInt(chainId)}, not ${chain.name} (${chain.chainId})`,
				'WALLET_WRONG_CHAIN',
				400
			);
		}

		// Every transfer from and to the address, each once (to itself: in both lists).
		const categories = ['external', 'erc20', ...(network.internal ? ['internal'] : [])];
		/** @type {Map<string, any>} */
		const transfers = new Map();
		for (const direction of ['fromAddress', 'toAddress']) {
			let pageKey;
			for (let page = 0; ; page++) {
				if (page >= maxPages) {
					throw new WalletError(`more than ${maxPages * 1000} transfers`, 'WALLET_TOO_MANY');
				}
				const result = await call(url, key, 'alchemy_getAssetTransfers', [
					{
						fromBlock: '0x0',
						toBlock: 'latest',
						[direction]: address,
						category: categories,
						withMetadata: true,
						excludeZeroValue: true,
						maxCount: PAGE,
						order: 'asc',
						...(pageKey ? { pageKey } : {})
					}
				]);
				if (!Array.isArray(result?.transfers)) {
					throw new WalletError('alchemy_getAssetTransfers without a list', 'WALLET_ALCHEMY');
				}
				for (const t of result.transfers) {
					const hash = lowerAddress(t?.hash);
					if (!/^0x[0-9a-f]{64}$/.test(hash)) {
						throw new WalletError('a transfer without a hash', 'WALLET_DATA');
					}
					const id =
						typeof t.uniqueId === 'string' && t.uniqueId
							? t.uniqueId
							: `${hash}:${t.category}:${t.from}:${t.to}:${t.rawContract?.value}`;
					transfers.set(id, t);
				}
				pageKey = typeof result.pageKey === 'string' && result.pageKey ? result.pageKey : null;
				if (!pageKey) break;
			}
		}
		const all = [...transfers.values()];

		// The transactions this address sent, as far as the transfers show them.
		/** @type {Map<string, string>} hash → block time in seconds */
		const timeOf = new Map();
		for (const t of all) timeOf.set(lowerAddress(t.hash), secondsOf(t.metadata?.blockTimestamp));
		const candidates = [
			...new Set(
				all.filter((t) => lowerAddress(t.from) === address).map((t) => lowerAddress(t.hash))
			)
		];
		/** @type {Map<string, { tx: any, receipt: any, time: string }>} */
		const sent = new Map();
		const answers = await batch(
			url,
			key,
			candidates.flatMap((hash) => [
				{ method: 'eth_getTransactionByHash', params: [hash] },
				{ method: 'eth_getTransactionReceipt', params: [hash] }
			])
		);
		candidates.forEach((hash, i) => {
			const tx = answers[2 * i];
			const receipt = answers[2 * i + 1];
			if (!tx || !receipt) {
				throw new WalletError('Alchemy does not know a transaction it listed', 'WALLET_ALCHEMY');
			}
			if (lowerAddress(tx.from) === address) {
				sent.set(hash, { tx, receipt, time: /** @type {string} */ (timeOf.get(hash)) });
			}
		});

		await findHidden({ url, key, address, sent });

		// Value received from someone else's transaction: whether it went through.
		// Alchemy was not seen to list a reverted one, but does not say it never does.
		const received = [
			...new Set(
				all
					.filter(
						(t) =>
							t.category === 'external' &&
							lowerAddress(t.to) === address &&
							!sent.has(lowerAddress(t.hash))
					)
					.map((t) => lowerAddress(t.hash))
			)
		];
		const receivedReceipts = await batch(
			url,
			key,
			received.map((hash) => ({ method: 'eth_getTransactionReceipt', params: [hash] }))
		);
		/** @type {Map<string, any>} */
		const receiptOf = new Map();
		received.forEach((hash, i) => {
			if (!receivedReceipts[i]) {
				throw new WalletError(
					'Alchemy has no receipt for a transaction it listed',
					'WALLET_ALCHEMY'
				);
			}
			receiptOf.set(hash, receivedReceipts[i]);
		});

		/**
		 * A receipt's outcome. Receipts from before Byzantium (Ethereum block
		 * 4 370 000, October 2017) carry no `status`: whether such a
		 * transaction went through is unknown here (Blockscout knows it from
		 * its traces). Its gas is booked – it was paid either way – its value
		 * is not, and the wallet's result counts it (`unknownStatus`).
		 *
		 * @param {any} receipt
		 * @returns {'ok' | 'failed' | 'unknown'}
		 */
		const outcome = (receipt) =>
			receipt.status === '0x1' ? 'ok' : receipt.status === '0x0' ? 'failed' : 'unknown';
		let unknownStatus = 0;

		/** @type {any[]} */
		const normal = [];
		for (const [hash, { tx, receipt, time }] of sent) {
			const state = outcome(receipt);
			if (state === 'unknown') unknownStatus++;
			const ok = state !== 'failed';
			normal.push({
				...(state === 'unknown' ? { statusUnknown: true } : {}),
				hash,
				blockNumber: dec(receipt.blockNumber),
				timeStamp: time,
				transactionIndex: dec(receipt.transactionIndex),
				from: address,
				to: lowerAddress(tx.to),
				value: dec(tx.value),
				gasUsed: dec(receipt.gasUsed),
				gasPrice: dec(receipt.effectiveGasPrice ?? tx.gasPrice),
				isError: ok ? '0' : '1',
				txreceipt_status: ok ? '1' : '0'
			});
		}
		/** @type {any[]} */
		const internal = [];
		/** @type {any[]} */
		const tokens = [];
		for (const t of all) {
			const hash = lowerAddress(t.hash);
			const base = {
				blockNumber: dec(t.blockNum),
				timeStamp: /** @type {string} */ (timeOf.get(hash)),
				from: lowerAddress(t.from),
				to: lowerAddress(t.to),
				value: dec(t.rawContract?.value)
			};
			if (t.category === 'external') {
				// Sent ones come from the transaction itself, above.
				const state = sent.has(hash) ? null : outcome(receiptOf.get(hash));
				if (state === 'unknown') unknownStatus++;
				if (state === 'ok') {
					normal.push({
						...base,
						hash,
						gasUsed: '0',
						gasPrice: '0',
						isError: '0',
						txreceipt_status: '1'
					});
				}
			} else if (t.category === 'internal') {
				const trace = /:internal:([0-9A-Za-z_,-]{1,64})$/.exec(String(t.uniqueId ?? ''))?.[1];
				internal.push({ ...base, transactionHash: hash, isError: '0', alchemyTrace: trace ?? '' });
			} else if (t.category === 'erc20') {
				const logIndex = /:logs?:(\d+)$/.exec(String(t.uniqueId ?? ''))?.[1];
				tokens.push({
					...base,
					hash,
					contractAddress: lowerAddress(t.rawContract?.address),
					// for the order only: the id is built without it, as from Blockscout
					position: logIndex ?? ''
				});
			}
		}
		if (!network.internal && blockscoutInternal) internal.push(...(await blockscoutInternal()));

		const contracts = Object.keys(chain.tokens);
		const [native, tokenBalances] = await batch(url, key, [
			{ method: 'eth_getBalance', params: [address, 'latest'] },
			{ method: 'alchemy_getTokenBalances', params: [address, contracts] }
		]);
		/** @type {Map<string, bigint>} contract (lower case) or `native` → units */
		const balances = new Map([['native', big(native)]]);
		for (const b of tokenBalances?.tokenBalances ?? []) {
			const contract = lowerAddress(b?.contractAddress);
			if (
				contracts.includes(contract) &&
				typeof b.tokenBalance === 'string' &&
				HEX.test(b.tokenBalance)
			) {
				balances.set(contract, BigInt(b.tokenBalance));
			}
		}
		return { normal, internal, tokens, balances, unknownStatus };
	}

	/**
	 * The transactions this address sent that no transfer shows: the nonce
	 * (eth_getTransactionCount) rises by one for each. A block range in which
	 * it rises more than the known transactions explain is cut into parts,
	 * the count asked at every cut in one batch, until single blocks are left;
	 * those are fetched and their transactions from this address taken.
	 *
	 * @param {object} params
	 * @param {string} params.url
	 * @param {string} params.key
	 * @param {string} params.address
	 * @param {Map<string, { tx: any, receipt: any, time: string }>} params.sent grows
	 */
	async function findHidden({ url, key, address, sent }) {
		const head = Number(big(await call(url, key, 'eth_blockNumber', [])));
		const total = Number(
			big(await call(url, key, 'eth_getTransactionCount', [address, `0x${head.toString(16)}`]))
		);
		/** @type {number[]} */
		const known = [...sent.values()]
			.map((s) => Number(big(s.receipt.blockNumber)))
			.filter((b) => b <= head)
			.sort((a, b) => a - b);
		const knownIn = (/** @type {number} */ lo, /** @type {number} */ hi) =>
			known.filter((b) => b > lo && b <= hi).length;

		/** @type {{ lo: number, hi: number, cLo: number, cHi: number }[]} ranges (lo, hi] */
		let ranges = [{ lo: 0, hi: head, cLo: 0, cHi: total }];
		/** @type {number[]} */
		const blocks = [];
		while (ranges.length) {
			/** @type {typeof ranges} */
			const open = [];
			for (const r of ranges) {
				if (r.cHi - r.cLo <= knownIn(r.lo, r.hi)) continue;
				if (r.hi - r.lo === 1) blocks.push(r.hi);
				else open.push(r);
			}
			if (blocks.length > maxHiddenBlocks) {
				throw new WalletError(
					`more than ${maxHiddenBlocks} blocks with transactions only the nonce shows`,
					'WALLET_TOO_MANY'
				);
			}
			/** @type {{ range: (typeof ranges)[number], cuts: number[] }[]} */
			const plans = open.map((range) => {
				const step = Math.max(1, Math.ceil((range.hi - range.lo) / SPLIT));
				/** @type {number[]} */
				const cuts = [];
				for (let b = range.lo + step; b < range.hi; b += step) cuts.push(b);
				return { range, cuts };
			});
			const counts = await batch(
				url,
				key,
				plans.flatMap((p) =>
					p.cuts.map((b) => ({
						method: 'eth_getTransactionCount',
						params: [address, `0x${b.toString(16)}`]
					}))
				)
			);
			let k = 0;
			ranges = [];
			for (const { range, cuts } of plans) {
				const points = [
					{ b: range.lo, c: range.cLo },
					...cuts.map((b) => ({ b, c: Number(big(counts[k++])) })),
					{ b: range.hi, c: range.cHi }
				];
				for (let i = 1; i < points.length; i++) {
					ranges.push({
						lo: points[i - 1].b,
						hi: points[i].b,
						cLo: points[i - 1].c,
						cHi: points[i].c
					});
				}
			}
		}
		if (!blocks.length) return;

		const fetched = await batch(
			url,
			key,
			blocks.map((b) => ({ method: 'eth_getBlockByNumber', params: [`0x${b.toString(16)}`, true] }))
		);
		/** @type {{ tx: any, time: string }[]} */
		const hidden = [];
		for (const block of fetched) {
			if (!Array.isArray(block?.transactions)) {
				throw new WalletError('Alchemy answered a block without transactions', 'WALLET_ALCHEMY');
			}
			const time = String(Number(big(block.timestamp)));
			for (const tx of block.transactions) {
				const hash = lowerAddress(tx?.hash);
				if (lowerAddress(tx?.from) === address && !sent.has(hash)) hidden.push({ tx, time });
			}
		}
		const receipts = await batch(
			url,
			key,
			hidden.map(({ tx }) => ({
				method: 'eth_getTransactionReceipt',
				params: [lowerAddress(tx.hash)]
			}))
		);
		hidden.forEach(({ tx, time }, i) => {
			if (!receipts[i]) {
				throw new WalletError('Alchemy has no receipt for a transaction', 'WALLET_ALCHEMY');
			}
			sent.set(lowerAddress(tx.hash), { tx, receipt: receipts[i], time });
		});
	}

	return { read };
}

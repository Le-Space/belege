// An EVM wallet (Ethereum, Base, Arbitrum, Optimism, Polygon), read only, by
// its address: ETH (or the chain's native coin) in and out, the ERC-20
// tokens listed in registry.js, and the gas it paid.
//
// Source: Blockscout's Etherscan-compatible API, no key needed, after its
// JSON-RPC proxy (`…/api/eth-rpc`, eth_chainId) has said it serves the chain:
//   module=account&action=txlist           normal transactions
//   module=account&action=txlistinternal   ETH a contract sent (a withdrawal
//                                          from an exchange's hot wallet contract, say)
//   module=account&action=tokentx          ERC-20 transfers
//   module=account&action=balance / tokenbalance
// Lists come oldest first, 1000 a page. Blockscout refuses page × offset
// beyond 10 000, so paging goes on by `startblock`: the next request starts
// at the last block seen, and what was seen twice is dropped.
//
// How a transaction becomes entries:
//   - gas: every transaction this address sent costs gasUsed × gasPrice,
//     also a failed one; an entry of its own (type fee). On rollups
//     (Optimism, Base, Arbitrum) the L1 data fee is not in this API and is
//     missing – see docs/wallets.md.
//   - a failed transaction (isError 1 or txreceipt_status 0) moved nothing
//     but its gas.
//   - value out or in: an entry sent or received; to itself: none.
//   - ERC-20: only the contracts listed for the chain, with the symbol and
//     decimals from the list, never from the token (anyone can deploy a
//     contract called "USDC"). Others are counted and left out as bookings,
//     but a swap names them (below).
//   - a swap (issue #115): in one transaction the wallet gives one asset and
//     gets another – a token to a router and ETH back as an internal
//     transfer, say. Its booked legs become kind `swap` and carry what went
//     each way (`swap.gave`, `swap.got`: symbol, amount, and whether the
//     token is a listed one – an unlisted symbol is the token's own claim)
//     and the router it went through, and the gas it cost (the gas entry
//     stays a fee of its own and names the swap). Known routers and WETH are named
//     (registry.js KNOWN_EVM_CONTRACTS).
//
// The log gets counts, never an address.
//
// With an Alchemy key (`pnpm setup:alchemy`) and no endpoint of the wallet's
// own, the lists come from Alchemy instead (alchemy.js), in the same shape,
// and become entries here in the same way.

import { keccak_256 } from '@noble/hashes/sha3.js';

import { KNOWN_EVM_CONTRACTS, addressUrl, txUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';
import { alchemyBaseUrl, createAlchemyReader } from './alchemy.js';

/** Symbols an unlisted token may never be booked under: the big ones a fake would copy. */
const LOOKALIKE_GUARD = [
	'ETH',
	'WETH',
	'USDC',
	'USDT',
	'DAI',
	'WBTC',
	'BTC',
	'POL',
	'MATIC',
	'EURC'
];

const PAGE = 1000;

/**
 * EIP-55: the mixed-case checksum of an address.
 *
 * @param {string} address 0x + 40 hex
 */
export function toChecksumAddress(address) {
	const hex = address.slice(2).toLowerCase();
	const hash = Buffer.from(keccak_256(new TextEncoder().encode(hex))).toString('hex');
	let out = '0x';
	for (let i = 0; i < 40; i++) {
		out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
	}
	return out;
}

/**
 * 0x + 40 hex; when it mixes cases, the EIP-55 checksum must hold (a typo
 * then shows). All lower or all upper case carries no checksum.
 *
 * @param {string} address
 */
export function isEvmAddress(address) {
	if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
	const body = address.slice(2);
	if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
	return toChecksumAddress(address) === address;
}

/** @param {unknown} v */
const bigintOf = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null);

/**
 * @param {unknown} seconds
 * @returns {string} ISO 8601
 */
function isoOf(seconds) {
	const n = Number(seconds);
	if (!Number.isFinite(n) || n <= 0)
		throw new WalletError('a transfer without a time', 'WALLET_DATA');
	return new Date(n * 1000).toISOString();
}

/**
 * The three lists → entries of `address` (lower case).
 *
 * @param {object} lists
 * @param {any[]} lists.normal
 * @param {any[]} lists.internal
 * @param {any[]} lists.tokens
 * @param {object} context
 * @param {string} context.address lower case
 * @param {import('./registry.js').EvmChain} context.chain
 * @returns {{ entries: import('./cosmos.js').WalletEntry[], unknownTokens: string[] }}
 */
export function normalizeEvm({ normal, internal, tokens }, { address, chain }) {
	/** @type {(import('./cosmos.js').WalletEntry & { order: string })[]} */
	const entries = [];
	/** @type {Set<string>} */
	const unknownTokens = new Set();
	const native = chain.native;
	/** @type {Map<string, number>} token transfers without a log index, counted per same transfer */
	const repeats = new Map();
	/** @type {Map<string, string>} hash → the contract the wallet called */
	const calledOf = new Map();
	/** @type {{ hash: string, asset: string, amount: string, listed: false }[]} own moves of unlisted tokens */
	const unlisted = [];
	/** @param {string} address @param {string} [fallback] */
	const known = (address, fallback = '') =>
		Object.hasOwn(KNOWN_EVM_CONTRACTS, address) ? KNOWN_EVM_CONTRACTS[address] : fallback;

	/**
	 * Ids stay what they are whatever else the lists hold (an internal
	 * transaction indexed late, a token listed later): the gas `<hash>:fee`,
	 * the value of the transaction `<hash>:value`, an internal transfer
	 * `<hash>:internal:<index>`, a token transfer `<hash>:log:<logIndex>` – or,
	 * where the API gives no log index (Blockscout's tokentx),
	 * `<hash>:erc20:<contract>:<from>:<to>:<value>:<n>`.
	 *
	 * @param {any} raw
	 * @param {string} hash
	 * @param {string} order sorts the entries: block, position, kind
	 * @param {string} id
	 * @param {Omit<import('./cosmos.js').WalletEntry, 'id' | 'hash' | 'height' | 'time' | 'date' | 'explorerUrl' | 'memo'>} e
	 */
	const push = (raw, hash, order, id, e) => {
		const time = isoOf(raw.timeStamp);
		entries.push({
			id,
			hash,
			height: Number(raw.blockNumber),
			time,
			date: time.slice(0, 10),
			memo: '',
			explorerUrl: txUrl(chain.explorer, hash),
			order,
			...e
		});
	};
	const hashOf = (/** @type {any} */ raw) => {
		const hash = String(raw?.hash ?? raw?.transactionHash ?? '').toLowerCase();
		if (!/^0x[0-9a-f]{64}$/.test(hash)) {
			throw new WalletError('a transaction without a hash', 'WALLET_DATA');
		}
		return hash;
	};
	const pad = (/** @type {unknown} */ n) => String(Number(n) || 0).padStart(12, '0');

	for (const raw of normal) {
		const hash = hashOf(raw);
		const from = String(raw.from ?? '').toLowerCase();
		const to = String(raw.to ?? '').toLowerCase();
		const failed = raw.isError === '1' || raw.txreceipt_status === '0';
		// Alchemy, a receipt from before Byzantium: no status, so no value; the gas was paid.
		const unknown = raw.statusUnknown === true;
		const order = `${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}`;
		if (from === address && !failed && to) calledOf.set(hash, to);
		if (from === address) {
			const gasUsed = bigintOf(raw.gasUsed);
			const gasPrice = bigintOf(raw.gasPrice);
			if (gasUsed === null || gasPrice === null) {
				throw new WalletError('a transaction without gas figures', 'WALLET_DATA');
			}
			const fee = gasUsed * gasPrice;
			if (fee > 0n) {
				push(raw, hash, `${order}:0`, `${hash}:fee`, {
					type: 'fee',
					kind: 'fee',
					asset: native.symbol,
					amount: unitsToDecimal(-fee, native.decimals),
					decimals: native.decimals,
					counterparty: '',
					counterpartyLabel: '',
					success: !failed
				});
			}
		}
		const value = bigintOf(raw.value) ?? 0n;
		if (failed || unknown || value === 0n || (from === address) === (to === address)) continue;
		const out = from === address;
		push(raw, hash, `${order}:1`, `${hash}:value`, {
			type: out ? 'sent' : 'received',
			kind: 'transfer',
			asset: native.symbol,
			amount: unitsToDecimal(out ? -value : value, native.decimals),
			decimals: native.decimals,
			counterparty: out ? to : from,
			counterpartyLabel: known(out ? to : from),
			success: true
		});
	}

	for (const raw of internal) {
		const hash = hashOf(raw);
		const from = String(raw.from ?? '').toLowerCase();
		const to = String(raw.to ?? '').toLowerCase();
		const value = bigintOf(raw.value) ?? 0n;
		if (raw.isError === '1' || value === 0n || (from === address) === (to === address)) continue;
		const out = from === address;
		const at = raw.index ?? raw.traceId;
		// Alchemy names an internal transfer by its trace address, which is not
		// Blockscout's index: a prefix of its own, so the two never collide.
		const internalId = raw.alchemyTrace
			? `${hash}:internal:trace:${raw.alchemyTrace}`
			: at !== undefined && at !== ''
				? `${hash}:internal:${at}`
				: `${hash}:internal:${from}:${to}:${value}`;
		push(
			raw,
			hash,
			`${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}:2:${pad(at)}`,
			internalId,
			{
				type: out ? 'sent' : 'received',
				kind: 'transfer',
				asset: native.symbol,
				amount: unitsToDecimal(out ? -value : value, native.decimals),
				decimals: native.decimals,
				counterparty: out ? to : from,
				counterpartyLabel: known(out ? to : from, 'Vertrag (interne Transaktion)'),
				success: true
			}
		);
	}

	// Tokens not in the list (issue #115): booked in an account of their own
	// once the wallet has sent them itself – an airdrop it never touched is
	// not booked. Never under a symbol that is a listed asset's or another
	// token's already (a contract can call itself anything): those stay out.
	const reserved = new Set([
		native.symbol,
		...Object.values(chain.tokens).map((t) => t.symbol),
		...LOOKALIKE_GUARD
	]);
	/** @type {Map<string, { symbol: string, decimals: number }>} contract → how it is booked */
	const used = new Map();
	/** @type {Set<string>} */
	const takenSymbols = new Set();
	for (const raw of tokens) {
		const contract = String(raw.contractAddress ?? '').toLowerCase();
		if (Object.hasOwn(chain.tokens, contract) || used.has(contract)) continue;
		if (String(raw.from ?? '').toLowerCase() !== address) continue;
		const symbol = String(raw.tokenSymbol ?? '').toUpperCase();
		const decimals = Number(raw.tokenDecimal);
		if (
			!/^[A-Z0-9]{2,10}$/.test(symbol) ||
			reserved.has(symbol) ||
			takenSymbols.has(symbol) ||
			!Number.isInteger(decimals) ||
			decimals < 0 ||
			decimals > 36
		) {
			continue;
		}
		used.set(contract, { symbol, decimals });
		takenSymbols.add(symbol);
	}

	for (const raw of tokens) {
		const hash = hashOf(raw);
		const contract = String(raw.contractAddress ?? '').toLowerCase();
		const listedToken = Object.hasOwn(chain.tokens, contract) ? chain.tokens[contract] : null;
		const token = listedToken ?? used.get(contract) ?? null;
		if (!token) {
			unknownTokens.add(contract);
			// Not booked, but a swap names it: symbol and decimals as the token
			// says (unverified), only for a transfer from or to this wallet.
			const from = String(raw.from ?? '').toLowerCase();
			const to = String(raw.to ?? '').toLowerCase();
			const value = bigintOf(raw.value) ?? 0n;
			const decimals = Number(raw.tokenDecimal);
			const symbol = String(raw.tokenSymbol ?? '')
				.replace(/[^\p{L}\p{N}._-]/gu, '')
				.slice(0, 12);
			if (
				value !== 0n &&
				(from === address) !== (to === address) &&
				Number.isInteger(decimals) &&
				decimals >= 0 &&
				decimals <= 36
			) {
				unlisted.push({
					hash,
					asset: symbol || '?',
					amount: unitsToDecimal(from === address ? -value : value, decimals),
					listed: false
				});
			}
			continue;
		}
		const from = String(raw.from ?? '').toLowerCase();
		const to = String(raw.to ?? '').toLowerCase();
		const value = bigintOf(raw.value) ?? 0n;
		if (value === 0n || (from === address) === (to === address)) continue;
		const out = from === address;
		let tokenId;
		if (raw.logIndex !== undefined && raw.logIndex !== '') {
			tokenId = `${hash}:log:${raw.logIndex}`;
		} else {
			const same = `${hash}:erc20:${contract}:${from}:${to}:${value}`;
			const n = repeats.get(same) ?? 0;
			repeats.set(same, n + 1);
			tokenId = `${same}:${n}`;
		}
		push(
			raw,
			hash,
			`${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}:3:${pad(raw.logIndex ?? raw.position)}`,
			tokenId,
			{
				type: out ? 'sent' : 'received',
				kind: 'transfer',
				asset: token.symbol,
				amount: unitsToDecimal(out ? -value : value, token.decimals),
				decimals: token.decimals,
				counterparty: out ? to : from,
				counterpartyLabel: known(out ? to : from),
				success: true,
				// Not in the list: priced by its contract, marked as the token's own claim.
				...(listedToken ? {} : { contract, listed: false })
			}
		);
	}

	markSwaps(entries, unlisted, (hash) => {
		const called = calledOf.get(hash) ?? '';
		return called ? known(called) : '';
	});

	entries.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
	const result = entries.map(({ order: _order, ...e }) => e);
	return { entries: result, unknownTokens: [...unknownTokens] };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxPages] per list
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {object} [options.alchemy]
 * @param {() => Promise<string | null>} options.alchemy.key the key, or null when none is set up
 * @param {(network: string) => string} [options.alchemy.baseUrl] tests: a fake on 127.0.0.1
 * @param {number} [options.alchemy.maxHiddenBlocks]
 * @param {number} [options.alchemy.computeUnitsPerSecond]
 * @param {() => number} [options.alchemy.now] tests: a clock that `sleep` moves
 */
export function createEvmClient({
	fetch: f = fetch,
	timeoutMs,
	maxPages = 50,
	sleep,
	alchemy
} = {}) {
	const alchemyReader = createAlchemyReader({
		fetch: f,
		timeoutMs,
		sleep,
		maxPages,
		maxHiddenBlocks: alchemy?.maxHiddenBlocks,
		computeUnitsPerSecond: alchemy?.computeUnitsPerSecond,
		now: alchemy?.now
	});
	const getJson = createJsonFetcher({
		fetch: f,
		timeoutMs,
		sleep,
		retries: 3
	});
	/** Blockscout says "rate limit" in a 200 as well. */
	const limited = (/** @type {any} */ b) =>
		b?.status === '0' && /rate limit|too many/i.test(`${b?.message ?? ''} ${b?.result ?? ''}`);

	/**
	 * @param {string} api
	 * @param {Record<string, string>} params
	 */
	async function call(api, params) {
		const body = await getJson(`${api}?${new URLSearchParams(params)}`, {}, { retryIf: limited });
		if (body?.status === '1' || body?.status === '2') return body.result;
		const message = String(body?.message ?? '');
		if (/no (transactions|token transfers|internal transactions|records) found/i.test(message))
			return [];
		if (/invalid address/i.test(message)) {
			throw new WalletError('the API refused the address', 'WALLET_ADDRESS', 400);
		}
		// Only the API's words: no address or hash (0x…) goes into a message, which the bridge logs.
		const words = message.replace(/0x[0-9a-fA-F]{8,}/g, '0x…').slice(0, 80);
		throw new WalletError(`the API answered: ${words || 'no result'}`, 'WALLET_NODE');
	}

	/**
	 * The API belongs to the chain it is meant for: Blockscout's JSON-RPC
	 * proxy (`…/api/eth-rpc`) names its chain id, as a Cosmos node names its
	 * network. Another chain, or no answer to that question, and nothing is read.
	 *
	 * @param {string} api
	 * @param {import('./registry.js').EvmChain} chain
	 */
	async function checkChain(api, chain) {
		let body;
		try {
			body = await getJson(`${api}/eth-rpc`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
			});
		} catch (/** @type {any} */ error) {
			if (error?.code !== 'WALLET_NODE') throw error;
			body = null;
		}
		const id =
			typeof body?.result === 'string' && /^0x[0-9a-f]+$/i.test(body.result)
				? BigInt(body.result)
				: null;
		if (id === null) {
			throw new WalletError(
				'the API does not say which chain it serves (no eth_chainId at …/api/eth-rpc)',
				'WALLET_CHAIN_UNVERIFIED'
			);
		}
		if (id !== BigInt(chain.chainId)) {
			throw new WalletError(
				`the API serves chain ${id}, not ${chain.name} (${chain.chainId})`,
				'WALLET_WRONG_CHAIN',
				400
			);
		}
	}

	/**
	 * @param {string} api
	 * @param {string} action
	 * @param {string} address
	 * @param {(raw: any, counts: Map<string, number>) => string} keyOf `counts` is per page:
	 *   pages overlap by a block, and what repeats there must get the same key
	 */
	async function list(api, action, address, keyOf) {
		/** @type {Map<string, any>} */
		const seen = new Map();
		let startblock = 0;
		for (let page = 0; ; page++) {
			if (page >= maxPages) {
				throw new WalletError(`more than ${maxPages * PAGE} ${action} entries`, 'WALLET_TOO_MANY');
			}
			const batch = await call(api, {
				module: 'account',
				action,
				address,
				startblock: String(startblock),
				endblock: '999999999',
				page: '1',
				offset: String(PAGE),
				sort: 'asc'
			});
			if (!Array.isArray(batch)) throw new WalletError(`${action} without a list`, 'WALLET_NODE');
			const before = seen.size;
			/** @type {Map<string, number>} */
			const counts = new Map();
			for (const raw of batch) seen.set(keyOf(raw, counts), raw);
			if (batch.length < PAGE) break;
			const last = Number(batch[batch.length - 1]?.blockNumber);
			// A full page that brought nothing new: one block holds more than a page.
			if (seen.size === before || !Number.isSafeInteger(last)) {
				throw new WalletError(
					`${action}: more entries in one block than a page`,
					'WALLET_TOO_MANY'
				);
			}
			startblock = last;
		}
		return [...seen.values()];
	}

	/** @param {any} r */
	const internalKey = (r) =>
		`${String(r.transactionHash ?? r.hash).toLowerCase()}:${r.index ?? r.traceId ?? ''}:${r.from}:${r.to}:${r.value}`;

	return {
		/**
		 * @param {object} params
		 * @param {import('./registry.js').EvmChain} params.chain
		 * @param {string} params.address
		 * @param {{ api: string }} params.endpoints already checked
		 * @param {boolean} [params.ownEndpoint] the wallet names its own API: that one is asked,
		 *   never Alchemy
		 */
		async history({ chain, address, endpoints, ownEndpoint = false }) {
			if (!isEvmAddress(address)) {
				throw new WalletError(
					'not an EVM address (0x and 40 hex digits; mixed case must match its EIP-55 checksum)',
					'WALLET_ADDRESS',
					400
				);
			}
			const lower = address.toLowerCase();
			const key = chain.alchemy && !ownEndpoint && alchemy ? await alchemy.key() : null;
			if (key) {
				const network = /** @type {import('./registry.js').AlchemyNetwork} */ (chain.alchemy);
				const read = await alchemyReader.read({
					chain,
					address: lower,
					key,
					baseUrl: (alchemy?.baseUrl ?? alchemyBaseUrl)(network.network),
					// Arbitrum and Optimism: Alchemy has no internal transfers there.
					blockscoutInternal: network.internal
						? undefined
						: async () => {
								await checkChain(endpoints.api, chain);
								return list(endpoints.api, 'txlistinternal', lower, internalKey);
							}
				});
				const { entries, unknownTokens } = normalizeEvm(read, { address: lower, chain });
				/** @type {{ asset: string, amount: string, decimals: number }[]} */
				const balances = [];
				for (const [what, units] of read.balances) {
					const asset = what === 'native' ? chain.native : chain.tokens[what];
					balances.push({
						asset: asset.symbol,
						amount: unitsToDecimal(units, asset.decimals),
						decimals: asset.decimals
					});
				}
				return {
					source: /** @type {const} */ ('alchemy'),
					internalSource: network.internal ? 'alchemy' : 'blockscout',
					entries,
					balances,
					transactions: new Set(entries.map((e) => e.hash)).size,
					unknownAssets: unknownTokens.length,
					// transactions whose receipt has no status (before Byzantium): gas booked, value not
					unknownStatus: read.unknownStatus,
					history: { earliestHeight: 0, earliestTime: null, pruned: false },
					addressUrl: addressUrl(chain.explorer, address)
				};
			}
			await checkChain(endpoints.api, chain);
			const normal = await list(endpoints.api, 'txlist', lower, (r) =>
				String(r.hash).toLowerCase()
			);
			const internal = await list(endpoints.api, 'txlistinternal', lower, internalKey);
			const tokens = await list(endpoints.api, 'tokentx', lower, (r, occurrences) => {
				if (r.logIndex !== undefined && r.logIndex !== '') {
					return `${String(r.hash).toLowerCase()}:${r.logIndex}`;
				}
				// No log index in this API's answer: the same transfer twice in one
				// transaction is told apart by its order.
				const base = `${String(r.hash).toLowerCase()}:${r.contractAddress}:${r.from}:${r.to}:${r.value}`;
				const n = occurrences.get(base) ?? 0;
				occurrences.set(base, n + 1);
				return `${base}:${n}`;
			});
			const { entries, unknownTokens } = normalizeEvm(
				{ normal, internal, tokens },
				{ address: lower, chain }
			);

			const nativeBalance = bigintOf(
				await call(endpoints.api, { module: 'account', action: 'balance', address: lower })
			);
			/** @type {{ asset: string, amount: string, decimals: number }[]} */
			const balances = [];
			if (nativeBalance !== null) {
				balances.push({
					asset: chain.native.symbol,
					amount: unitsToDecimal(nativeBalance, chain.native.decimals),
					decimals: chain.native.decimals
				});
			}
			for (const [contract, token] of Object.entries(chain.tokens)) {
				const amount = bigintOf(
					await call(endpoints.api, {
						module: 'account',
						action: 'tokenbalance',
						contractaddress: contract,
						address: lower
					})
				);
				if (amount !== null) {
					balances.push({
						asset: token.symbol,
						amount: unitsToDecimal(amount, token.decimals),
						decimals: token.decimals
					});
				}
			}
			return {
				source: /** @type {const} */ ('blockscout'),
				entries,
				balances,
				transactions: new Set(entries.map((e) => e.hash)).size,
				unknownAssets: unknownTokens.length,
				history: { earliestHeight: 0, earliestTime: null, pruned: false },
				addressUrl: addressUrl(chain.explorer, address)
			};
		}
	};
}

/**
 * Swaps (issue #115): per transaction, what the wallet gave and what it got,
 * leaving the gas out. Two sides of different assets make a swap; its booked
 * legs become kind `swap` and carry both sides and the router's name.
 * Changes the entries in place.
 *
 * @param {(import('./cosmos.js').WalletEntry & { order: string })[]} entries
 * @param {{ hash: string, asset: string, amount: string, listed: false }[]} unlisted
 * @param {(hash: string) => string} viaOf
 */
export function markSwaps(entries, unlisted, viaOf) {
	/** @type {Map<string, { gave: any[], got: any[], legs: any[] }>} */
	const byHash = new Map();
	const of = (/** @type {string} */ hash) => {
		let x = byHash.get(hash);
		if (!x) byHash.set(hash, (x = { gave: [], got: [], legs: [] }));
		return x;
	};
	/** @type {Map<string, any>} hash → its gas entry */
	const feeOf = new Map();
	for (const e of entries) {
		if (e.type === 'fee') feeOf.set(e.hash, e);
		if (e.type === 'fee' || e.kind !== 'transfer') continue;
		const x = of(e.hash);
		(e.amount.startsWith('-') ? x.gave : x.got).push({
			asset: e.asset,
			amount: e.amount.replace(/^-/, ''),
			listed: e.listed !== false
		});
		x.legs.push(e);
	}
	for (const u of unlisted) {
		const x = of(u.hash);
		(u.amount.startsWith('-') ? x.gave : x.got).push({
			asset: u.asset,
			amount: u.amount.replace(/^-/, ''),
			listed: false
		});
	}
	for (const [hash, x] of byHash) {
		if (!x.legs.length || !x.gave.length || !x.got.length) continue;
		const gaveAssets = new Set(x.gave.map((g) => g.asset));
		if (x.got.every((g) => gaveAssets.has(g.asset))) continue;
		// The gas belongs to the swap too: named in it, and its own entry says
		// which swap it paid for (it stays a fee of its own).
		const gas = feeOf.get(hash);
		const swap = {
			gave: x.gave,
			got: x.got,
			via: viaOf(hash),
			...(gas ? { fee: { asset: gas.asset, amount: gas.amount.replace(/^-/, '') } } : {})
		};
		for (const e of x.legs) {
			e.kind = 'swap';
			e.swap = swap;
		}
		if (gas) gas.swap = swap;
	}
}

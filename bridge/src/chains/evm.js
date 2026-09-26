// An EVM wallet (Ethereum, Base, Arbitrum, Optimism, Polygon), read only, by
// its address: ETH (or the chain's native coin) in and out, the ERC-20
// tokens listed in registry.js, and the gas it paid.
//
// Source: Blockscout's Etherscan-compatible API, no key needed:
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
//     contract called "USDC"). Others are counted and left out.
//
// The log gets counts, never an address.

import { keccak_256 } from '@noble/hashes/sha3.js';

import { addressUrl, txUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';

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
	/** @type {Map<string, number>} per hash, to number its entries */
	const counters = new Map();

	/**
	 * @param {any} raw
	 * @param {string} hash
	 * @param {string} order sorts the entries: block, position, kind
	 * @param {Omit<import('./cosmos.js').WalletEntry, 'id' | 'hash' | 'height' | 'time' | 'date' | 'explorerUrl' | 'memo'>} e
	 */
	const push = (raw, hash, order, e) => {
		const time = isoOf(raw.timeStamp);
		entries.push({
			id: '',
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
		const order = `${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}`;
		if (from === address) {
			const gasUsed = bigintOf(raw.gasUsed);
			const gasPrice = bigintOf(raw.gasPrice);
			if (gasUsed === null || gasPrice === null) {
				throw new WalletError('a transaction without gas figures', 'WALLET_DATA');
			}
			const fee = gasUsed * gasPrice;
			if (fee > 0n) {
				push(raw, hash, `${order}:0`, {
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
		if (failed || value === 0n || (from === address) === (to === address)) continue;
		const out = from === address;
		push(raw, hash, `${order}:1`, {
			type: out ? 'sent' : 'received',
			kind: 'transfer',
			asset: native.symbol,
			amount: unitsToDecimal(out ? -value : value, native.decimals),
			decimals: native.decimals,
			counterparty: out ? to : from,
			counterpartyLabel: '',
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
		push(raw, hash, `${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}:2:${pad(raw.index)}`, {
			type: out ? 'sent' : 'received',
			kind: 'transfer',
			asset: native.symbol,
			amount: unitsToDecimal(out ? -value : value, native.decimals),
			decimals: native.decimals,
			counterparty: out ? to : from,
			counterpartyLabel: 'Vertrag (interne Transaktion)',
			success: true
		});
	}

	for (const raw of tokens) {
		const hash = hashOf(raw);
		const contract = String(raw.contractAddress ?? '').toLowerCase();
		const token = Object.hasOwn(chain.tokens, contract) ? chain.tokens[contract] : null;
		if (!token) {
			unknownTokens.add(contract);
			continue;
		}
		const from = String(raw.from ?? '').toLowerCase();
		const to = String(raw.to ?? '').toLowerCase();
		const value = bigintOf(raw.value) ?? 0n;
		if (value === 0n || (from === address) === (to === address)) continue;
		const out = from === address;
		push(raw, hash, `${pad(raw.blockNumber)}:${pad(raw.transactionIndex)}:3:${pad(raw.logIndex)}`, {
			type: out ? 'sent' : 'received',
			kind: 'transfer',
			asset: token.symbol,
			amount: unitsToDecimal(out ? -value : value, token.decimals),
			decimals: token.decimals,
			counterparty: out ? to : from,
			counterpartyLabel: '',
			success: true
		});
	}

	entries.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
	// `<hash>:<n>` for what moved, `<hash>:fee` for the gas.
	const result = entries.map(({ order: _order, ...e }) => {
		if (e.type === 'fee') return { ...e, id: `${e.hash}:fee` };
		const n = counters.get(e.hash) ?? 0;
		counters.set(e.hash, n + 1);
		return { ...e, id: `${e.hash}:${n}` };
	});
	return { entries: result, unknownTokens: [...unknownTokens] };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxPages] per list
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createEvmClient({ fetch: f = fetch, timeoutMs, maxPages = 50, sleep } = {}) {
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
		throw new WalletError(
			`the API answered: ${message.slice(0, 80) || 'no result'}`,
			'WALLET_NODE'
		);
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

	return {
		/**
		 * @param {object} params
		 * @param {import('./registry.js').EvmChain} params.chain
		 * @param {string} params.address
		 * @param {{ api: string }} params.endpoints already checked
		 */
		async history({ chain, address, endpoints }) {
			if (!isEvmAddress(address)) {
				throw new WalletError(
					'not an EVM address (0x and 40 hex digits; mixed case must match its EIP-55 checksum)',
					'WALLET_ADDRESS',
					400
				);
			}
			const lower = address.toLowerCase();
			const normal = await list(endpoints.api, 'txlist', lower, (r) =>
				String(r.hash).toLowerCase()
			);
			const internal = await list(
				endpoints.api,
				'txlistinternal',
				lower,
				(r) =>
					`${String(r.transactionHash ?? r.hash).toLowerCase()}:${r.index ?? r.traceId ?? ''}:${r.from}:${r.to}:${r.value}`
			);
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

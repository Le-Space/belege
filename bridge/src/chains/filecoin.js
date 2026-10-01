// A Filecoin wallet, read only, by its address (issue: Filecoin as an own
// wallet, after #215). The history comes from Filfox's public API, no key:
//
//   GET /address/<a>                         the balance (attoFIL)
//   GET /address/<a>/transfers?pageSize=100&page=<n>
//                                            every value movement, newest first:
//                                            `send` / `receive` (type transfer),
//                                            `miner-fee`, `burn-fee`
//
// Filfox sees the address and this Mac's IP – the consent screen says so.
//
// A message is the unit, and its CID is the hash: the same CID an exchange
// reports for a deposit (Kraken's txid `bafy2bzace…`), so a withdrawal from
// here pairs with that deposit as an own transfer. Per message:
//   - each `send` an entry `sent`, each `receive` an entry `received`,
//     with the other side's address;
//   - its `miner-fee` and `burn-fee` together one entry `fee` – what sending
//     the message cost; only messages this address sent pay one.
//
// Addresses: f1 (secp256k1), f3 (BLS) and f410f (delegated, FEVM) are checked
// by their blake2b checksum before anything is asked; f0 (an ID) has none and
// is taken as it is. The log gets counts, never an address or a CID.

import { base32nopad } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';

import { txUrl, addressUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';

const PAGE = 100;
/** A wallet with more movements than this is too large to read here. */
const MAX_PAGES = 200;

/**
 * Whether a string is a Filecoin mainnet address with a valid checksum.
 *
 * @param {unknown} address
 */
export function isFilecoinAddress(address) {
	const a = String(address ?? '').trim();
	if (/^f0\d{1,20}$/.test(a)) return true;
	const m = /^f(1|3|410f)([a-z2-7]+)$/.exec(a);
	if (!m) return false;
	let raw;
	try {
		raw = base32nopad.decode(m[2].toUpperCase());
	} catch {
		return false;
	}
	const payload = raw.slice(0, -4);
	const sum = raw.slice(-4);
	/** @type {number[]} */ let head;
	if (m[1] === '1') {
		if (payload.length !== 20) return false;
		head = [1];
	} else if (m[1] === '3') {
		if (payload.length !== 48) return false;
		head = [3];
	} else {
		if (payload.length !== 20) return false;
		head = [4, 10]; // delegated, namespace 10 (the Ethereum address manager), as leb128
	}
	const calc = blake2b(new Uint8Array([...head, ...payload]), { dkLen: 4 });
	return calc.every((b, i) => b === sum[i]);
}

/**
 * @typedef {object} FilfoxTransfer
 * @property {number} height
 * @property {number} timestamp unix seconds
 * @property {string} message the message CID
 * @property {string} from
 * @property {string} to
 * @property {string} value signed attoFIL
 * @property {'send' | 'receive' | 'miner-fee' | 'burn-fee'} type
 */

/**
 * Filfox's transfers of one address → wallet entries.
 *
 * @param {FilfoxTransfer[]} transfers
 * @param {import('./registry.js').FilecoinChain} chain
 * @returns {import('./cosmos.js').WalletEntry[]}
 */
export function normalizeFilecoin(transfers, chain) {
	const { symbol, decimals } = chain.native;
	/** @type {Map<string, FilfoxTransfer[]>} */
	const byMessage = new Map();
	for (const t of transfers) {
		if (typeof t?.message !== 'string' || !/^bafy2bzace[a-z2-7]+$/.test(t.message)) continue;
		const list = byMessage.get(t.message) ?? [];
		list.push(t);
		byMessage.set(t.message, list);
	}
	/** @type {import('./cosmos.js').WalletEntry[]} */
	const entries = [];
	for (const [cid, list] of byMessage) {
		const first = list[0];
		const time = new Date(Number(first.timestamp) * 1000).toISOString();
		const base = {
			hash: cid,
			height: Number(first.height),
			time,
			date: time.slice(0, 10),
			asset: symbol,
			decimals,
			counterpartyLabel: '',
			memo: '',
			success: true,
			explorerUrl: txUrl(chain.explorer, cid)
		};
		let fee = 0n;
		let n = 0;
		for (const t of list) {
			let value;
			try {
				value = BigInt(t.value);
			} catch {
				continue;
			}
			if (t.type === 'miner-fee' || t.type === 'burn-fee') {
				fee += value < 0n ? -value : value;
				continue;
			}
			if (t.type !== 'send' && t.type !== 'receive') continue;
			const out = t.type === 'send';
			const amount = out ? (value < 0n ? value : -value) : value < 0n ? -value : value;
			entries.push({
				...base,
				id: `${cid}:${t.type}:${n++}`,
				type: out ? 'sent' : 'received',
				kind: 'transfer',
				amount: unitsToDecimal(amount, decimals),
				counterparty: String(out ? t.to : t.from)
			});
		}
		if (fee > 0n) {
			entries.push({
				...base,
				id: `${cid}:fee`,
				type: 'fee',
				kind: 'fee',
				amount: unitsToDecimal(-fee, decimals),
				counterparty: ''
			});
		}
	}
	return entries.sort((a, b) =>
		a.height === b.height ? (a.id < b.id ? -1 : 1) : a.height - b.height
	);
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createFilecoinClient({ fetch: f, timeoutMs, sleep }) {
	const get = createJsonFetcher({ fetch: f, timeoutMs, sleep });

	return {
		/**
		 * @param {{ chain: import('./registry.js').FilecoinChain, address: string, endpoints: { api: string } }} params
		 */
		async history({ chain, address, endpoints }) {
			const a = String(address ?? '').trim();
			if (!isFilecoinAddress(a)) {
				throw new WalletError(
					'not a Filecoin address (f1…, f3…, f410f… or f0…)',
					'WALLET_ADDRESS',
					400
				);
			}
			const info = await get(`${endpoints.api}/address/${encodeURIComponent(a)}`);
			/** @type {FilfoxTransfer[]} */
			const transfers = [];
			let total = Infinity;
			for (let page = 0; page * PAGE < total; page++) {
				if (page >= MAX_PAGES) {
					throw new WalletError(
						`more than ${MAX_PAGES * PAGE} movements on this address`,
						'WALLET_TOO_LARGE',
						413
					);
				}
				const body = await get(
					`${endpoints.api}/address/${encodeURIComponent(a)}/transfers?pageSize=${PAGE}&page=${page}`
				);
				const list = Array.isArray(body?.transfers) ? body.transfers : [];
				total = Number(body?.totalCount ?? 0);
				transfers.push(...list);
				if (list.length < PAGE) break;
			}
			const entries = normalizeFilecoin(transfers, chain);
			let balance = 0n;
			try {
				balance = BigInt(info?.balance ?? 0);
			} catch {
				balance = 0n;
			}
			return {
				entries,
				balances: [
					{
						asset: chain.native.symbol,
						amount: unitsToDecimal(balance, chain.native.decimals),
						decimals: chain.native.decimals
					}
				],
				transactions: new Set(entries.map((e) => e.hash)).size,
				unknownAssets: 0,
				history: { earliestHeight: 0, earliestTime: null, pruned: false },
				addressUrl: addressUrl(chain.explorer, a)
			};
		}
	};
}

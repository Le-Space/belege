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
// Addresses: f1 (secp256k1), f3 (BLS) and f410f (delegated, FEVM; also
// given as its `0x…` Ethereum form, converted here) are checked
// by their blake2b checksum before anything is asked; f0 (an ID) has none and
// is taken as it is. The log gets counts, never an address or a CID.
//
// FEVM tokens (issue #301): where the address has token transfers,
//
//   GET /address/<a>/token-transfers?pageSize=100&page=<n>
//
// gives them, by message too. Only the tokens listed for the chain are
// booked (chain.js `tokens`, by contract – a token's symbol is its own
// claim); their balance is the sum of the whole history. A message in which
// the wallet gives one asset and gets another is a swap, as on the EVM
// chains (swaps.js markSwaps): a FIL → USDFC swap on SushiSwap, say. Its router
// is named from the message's receiver (`GET /message/<cid>`, asked for swaps
// only) where it is a known contract (chain.js `contracts`).

import { base32nopad } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';
import { fromHex } from '@le-space/ledger/bytes';
import { derivedStatement, fromWalletEntry, sortEntries } from '@le-space/ledger';
import { FILECOIN } from './filecoin-chain.js';

import {
	addressUrl,
	createJsonFetcher,
	markSwaps,
	txUrl,
	unitsToDecimal,
	WalletError
} from './core.js';

const PAGE = 100;

/** `-1.5` → its smallest units, signed. @param {string} amount @param {number} decimals */
function decimalToUnits(amount, decimals) {
	const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
	if (!m) return 0n;
	const units = BigInt(m[2] + (m[3] ?? '').padEnd(decimals, '0').slice(0, decimals));
	return m[1] ? -units : units;
}
/** A wallet with more movements than this is too large to read here. */
const MAX_PAGES = 200;

/**
 * An Ethereum-style address in its Filecoin form: `0x…` (20 bytes) →
 * `f410f…`, the delegated address of the same account (namespace 10, the
 * Ethereum address manager), with its blake2b checksum. Anything else comes
 * back as it was, trimmed.
 *
 * @param {unknown} address
 */
export function toFilecoinAddress(address) {
	const a = String(address ?? '').trim();
	if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return a;
	const payload = fromHex(a.slice(2));
	const sum = blake2b(new Uint8Array([4, 10, ...payload]), { dkLen: 4 });
	return `f410f${base32nopad.encode(new Uint8Array([...payload, ...sum])).toLowerCase()}`;
}

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
 * @param {import('./filecoin-chain.js').FilecoinChain} chain
 * @returns {import('@le-space/ledger/wallet-entry').WalletEntry[]}
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
	/** @type {import('@le-space/ledger/wallet-entry').WalletEntry[]} */
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
 * @typedef {object} FilfoxTokenTransfer
 * @property {number} height
 * @property {number} timestamp unix seconds
 * @property {string} message the message CID
 * @property {string} from
 * @property {string} to
 * @property {string} token the contract, as f410f…
 * @property {string} value unsigned, in the token's smallest unit
 * @property {string} [symbol] the token's own claim
 * @property {number} [decimals] the token's own claim
 */

/**
 * Filfox's token transfers of one address → wallet entries for the listed
 * tokens, and the moves of other tokens (they only name a swap's side).
 *
 * @param {FilfoxTokenTransfer[]} transfers
 * @param {import('./filecoin-chain.js').FilecoinChain} chain
 * @param {string} address the wallet, as f410f… (or f1/f3/f0)
 * @returns {{ entries: import('@le-space/ledger/wallet-entry').WalletEntry[], unlisted: { hash: string, asset: string, amount: string, listed: false }[], unknownTokens: string[] }}
 */
export function normalizeFilecoinTokens(transfers, chain, address) {
	/** @type {Map<string, import('@le-space/ledger/wallet-entry').ChainAsset>} f410f contract → asset */
	const listed = new Map(
		Object.entries(chain.tokens ?? {}).map(([contract, a]) => [toFilecoinAddress(contract), a])
	);
	/** @type {import('@le-space/ledger/wallet-entry').WalletEntry[]} */
	const entries = [];
	/** @type {{ hash: string, asset: string, amount: string, listed: false }[]} */
	const unlisted = [];
	/** @type {Set<string>} */
	const unknown = new Set();
	/** @type {Map<string, number>} */
	const seen = new Map();
	for (const t of transfers) {
		const cid = t?.message;
		if (typeof cid !== 'string' || !/^bafy2bzace[a-z2-7]+$/.test(cid)) continue;
		const out = t.from === address;
		const into = t.to === address;
		if (out === into) continue;
		let value;
		try {
			value = BigInt(t.value);
		} catch {
			continue;
		}
		if (value <= 0n) continue;
		const asset = listed.get(String(t.token));
		if (!asset) {
			unknown.add(String(t.token));
			unlisted.push({
				hash: cid,
				// Only a swap's side, never booked: the token's own claim, marked as such.
				asset: String(t.symbol ?? '?').slice(0, 20),
				amount: unitsToDecimal(out ? -value : value, Number(t.decimals ?? 18)),
				listed: false
			});
			continue;
		}
		const n = seen.get(cid) ?? 0;
		seen.set(cid, n + 1);
		const time = new Date(Number(t.timestamp) * 1000).toISOString();
		entries.push({
			id: `${cid}:token:${n}`,
			hash: cid,
			height: Number(t.height),
			time,
			date: time.slice(0, 10),
			type: out ? 'sent' : 'received',
			kind: 'transfer',
			asset: asset.symbol,
			decimals: asset.decimals,
			amount: unitsToDecimal(out ? -value : value, asset.decimals),
			counterparty: String(out ? t.to : t.from),
			counterpartyLabel: '',
			memo: '',
			success: true,
			explorerUrl: txUrl(chain.explorer, cid)
		});
	}
	return { entries, unlisted, unknownTokens: [...unknown] };
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
		 * @param {{ chain: import('./filecoin-chain.js').FilecoinChain, address: string, endpoints: { api: string } }} params
		 */
		async history({ chain, address, endpoints }) {
			// A `0x…` address is read as its f410f form (toFilecoinAddress).
			const a = toFilecoinAddress(address);
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
			/** @type {FilfoxTokenTransfer[]} */
			const tokenTransfers = [];
			let tokenTotal = Number(info?.tokenTransferCount ?? 0) > 0 ? Infinity : 0;
			for (let page = 0; page * PAGE < tokenTotal; page++) {
				if (page >= MAX_PAGES) {
					throw new WalletError(
						`more than ${MAX_PAGES * PAGE} token movements on this address`,
						'WALLET_TOO_LARGE',
						413
					);
				}
				const body = await get(
					`${endpoints.api}/address/${encodeURIComponent(a)}/token-transfers?pageSize=${PAGE}&page=${page}`
				);
				const list = Array.isArray(body?.transfers) ? body.transfers : [];
				tokenTotal = Number(body?.totalCount ?? 0);
				tokenTransfers.push(...list);
				if (list.length < PAGE) break;
			}
			const tokens = normalizeFilecoinTokens(tokenTransfers, chain, a);
			const entries = [...normalizeFilecoin(transfers, chain), ...tokens.entries];
			markSwaps(/** @type {any[]} */ (entries), tokens.unlisted, () => '');
			// A swap's router: the receiver of its message, where it is a known contract.
			/** @type {Map<string, string>} f410f → name */
			const names = new Map(
				Object.entries(chain.contracts ?? {}).map(([c, name]) => [toFilecoinAddress(c), name])
			);
			/** @type {Map<string, any>} */
			const swaps = new Map();
			for (const e of /** @type {any[]} */ (entries)) if (e.swap) swaps.set(e.hash, e.swap);
			for (const [cid, swap] of swaps) {
				const message = await get(`${endpoints.api}/message/${encodeURIComponent(cid)}`).catch(
					() => null
				);
				swap.via = names.get(String(message?.to ?? '')) ?? '';
			}
			entries.sort((x, y) =>
				x.height === y.height ? (x.id < y.id ? -1 : 1) : x.height - y.height
			);
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
					},
					// A listed token's balance: the sum of its whole history, read above.
					...Object.values(chain.tokens ?? {})
						.filter((t) => tokens.entries.some((e) => e.asset === t.symbol))
						.map((t) => ({
							asset: t.symbol,
							amount: unitsToDecimal(
								tokens.entries
									.filter((e) => e.asset === t.symbol)
									.reduce((sum, e) => sum + decimalToUnits(e.amount, t.decimals), 0n),
								t.decimals
							),
							decimals: t.decimals
						}))
				],
				transactions: new Set(entries.map((e) => e.hash)).size,
				unknownAssets: tokens.unknownTokens.length,
				history: { earliestHeight: 0, earliestTime: null, pruned: false },
				addressUrl: addressUrl(chain.explorer, a)
			};
		}
	};
}

// ---- as ledger entries, for an Eigenbeleg or a Kontoauszug (from the
// Eigenbeleg agent's readers/filecoin.js): the fee goes to the network, FIL
// and USDFC are priced; and the period.

const PRICE_AS = { FIL: 'FIL', USDFC: 'USDC' };

/**
 * A WalletEntry → the ledger entry a document books.
 *
 * @param {import('@le-space/ledger/wallet-entry').WalletEntry} e
 * @param {string} account
 */
export function toLedger(e, account) {
	const fee = e.type === 'fee';
	return fromWalletEntry(
		e,
		{
			chain: 'filecoin',
			network: 'mainnet',
			account,
			priceAs: PRICE_AS[/** @type {keyof typeof PRICE_AS} */ (e.asset)] ?? ''
		},
		{
			kind: fee ? 'fee' : e.kind === 'swap' ? 'swap' : 'transfer',
			contract: e.contract ?? 'native',
			counterparty: fee ? 'filecoin' : String(e.counterparty ?? ''),
			counterpartyLabel: fee
				? 'Filecoin-Netzwerk (Miner-Tip und verbrannte Gebühr)'
				: String(e.counterpartyLabel ?? ''),
			memo: '',
			success: fee ? true : e.success !== false
		}
	);
}

/**
 * @param {object} p
 * @param {string} p.account f0/f1/f3/f410f or 0x
 * @param {typeof fetch} [p.fetch]
 * @param {{ api?: string }} [p.endpoints] instead of Filfox, e.g. behind a proxy
 */
async function ledgerHistory({ account, fetch = globalThis.fetch, endpoints }) {
	if (!isFilecoinAddress(account)) throw new Error('not a valid Filecoin address');
	const address = toFilecoinAddress(account) ?? account;
	const { entries, balances } = await createFilecoinClient({ fetch }).history({
		chain: FILECOIN,
		address,
		endpoints: { ...FILECOIN.endpoints, ...endpoints }
	});
	return { all: sortEntries(entries.map((e) => toLedger(e, address))), balances };
}

/** Ledger entries for an account and period. @param {Parameters<typeof ledgerHistory>[0] & { from: string, to: string }} p */
export async function readFilecoin(p) {
	const { all } = await ledgerHistory(p);
	return all.filter((e) => e.date >= p.from && e.date <= p.to);
}

/** For a Kontoauszug: balances derived from today's balance less the movements since (as for Akash). @param {Parameters<typeof readFilecoin>[0]} p */
export async function statementFilecoin(p) {
	const { all, balances } = await ledgerHistory(p);
	return derivedStatement(all, balances, p.from, p.to);
}

/** The storage market actor always exists: Filfox answers for it when the source is up. @param {{ fetch?: typeof fetch, endpoints?: { api?: string } }} [o] */
export async function probe({ fetch = globalThis.fetch, endpoints } = {}) {
	const res = await fetch(`${endpoints?.api ?? FILECOIN.endpoints.api}/address/f05`);
	if (!res.ok) throw new Error(`Filfox answered ${res.status}`);
	const body = await res.json();
	if (!body?.balance) throw new Error('Filfox answered without a balance');
	return { sample: 'Filfox f05 (storage market actor)', entries: 1 };
}

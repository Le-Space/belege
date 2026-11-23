// SPDX-License-Identifier: AGPL-3.0-or-later
// What a NEAR storage deposit was for, read from the chain.
//
// A token contract (NEP-141) or a DEX keeps an account's balance only once the
// account is registered there and has paid for the bytes (NEP-145
// `storage_deposit`; a DEX's `tokens_storage_deposit` registers it for several
// tokens at once). The wallet signs such a deposit in a transaction of its own,
// shortly before what needs it. near.js `storageKept` reads the deposit's
// transaction from the archival RPC anyway (what the contract kept); the same
// answer holds the call's arguments – `account_id` (whom it registers; the
// signer when not given), `registration_only`, a DEX's token list – kept on
// the entry as `registration`. No request more.
//
// From that, every storage deposit the account sent and the contract kept
// (`purpose: 'storage'`) is tied, in this order, to
//   1. a swap        sent at most STORAGE_BEFORE_SWAP_MS before a swap, to a
//                    contract the swap involves: a token given or got (wNEAR
//                    for NEAR), or the account that took what was given (the
//                    DEX) – `partOf` the swap's hash (#968, as before); not when
//                    its call registered another account;
//   2. a transfer    it registers another account, and within
//                    STORAGE_BEFORE_TRANSFER_MS the account sends exactly that
//                    account the contract's token – `enables` { hash, kind:
//                    'transfer' }: the cost of that transfer;
//   3. a swap's route  it registers the account itself (or the call is not
//                    known) at a token the swap's sides do not name, and the
//                    swap, at most STORAGE_BEFORE_SWAP_MS later, passed through
//                    that token (an aggregator's route): read from the swap's
//                    own receipts, one RPC call per such swap – `partOf`;
//   4. a receipt     it registers the account itself, and within
//                    STORAGE_BEFORE_RECEIPT_MS the account first receives the
//                    contract's token (no swap's leg) – `enables` { hash, kind:
//                    'receipt' }: the cost of that receipt;
//   5. nothing       a storage deposit of its own: `purpose: 'storage'` alone.
// Its transaction's gas names the same (`partOf` or `enables`). A refund
// (`storage_withdraw`, `storage_unregister`) is no storage entry and never tied.
//
// Every one of them is a cost to the network's contracts, not a payment to
// someone who invoices: a fee, with or without what it was for.
//
// Read for a period (readNear), what lies just outside it is not seen: a
// deposit on the last evening whose transfer follows after midnight stays a
// deposit of its own there.

import { TOKENS } from './near.js';

/** How long before a swap a storage deposit made for it may come (#968). */
export const STORAGE_BEFORE_SWAP_MS = 5 * 60_000;
/** …before a transfer to the account it registered: the wallet signs both, a minute or two apart. */
export const STORAGE_BEFORE_TRANSFER_MS = 5 * 60_000;
/** …before the first receipt of the token: registered, then the payout asked for elsewhere. */
export const STORAGE_BEFORE_RECEIPT_MS = 24 * 60 * 60_000;

/**
 * @typedef {import('@le-space/ledger').LedgerEntry} LedgerEntry
 * @typedef {{ account: string, only?: boolean, tokens?: string[] }} Registration
 */

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * Whom a storage deposit registers, from the transaction as the RPC gives it
 * (EXPERIMENTAL_tx_status `result.transaction`). Undefined when the call is
 * not there or its arguments are no JSON object: then nothing is guessed.
 *
 * @param {any} transaction
 * @param {string} signer the account that signed it
 * @returns {Registration | undefined}
 */
export function registrationOf(transaction, signer) {
	const actions = Array.isArray(transaction?.actions) ? transaction.actions : [];
	for (const a of actions) {
		const call = a?.FunctionCall;
		if (!call || !/^(tokens_)?storage_deposit$/.test(String(call.method_name ?? ''))) continue;
		/** @type {any} */
		let args = {};
		try {
			const text = call.args
				? new TextDecoder().decode(Uint8Array.from(atob(String(call.args)), (c) => c.charCodeAt(0)))
				: '{}';
			args = JSON.parse(text || '{}');
		} catch {
			return undefined;
		}
		if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
		const account =
			args.account_id === undefined || args.account_id === null ? signer : String(args.account_id);
		if (!ACCOUNT_ID.test(account)) return undefined;
		const list = Array.isArray(args.token_ids) ? args.token_ids : args.tokens;
		const tokens = Array.isArray(list)
			? list.map(String).filter((t) => ACCOUNT_ID.test(t))
			: undefined;
		return {
			account,
			...(typeof args.registration_only === 'boolean' ? { only: args.registration_only } : {}),
			...(tokens?.length ? { tokens } : {})
		};
	}
	return undefined;
}

/** The symbols of the network's wrapped NEAR. @param {string} network */
const wrapContracts = (network) =>
	Object.entries(
		/** @type {Record<string, { priceAs: string }>} */ (
			TOKENS[/** @type {keyof typeof TOKENS} */ (network)] ?? {}
		)
	)
		.filter(([, t]) => t.priceAs === 'NEAR')
		.map(([c]) => c);

/**
 * The swaps among the entries, with the contracts each involves; wrapping
 * (NEAR for wNEAR, or back) is none.
 *
 * @param {LedgerEntry[]} entries
 * @param {string} network
 */
function swapsIn(entries, network) {
	const wraps = wrapContracts(network);
	const wrapSymbols = new Set(
		Object.values(
			/** @type {Record<string, { priceAs: string, symbol: string }>} */ (
				TOKENS[/** @type {keyof typeof TOKENS} */ (network)] ?? {}
			)
		)
			.filter((t) => t.priceAs === 'NEAR')
			.map((t) => t.symbol)
	);
	const asNear = (/** @type {{ asset: string }[]} */ side) =>
		side.map((x) => (wrapSymbols.has(x.asset) ? 'NEAR' : x.asset));
	/** @type {Map<string, { at: number, contracts: Set<string> }>} */
	const swaps = new Map();
	for (const e of entries) {
		if (e.type === 'fee' || !e.swap || swaps.has(e.hash)) continue;
		const gave = new Set(asNear(e.swap.gave));
		if (asNear(e.swap.got).every((a) => gave.has(a))) continue;
		swaps.set(e.hash, { at: Date.parse(e.time), contracts: new Set([e.swap.via]) });
	}
	for (const e of entries) {
		const s = swaps.get(e.hash);
		if (!s || e.type === 'fee') continue;
		if (e.contract === 'native' || wraps.includes(e.contract))
			for (const c of wraps) s.contracts.add(c);
		else s.contracts.add(e.contract);
	}
	return swaps;
}

/**
 * The nearest of `candidates` at or after `at` and at most `window` later.
 *
 * @template {{ hash: string, at: number }} T
 * @param {T[]} candidates @param {number} at @param {number} window
 */
function nearest(candidates, at, window) {
	/** @type {T | null} */
	let best = null;
	for (const c of candidates) {
		const gap = c.at - at;
		if (gap < 0 || gap > window) continue;
		if (!best || c.at < best.at || (c.at === best.at && c.hash < best.hash)) best = c;
	}
	return best;
}

/**
 * Ties every storage deposit to what it was for (see the head of this file)
 * and returns the entries with `partOf` or `enables` set on the deposit and
 * its gas. Asks the RPC only for a swap whose route may explain a deposit
 * (case 3); `routeOf` answers that, and may be left out (no such case tied).
 *
 * @param {LedgerEntry[]} entries
 * @param {{ network?: string, routeOf?: (hash: string, account: string) => Promise<Set<string>> }} [p]
 * @returns {Promise<LedgerEntry[]>}
 */
export async function storagePurposes(entries, { network = 'mainnet', routeOf } = {}) {
	const swaps = swapsIn(entries, network);
	const swapList = [...swaps].map(([hash, s]) => ({ hash, ...s }));
	/** @type {Map<string, { partOf?: string, enables?: { hash: string, kind: 'transfer' | 'receipt' } }>} hash of the deposit → what it is for */
	const tied = new Map();
	/** @type {Map<string, Promise<Set<string>>>} */
	const routes = new Map();
	const deposits = entries.filter(
		(e) => e.purpose === 'storage' && e.type === 'sent' && e.success && e.contract === 'native'
	);
	for (const d of deposits) {
		const at = Date.parse(d.time);
		const contract = d.counterparty;
		const registers = d.registration?.account;
		const self = registers === undefined ? null : registers === d.account;
		// 1. a swap that involves the contract – unless the call registered someone else
		const direct =
			self !== false &&
			nearest(
				swapList.filter((s) => s.contracts.has(contract)),
				at,
				STORAGE_BEFORE_SWAP_MS
			);
		if (direct) {
			tied.set(d.hash, { partOf: direct.hash });
			continue;
		}
		// 2. a transfer of the contract's token to the account it registered
		if (self === false) {
			const transfer = nearest(
				entries
					.filter(
						(e) =>
							e.type === 'sent' &&
							e.success &&
							e.contract === contract &&
							e.counterparty === registers &&
							e.hash !== d.hash
					)
					.map((e) => ({ hash: e.hash, at: Date.parse(e.time) })),
				at,
				STORAGE_BEFORE_TRANSFER_MS
			);
			if (transfer) tied.set(d.hash, { enables: { hash: transfer.hash, kind: 'transfer' } });
			continue;
		}
		// 3. a swap whose route passed through the contract
		if (routeOf) {
			const near = swapList
				.filter((s) => s.at - at >= 0 && s.at - at <= STORAGE_BEFORE_SWAP_MS)
				.sort((x, y) => x.at - y.at || (x.hash < y.hash ? -1 : 1));
			let found = '';
			for (const s of near) {
				let route = routes.get(s.hash);
				if (!route) routes.set(s.hash, (route = routeOf(s.hash, d.account)));
				if ((await route).has(contract)) {
					found = s.hash;
					break;
				}
			}
			if (found) {
				tied.set(d.hash, { partOf: found });
				continue;
			}
		}
		// 4. the first receipt of the contract's token
		if (self === true) {
			const receipt = nearest(
				entries
					.filter(
						(e) =>
							e.type === 'received' &&
							e.success &&
							e.contract === contract &&
							e.kind !== 'swap' &&
							!swaps.has(e.hash) &&
							e.hash !== d.hash
					)
					.map((e) => ({ hash: e.hash, at: Date.parse(e.time) })),
				at,
				STORAGE_BEFORE_RECEIPT_MS
			);
			if (receipt) tied.set(d.hash, { enables: { hash: receipt.hash, kind: 'receipt' } });
		}
	}
	return entries.map((e) => {
		const t = tied.get(e.hash);
		if (!t || t.partOf === e.hash || t.enables?.hash === e.hash) return e;
		const isDeposit = e.purpose === 'storage' && e.type === 'sent';
		if (!isDeposit && e.type !== 'fee') return e;
		return { ...e, ...t };
	});
}

/**
 * The contracts a transaction's receipts went to, from the archival RPC
 * (EXPERIMENTAL_tx_status): where a swap's route passed. An answer the RPC
 * gives as an error (a transaction it does not know under this signer) is an
 * empty route; a failed request throws.
 *
 * @param {(method: string, params: any) => Promise<any>} call the RPC
 * @returns {(hash: string, account: string) => Promise<Set<string>>}
 */
export function routeReader(call) {
	return async (hash, account) => {
		/** @type {any} */
		let result;
		try {
			result = await call('EXPERIMENTAL_tx_status', {
				tx_hash: hash,
				sender_account_id: account,
				wait_until: 'NONE'
			});
		} catch (e) {
			if (/** @type {any} */ (e)?.cause !== undefined) return new Set();
			throw e;
		}
		const out = new Set();
		for (const r of Array.isArray(result?.receipts) ? result.receipts : []) {
			if (r?.receiver_id) out.add(String(r.receiver_id));
			if (r?.predecessor_id) out.add(String(r.predecessor_id));
		}
		return out;
	};
}

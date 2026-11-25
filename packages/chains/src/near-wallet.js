// SPDX-License-Identifier: AGPL-3.0-or-later
// A NEAR account as an own wallet, read only, by its account id: the reader
// from Eigenbeleg (near.js) handed out as WalletEntry records, like every
// other chain of the wallet service (wallets.js).
//
//   NearBlocks  /v3/accounts/<id>/txns and /ft-txns, the whole history
//   the RPC     what a storage deposit kept (EXPERIMENTAL_tx_status), and
//               the balance now (view_account, ft_balance_of)
//
// Both see the account id and this machine's IP – the consent screen says so.
//
// Per transaction: the NEAR it moved an entry `sent` or `received`, the gas
// of a transaction this account signed an entry `fee` (`<hash>:fee`), each
// movement of a listed token an entry of its own. The hash is the
// transaction's, base58, the same an exchange names for a withdrawal – so a
// withdrawal from an exchange pairs with what arrives here.
//
// Only NEAR and the tokens listed for the chain (registry.js) are booked: a
// token's symbol is its own claim, and airdropped tokens are common on NEAR.
// What near.js does not read – NEAR that reaches the account inside another
// transaction's inner receipts, a staking pool paying out, say – is missing
// here too; the balance comes from the RPC and so shows the difference.
//
// Wrapped NEAR (wNEAR, the wrap contract's token) is NEAR here: it is NEAR,
// one for one, held in a contract so that a DEX can take it. Wrapping and
// unwrapping are movements inside the wallet and give no entry but their gas;
// wNEAR given to a DEX is NEAR given, so a swap of NEAR for a token is one
// swap in one transaction; the NEAR balance is the account's plus its wNEAR.
// The entries left out for it are named in `superseded`: before wNEAR was read
// as NEAR, the NEAR handed to the wrap contract was a payment of its own, and
// books that still hold it would count that NEAR twice beside the swap.
//
// A storage deposit (`storage_deposit`, `tokens_storage_deposit`) is a cost
// to the network's contracts, never a payment for a service: an entry `fee`
// under its own hash and id (`<hash>:deposit`, as when it was booked as a
// payment, so books update it in place) with `purpose: 'storage'`. What it
// was for is read from the chain (near-storage.js): a swap (`partOf` the
// swap's hash, carrying its sides; the swap's sides name what such deposits
// kept, `storage`), a transfer or the first receipt of a token (`enables`),
// or nothing (a storage deposit of its own). Its transaction's gas names the
// same.
//
// Error messages name a host at most, never the account: the bridge logs them.

import {
	balancesNow,
	fetchRaw,
	isAccountId,
	mapRaw,
	rpcCall,
	storageKept,
	TOKENS
} from './near.js';
import { routeReader, storagePurposes } from './near-storage.js';
import { addressUrl, hostOf, unitsToDecimal, WalletError } from './core.js';
import { fromUnits, toUnits } from '@le-space/ledger';

export {
	STORAGE_BEFORE_RECEIPT_MS,
	STORAGE_BEFORE_SWAP_MS,
	STORAGE_BEFORE_TRANSFER_MS
} from './near-storage.js';

/** The wrap contract's token: NEAR under another name. @param {string} contract */
const wrapped = (contract) =>
	/** @type {Record<string, { priceAs: string }>} */ (TOKENS.mainnet)[contract]?.priceAs === 'NEAR';
const WRAPPED_SYMBOLS = new Set(
	Object.values(TOKENS.mainnet)
		.filter((t) => t.priceAs === 'NEAR')
		.map((t) => t.symbol)
);

/** The wrap contracts: where a swap's NEAR is held as wNEAR. */
const WRAP_CONTRACTS = Object.keys(TOKENS.mainnet).filter(wrapped);

/** NearBlocks gives 25 rows a page: 5 000 transactions, and as many token movements. */
const MAX_PAGES = 200;
/** Before NEAR's mainnet began (2020). */
const FROM = '2020-01-01';

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {number} [options.timeoutMs]
 * @param {() => Date} [options.now]
 */
export function createNearClient({ fetch: f, timeoutMs = 20_000, now = () => new Date() }) {
	/** One request, with a timeout and no redirect followed. @type {typeof fetch} */
	const timed = (url, init = {}) =>
		f(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });

	return {
		/**
		 * @param {{ chain: import('./registry.js').NearChain, address: string, endpoints: { api: string, rpc: string } }} params
		 */
		async history({ chain, address, endpoints }) {
			const account = String(address ?? '')
				.trim()
				.toLowerCase();
			if (!isAccountId(account)) {
				throw new WalletError(
					'not a NEAR account id (name.near, or 64 hex characters)',
					'WALLET_ADDRESS',
					400
				);
			}
			const own = { api: endpoints.api, rpc: endpoints.rpc };
			/** @type {import('@le-space/ledger').LedgerEntry[]} */
			let ledger;
			/** @type {Awaited<ReturnType<typeof balancesNow>>} */
			let held;
			try {
				const raw = await fetchRaw({
					account,
					network: 'mainnet',
					from: FROM,
					to: now().toISOString().slice(0, 10),
					fetch: timed,
					maxPages: MAX_PAGES,
					endpoints: { ...own, explorer: chain.explorer.tx.replace('{tx}', '') }
				});
				ledger = await storagePurposes(
					await storageKept(mapRaw(raw), {
						network: 'mainnet',
						fetch: timed,
						endpoints: own
					}),
					{
						network: 'mainnet',
						routeOf: routeReader((method, params) => rpcCall(timed, own.rpc, method, params))
					}
				);
				const contracts = [
					...new Set(
						ledger
							.map((e) => e.contract)
							.filter((c) => Object.hasOwn(chain.tokens, c) || wrapped(c))
					)
				];
				held = await balancesNow({
					account,
					network: 'mainnet',
					contracts,
					fetch: timed,
					endpoints: own
				});
			} catch (error) {
				throw walletError(error, endpoints);
			}

			/** @type {Set<string>} */
			const unknown = new Set();
			/** @type {import('@le-space/ledger/wallet-entry').WalletEntry[]} */
			const entries = [];
			/** @type {Set<string>} ids left out as movements inside the wallet */
			const superseded = new Set();
			const native = chain.native.symbol;
			const short = (/** @type {string} */ id) => id.slice(`near:${account}:`.length);
			/** @param {{ asset: string, amount: string, listed: boolean }[]} sides */
			const asNative = (sides) =>
				sides.map((x) => (WRAPPED_SYMBOLS.has(x.asset) ? { ...x, asset: native } : x));
			/** @param {NonNullable<import('@le-space/ledger').LedgerEntry['swap']>} s */
			const sidesOf = (s) => ({ ...s, gave: asNative(s.gave), got: asNative(s.got) });
			/** NEAR for NEAR: wrapping or unwrapping, a movement inside the wallet. @param {ReturnType<typeof sidesOf>} s */
			const insideOf = (s) => s.got.every((g) => s.gave.some((x) => x.asset === g.asset));
			/** @type {Map<string, bigint>} swap hash → yoctoNEAR its storage deposits kept */
			const keptFor = new Map();
			for (const e of ledger)
				if (e.purpose === 'storage' && e.type === 'sent' && e.partOf)
					keptFor.set(e.partOf, (keptFor.get(e.partOf) ?? 0n) - toUnits(e.amount, e.decimals));
			/** @type {Map<string, any>} swap hash → its sides, with the storage deposits made for it */
			const swapOf = new Map();
			for (const e of ledger) {
				if (!e.swap || swapOf.has(e.hash)) continue;
				const kept = keptFor.get(e.hash);
				swapOf.set(e.hash, {
					...sidesOf(e.swap),
					...(kept ? { storage: { asset: 'NEAR', amount: fromUnits(kept, 24) } } : {})
				});
			}
			for (const e of ledger) {
				const wrap = e.contract !== 'native' && wrapped(e.contract);
				const token = e.contract === 'native' || wrap ? null : chain.tokens[e.contract];
				if (e.contract !== 'native' && !wrap && !token) {
					unknown.add(e.contract);
					continue;
				}
				// A storage deposit: a cost to the network's contracts, as gas is –
				// of the swap it was made for, or of the transfer or receipt it let happen.
				const partOf = e.partOf;
				const deposit = e.purpose === 'storage' && e.type === 'sent';
				const fee = e.type === 'fee' || deposit;
				const swap = partOf ? swapOf.get(partOf) : e.swap ? swapOf.get(e.hash) : undefined;
				const inside = !partOf && !!swap && insideOf(swap);
				if (
					!fee &&
					(inside ||
						// The same without its other side: wNEAR minted or burnt, NEAR handed to the wrap contract.
						(wrap && (e.method === 'mint' || e.method === 'burn' || !e.counterparty)) ||
						(e.contract === 'native' && e.method === 'near_deposit' && wrapped(e.counterparty)))
				) {
					superseded.add(short(e.id));
					continue;
				}
				const swapped = !!swap && !inside;
				entries.push({
					// `<hash>:fee`, `<hash>:deposit`, `<hash>:ft:<receipt>:<event>`
					id: short(e.id),
					hash: e.hash,
					height: e.height,
					time: e.time,
					date: e.date,
					type: fee ? 'fee' : /** @type {'sent' | 'received'} */ (e.type),
					kind: fee
						? 'fee'
						: e.kind === 'stake'
							? 'stake'
							: swapped && e.kind === 'swap'
								? 'swap'
								: 'transfer',
					...(swapped ? { swap } : {}),
					// The swap's transaction, for a storage deposit made for it.
					...(partOf ? { partOf } : {}),
					// The transfer or receipt a storage deposit let happen.
					...(e.enables ? { enables: e.enables } : {}),
					...(deposit ? { purpose: /** @type {const} */ ('storage') } : {}),
					// The 1 yoctoNEAR a token transfer attaches, kept by the token contract.
					...(e.purpose === 'security' ? { purpose: /** @type {const} */ ('security') } : {}),
					...(deposit && e.registration ? { registration: e.registration } : {}),
					asset: token?.symbol ?? native,
					amount: e.amount,
					decimals: token?.decimals ?? chain.native.decimals,
					// A storage deposit keeps the contract it registered at.
					counterparty: e.type === 'fee' ? '' : e.counterparty,
					counterpartyLabel: '',
					memo: '',
					success: e.success,
					explorerUrl: e.explorerUrl
				});
			}
			// wNEAR held is NEAR held.
			let nativeUnits = held.native;
			for (const [contract, units] of Object.entries(held.tokens))
				if (wrapped(contract)) nativeUnits += units;
			entries.sort((x, y) =>
				x.height === y.height ? (x.id < y.id ? -1 : 1) : x.height - y.height
			);
			return {
				entries,
				balances: [
					{
						asset: chain.native.symbol,
						amount: unitsToDecimal(nativeUnits, chain.native.decimals),
						decimals: chain.native.decimals
					},
					...Object.entries(held.tokens)
						.filter(([contract]) => !wrapped(contract))
						.map(([contract, units]) => ({
							asset: chain.tokens[contract].symbol,
							amount: unitsToDecimal(units, chain.tokens[contract].decimals),
							decimals: chain.tokens[contract].decimals
						}))
				],
				transactions: new Set(entries.map((e) => e.hash)).size,
				unknownAssets: unknown.size,
				superseded: [...superseded].sort(),
				history: { earliestHeight: 0, earliestTime: null, pruned: false },
				addressUrl: addressUrl(chain.explorer, account)
			};
		}
	};
}

/**
 * What near.js threw, as the wallet service's error: a code, and a message
 * that names the hosts asked and nothing of the account.
 *
 * @param {any} error
 * @param {{ api: string, rpc: string }} endpoints
 */
function walletError(error, endpoints) {
	if (error instanceof WalletError) return error;
	const hosts = `${hostOf(endpoints.api)} / ${hostOf(endpoints.rpc)}`;
	const message = String(error?.message ?? '');
	if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
		return new WalletError(`${hosts} did not answer in time`, 'WALLET_TIMEOUT', 504);
	}
	if (error instanceof TypeError) {
		return new WalletError(`${hosts} is not reachable`, 'WALLET_UNREACHABLE');
	}
	if (/^more than \d+ pages/.test(message)) {
		return new WalletError(
			`more than ${MAX_PAGES * 25} transactions on this account`,
			'WALLET_TOO_LARGE',
			413
		);
	}
	if (/answered 429/.test(message)) {
		return new WalletError(`${hosts} limits requests (HTTP 429)`, 'WALLET_RATE_LIMIT', 429);
	}
	const status = /answered (\d{3})/.exec(message)?.[1];
	return new WalletError(
		status ? `${hosts} answered ${status}` : `${hosts} could not be read`,
		'WALLET_NODE'
	);
}

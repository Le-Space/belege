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
// Error messages name a host at most, never the account: the bridge logs them.

import { balancesNow, fetchRaw, isAccountId, mapRaw, storageKept, TOKENS } from './near.js';
import { addressUrl, hostOf, unitsToDecimal, WalletError } from './core.js';

/** The wrap contract's token: NEAR under another name. @param {string} contract */
const wrapped = (contract) =>
	/** @type {Record<string, { priceAs: string }>} */ (TOKENS.mainnet)[contract]?.priceAs === 'NEAR';
const WRAPPED_SYMBOLS = new Set(
	Object.values(TOKENS.mainnet)
		.filter((t) => t.priceAs === 'NEAR')
		.map((t) => t.symbol)
);

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
				ledger = await storageKept(mapRaw(raw), {
					network: 'mainnet',
					fetch: timed,
					endpoints: own
				});
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
			for (const e of ledger) {
				const wrap = e.contract !== 'native' && wrapped(e.contract);
				const token = e.contract === 'native' || wrap ? null : chain.tokens[e.contract];
				if (e.contract !== 'native' && !wrap && !token) {
					unknown.add(e.contract);
					continue;
				}
				const fee = e.type === 'fee';
				const swap = e.swap
					? { ...e.swap, gave: asNative(e.swap.gave), got: asNative(e.swap.got) }
					: undefined;
				// NEAR for NEAR: wrapping or unwrapping, a movement inside the wallet.
				const inside = !!swap && swap.got.every((g) => swap.gave.some((x) => x.asset === g.asset));
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
					type: /** @type {'sent' | 'received' | 'fee'} */ (e.type),
					kind: fee
						? 'fee'
						: e.kind === 'stake'
							? 'stake'
							: swapped && e.kind === 'swap'
								? 'swap'
								: 'transfer',
					...(swapped ? { swap } : {}),
					asset: token?.symbol ?? native,
					amount: e.amount,
					decimals: token?.decimals ?? chain.native.decimals,
					counterparty: fee ? '' : e.counterparty,
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

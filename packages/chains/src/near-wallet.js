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
// Error messages name a host at most, never the account: the bridge logs them.

import { balancesNow, fetchRaw, isAccountId, mapRaw, storageKept } from './near.js';
import { addressUrl, hostOf, unitsToDecimal, WalletError } from './core.js';

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
					...new Set(ledger.map((e) => e.contract).filter((c) => Object.hasOwn(chain.tokens, c)))
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
			for (const e of ledger) {
				const token = e.contract === 'native' ? null : chain.tokens[e.contract];
				if (e.contract !== 'native' && !token) {
					unknown.add(e.contract);
					continue;
				}
				const fee = e.type === 'fee';
				entries.push({
					// `<hash>:fee`, `<hash>:deposit`, `<hash>:ft:<receipt>:<event>`
					id: e.id.slice(`near:${account}:`.length),
					hash: e.hash,
					height: e.height,
					time: e.time,
					date: e.date,
					type: /** @type {'sent' | 'received' | 'fee'} */ (e.type),
					kind: fee ? 'fee' : e.kind === 'stake' ? 'stake' : 'transfer',
					asset: token?.symbol ?? chain.native.symbol,
					amount: e.amount,
					decimals: token?.decimals ?? chain.native.decimals,
					counterparty: fee ? '' : e.counterparty,
					counterpartyLabel: '',
					memo: '',
					success: e.success,
					explorerUrl: e.explorerUrl
				});
			}
			entries.sort((x, y) =>
				x.height === y.height ? (x.id < y.id ? -1 : 1) : x.height - y.height
			);
			return {
				entries,
				balances: [
					{
						asset: chain.native.symbol,
						amount: unitsToDecimal(held.native, chain.native.decimals),
						decimals: chain.native.decimals
					},
					...Object.entries(held.tokens).map(([contract, units]) => ({
						asset: chain.tokens[contract].symbol,
						amount: unitsToDecimal(units, chain.tokens[contract].decimals),
						decimals: chain.tokens[contract].decimals
					}))
				],
				transactions: new Set(entries.map((e) => e.hash)).size,
				unknownAssets: unknown.size,
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

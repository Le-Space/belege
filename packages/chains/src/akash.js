// SPDX-License-Identifier: AGPL-3.0-or-later
// Akash as ledger entries, for an Eigenbeleg or a Kontoauszug (from the
// Eigenbeleg agent's readers/akash.js). The reading is cosmos.js: the node's
// `tx_search` for everything it still has, the Akash Console indexer for what
// the pruned node has forgotten. This file keeps what a document reads
// differently from a wallet view: the fee goes to the network, an escrow
// deposit is a kind of its own, only AKT is priced; and the period.

import { derivedStatement, fromWalletEntry, sortEntries } from '@le-space/ledger';
import { createCosmosClient } from './cosmos.js';
import { AKASH_CHAIN } from './cosmos-chains.js';
import { createAkashConsoleClient } from './akash-console.js';
import { isCosmosAddress } from './bech32.js';

/** Market prices for the native assets. */
const PRICE_AS = { AKT: 'AKT' };
const NETWORK_LABEL = 'Akash-Netzwerk (Gebühr an Validatoren)';

/**
 * A WalletEntry → the ledger entry a document books.
 *
 * @param {import('@le-space/ledger/wallet-entry').WalletEntry} e
 * @param {{ chain: typeof AKASH_CHAIN, account: string }} c
 */
export function toLedger(e, { chain, account }) {
	const escrow = /Escrow/i.test(String(e.counterpartyLabel ?? ''));
	const kind =
		e.type === 'fee'
			? 'fee'
			: e.kind === 'ibc'
				? 'transfer'
				: escrow
					? 'escrow'
					: e.kind === 'swap'
						? 'swap'
						: ['reward', 'stake'].includes(e.kind)
							? e.kind
							: 'transfer';
	const fee = e.type === 'fee';
	return fromWalletEntry(
		e,
		{
			chain: chain.id,
			network: 'mainnet',
			account,
			priceAs: PRICE_AS[/** @type {keyof typeof PRICE_AS} */ (e.asset)] ?? ''
		},
		{
			kind,
			counterparty: fee ? chain.id : String(e.counterparty ?? ''),
			counterpartyLabel: fee ? NETWORK_LABEL : String(e.counterpartyLabel ?? ''),
			memo: String(e.memo ?? ''),
			// A failed transaction still pays its fee: the fee is a real payment.
			success: fee ? true : e.success !== false
		}
	);
}

/**
 * @param {object} p
 * @param {string} p.account bech32 address
 * @param {string} [p.network] mainnet only
 * @param {string} p.from YYYY-MM-DD
 * @param {string} p.to YYYY-MM-DD
 * @param {typeof fetch} [p.fetch]
 * @param {Record<string, string>} [p.endpoints] instead of the chain's own, e.g. `indexer` behind a CORS proxy in a browser
 */
async function history({ account, from, fetch = globalThis.fetch, endpoints: own }) {
	const chain = AKASH_CHAIN;
	if (!isCosmosAddress(account, chain.bech32Prefix))
		throw new Error(`not a valid ${chain.name} address`);
	const endpoints = { ...chain.endpoints, ...own };
	const node = createCosmosClient({ fetch });
	const result = await node.history({ chain, address: account, endpoints });
	let entries = result.entries;
	if (
		result.history.pruned &&
		endpoints.indexer &&
		result.history.earliestTime &&
		result.history.earliestTime.slice(0, 10) > from
	) {
		const older = await createAkashConsoleClient({ fetch }).history({
			chain,
			address: account,
			indexer: endpoints.indexer,
			beforeHeight: result.history.earliestHeight
		});
		entries = [...older.entries, ...entries];
	}
	return {
		chain,
		all: sortEntries(entries.map((e) => toLedger(e, { chain, account }))),
		balances: result.balances
	};
}

/** Ledger entries for an account and period. @param {Parameters<typeof history>[0]} p */
export async function readAkash(p) {
	const { all } = await history(p);
	return all.filter((e) => e.date >= p.from && e.date <= p.to);
}

/**
 * For a Kontoauszug: the bookings of the period, and the balances before and
 * after it, derived from today's balance less every movement since. (Pruned
 * nodes keep no old balances.) What the reader cannot see – tokens coming back
 * when an unbonding ends, vesting – shifts the derived balances; the
 * statement says how they were made.
 *
 * @param {Parameters<typeof history>[0]} p
 */
export async function statementAkash(p) {
	const { all, balances } = await history(p);
	return derivedStatement(all, balances, p.from, p.to);
}

/** The public node must answer for Akash's own chain id. @param {{ fetch?: typeof fetch, endpoints?: { rpc?: string } }} [o] */
export async function probe({ fetch = globalThis.fetch, endpoints } = {}) {
	const rpc = endpoints?.rpc ?? AKASH_CHAIN.endpoints.rpc;
	const res = await fetch(`${rpc}/status`);
	if (!res.ok) throw new Error(`Akash RPC answered ${res.status}`);
	const body = await res.json();
	if (body?.result?.node_info?.network !== AKASH_CHAIN.chainId)
		throw new Error('the Akash RPC belongs to another chain');
	return {
		sample: `${rpc} status`,
		entries: Number(body.result.sync_info?.latest_block_height ?? 0) > 0 ? 1 : 0
	};
}

/** @param {string} a */
export const isAddress = (a) => isCosmosAddress(a, AKASH_CHAIN.bech32Prefix);

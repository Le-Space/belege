// SPDX-License-Identifier: AGPL-3.0-or-later
// One Bitcoin address, read only: what it paid, what it received and what
// the miners got, as ledger entries for an Eigenbeleg or a monthly
// Kontoauszug. Where bitcoin.js reads a whole wallet from its extended key
// (for the bridge, with the key in the keychain), this reads addresses the
// person names, so no key is needed and nothing is derived.
//
// The history comes from an Esplora API (mempool.space by default, or the
// person's own), `fetch` handed in:
//   GET /address/<a>                     chain_stats: the balance now
//   GET /address/<a>/txs/chain[/<last>]  its confirmed transactions, 25 a page
// That API sees every address asked and the caller's IP address, so it can
// tell the addresses of one request belong together; an own Esplora avoids it.
//
// A transaction becomes entries as in bitcoin.js, seen from the one address:
//   - every input from the address: it sent. The miner fee is an entry of
//     its own, the rest went to the others (nothing, if all came back);
//   - no input from it: it received what went to it;
//   - some inputs from it: one entry with the net change, fee included.
// Only confirmed transactions are read. Error messages name a host at most,
// never an address or the server's text.

import { derivedStatement, fromWalletEntry, sortEntries } from '@le-space/ledger';
import { unitsToDecimal } from '@le-space/ledger/decimal';

import { BITCOIN } from './bitcoin-chain.js';
import { normalizeBitcoin } from './bitcoin.js';
import { scriptOf } from './address-script.js';
import { createJsonFetcher, WalletError } from './http.js';

export { BITCOIN };

/** Esplora's page of an address's confirmed transactions. */
const PAGE = 25;
/** 25 000 transactions: more is an exchange's address, not a person's. */
const MAX_PAGES = 1000;

/** @param {string} address @param {typeof BITCOIN} [chain] */
export const isBitcoinAddress = (address, chain = BITCOIN) =>
	scriptOf(address, /** @type {any} */ (chain)) !== null;

/**
 * @typedef {object} ReadOptions
 * @property {string} account the own address (1…, 3…, bc1…)
 * @property {string[]} [own] the request's other own addresses: a transfer to or from one is named so
 * @property {typeof fetch} [fetch]
 * @property {{ api?: string }} [endpoints] instead of mempool.space, e.g. an own Esplora
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {typeof BITCOIN} [chain]
 */

/**
 * A WalletEntry → the ledger entry a document books.
 *
 * @param {import('@le-space/ledger/wallet-entry').WalletEntry} e
 * @param {string} account
 * @param {Set<string>} [own]
 */
export function toLedger(e, account, own = new Set()) {
	const fee = e.type === 'fee';
	return fromWalletEntry(
		e,
		{ chain: 'bitcoin', network: 'mainnet', account, priceAs: 'BTC' },
		{
			kind: fee ? 'fee' : 'transfer',
			counterparty: fee ? 'bitcoin' : String(e.counterparty ?? ''),
			counterpartyLabel: fee
				? 'Bitcoin-Netzwerk (Miner-Gebühr)'
				: own.has(String(e.counterparty ?? ''))
					? 'eigene Adresse'
					: ''
		}
	);
}

/**
 * An address's confirmed transactions and its balance.
 *
 * @param {ReadOptions} p
 */
export async function historyOf(p) {
	const chain = p.chain ?? BITCOIN;
	if (!isBitcoinAddress(p.account, chain))
		throw new WalletError('not a valid Bitcoin address', 'WALLET_ADDRESS', 400);
	const api = (p.endpoints?.api ?? chain.endpoints.api).replace(/\/+$/, '');
	const get = createJsonFetcher({ fetch: p.fetch ?? globalThis.fetch, sleep: p.sleep });
	const base = `${api}/address/${encodeURIComponent(p.account)}`;

	const info = await get(base);
	const stats = info?.chain_stats;
	if (!stats || typeof stats !== 'object')
		throw new WalletError(`${new URL(api).host} answered without the address`, 'WALLET_NODE');

	/** @type {Map<string, import('./bitcoin.js').EsploraTx>} */
	const txs = new Map();
	let last = '';
	for (let page = 0; Number(stats.tx_count ?? 0) > 0; page++) {
		if (page >= MAX_PAGES)
			throw new WalletError('more than 25,000 transactions', 'WALLET_TOO_LARGE', 413);
		/** @type {import('./bitcoin.js').EsploraTx[]} */
		const list = await get(`${base}/txs/chain${last ? `/${last}` : ''}`);
		if (!Array.isArray(list) || !list.length) break;
		for (const tx of list) if (tx?.status?.confirmed) txs.set(tx.txid, tx);
		last = list[list.length - 1].txid;
		if (list.length < PAGE) break;
	}
	const balance = BigInt(stats.funded_txo_sum ?? 0) - BigInt(stats.spent_txo_sum ?? 0);
	return {
		txs: [...txs.values()],
		balance: unitsToDecimal(balance, chain.native.decimals),
		unconfirmed: Number(info?.mempool_stats?.tx_count ?? 0)
	};
}

/** @param {ReadOptions} p */
async function ledgerHistory(p) {
	const chain = p.chain ?? BITCOIN;
	const own = new Set((p.own ?? []).filter((a) => a !== p.account));
	const { txs, balance } = await historyOf(p);
	return {
		all: sortEntries(
			normalizeBitcoin(txs, new Set([p.account]), chain).map((e) => toLedger(e, p.account, own))
		),
		balances: [{ asset: chain.native.symbol, amount: balance }]
	};
}

/** Ledger entries for an address and period. @param {ReadOptions & { from: string, to: string }} p */
export async function readBitcoin(p) {
	const { all } = await ledgerHistory(p);
	return all.filter((e) => e.date >= p.from && e.date <= p.to);
}

/** For a Kontoauszug: balances derived from today's balance less the movements since. @param {ReadOptions & { from: string, to: string }} p */
export async function statementBitcoin(p) {
	const { all, balances } = await ledgerHistory(p);
	return derivedStatement(all, balances, p.from, p.to);
}

/** Does the Esplora API answer? It knows the tip's height. @param {Pick<ReadOptions, 'fetch' | 'endpoints' | 'chain'>} [o] */
export async function probe(o = {}) {
	const chain = o.chain ?? BITCOIN;
	const api = (o.endpoints?.api ?? chain.endpoints.api).replace(/\/+$/, '');
	const res = await (o.fetch ?? globalThis.fetch)(`${api}/blocks/tip/height`, {
		signal: AbortSignal.timeout(20_000),
		redirect: 'error'
	});
	const height = Number(await res.text());
	if (!res.ok || !(height > 900_000))
		throw new Error(`${new URL(api).host} answered without a tip`);
	return { sample: 'Esplora tip height', entries: 1 };
}

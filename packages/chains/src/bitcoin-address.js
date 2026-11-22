// SPDX-License-Identifier: AGPL-3.0-or-later
// One Bitcoin address, read only: what it paid, what it received and what
// the miners got, as ledger entries for an Eigenbeleg or a monthly
// Kontoauszug. It reads an address the person names, or a whole wallet from
// its account's extended public key (xpub, ypub, zpub): the addresses are
// derived here, as bitcoin.js does for the bridge, and only they are asked;
// the key never leaves the caller, and the documents name the wallet by the
// key's fingerprint.
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
import { deriveAddress, keyFingerprint, normalizeBitcoin, parseExtendedKey } from './bitcoin.js';
import { scriptOf } from './address-script.js';
import { createJsonFetcher, WalletError } from './http.js';

export { BITCOIN };

/** Esplora's page of an address's confirmed transactions. */
const PAGE = 25;
/** 25 000 transactions: more is an exchange's address, not a person's. */
const MAX_PAGES = 1000;
/** As bitcoin.js: a wallet's addresses end after 20 in a row never used (BIP44). */
const GAP_LIMIT = 20;
const MAX_ADDRESSES = 2000;

/** @param {string} address @param {typeof BITCOIN} [chain] */
export const isBitcoinAddress = (address, chain = BITCOIN) =>
	scriptOf(address, /** @type {any} */ (chain)) !== null;

/**
 * @typedef {object} ReadOptions
 * @property {string} account the own address (1…, 3…, bc1…), or a wallet's xpub, ypub or zpub
 * @property {string[]} [own] the request's other own addresses: a transfer to or from one is named so
 * @property {typeof fetch} [fetch]
 * @property {{ api?: string }} [endpoints] instead of mempool.space, e.g. an own Esplora
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {number} [pauseMs] a wallet: the pause between requests (250 ms)
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
 * Pauses after the API has refused a page although it answered before. A
 * public Esplora limits how fast one may ask; mempool.space answers 503 or 429
 * then, and in a browser, where that answer lacks CORS headers, the refusal
 * looks like no answer at all.
 */
const THROTTLE_PAUSES = [15_000, 30_000, 60_000];

/**
 * A getter that waits when the API limits requests. Before the API has
 * answered once, an error is what it says; after that, a refusal (no answer,
 * 429, 5xx) is taken as the limit: wait, ask again, and at last say that the
 * API limits requests, not that it is not reachable.
 *
 * @param {string} api
 * @param {Pick<ReadOptions, 'fetch' | 'sleep'>} p
 */
function patientGetter(api, p) {
	const sleep = p.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const get = createJsonFetcher({ fetch: p.fetch ?? globalThis.fetch, sleep });
	const host = new URL(api).host;
	let answered = false;
	/** @param {any} e */
	const refused = (e) =>
		e instanceof WalletError &&
		(e.code === 'WALLET_RATE_LIMIT' ||
			e.code === 'WALLET_UNREACHABLE' ||
			e.code === 'WALLET_TIMEOUT' ||
			(e.code === 'WALLET_NODE' && Number(e.httpStatus) >= 500));
	/** @param {string} url */
	return async function patient(url) {
		for (let round = 0; ; round++) {
			try {
				const body = await get(url);
				answered = true;
				return body;
			} catch (e) {
				const limited =
					/** @type {any} */ (e)?.code === 'WALLET_RATE_LIMIT' || (answered && refused(e));
				if (!limited) throw e;
				if (round >= THROTTLE_PAUSES.length)
					throw new WalletError(
						`${host} limits requests: try again in a few minutes`,
						'WALLET_RATE_LIMIT',
						429
					);
				await sleep(THROTTLE_PAUSES[round]);
			}
		}
	};
}

/** The UTC day of a confirmed Esplora transaction, YYYY-MM-DD. @param {any} tx */
const dayOf = (tx) =>
	tx?.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString().slice(0, 10) : '';

/**
 * The confirmed transactions of one address, newest first, page by page.
 * With `since` (YYYY-MM-DD), paging stops once a page reaches back before
 * that day: what is older is not needed for the period, and a busy address
 * asks far fewer pages.
 *
 * @param {(url: string) => Promise<any>} get
 * @param {string} base `<api>/address/<address>`
 * @param {Map<string, import('./bitcoin.js').EsploraTx>} into
 * @param {string} [since]
 */
async function readPages(get, base, into, since) {
	let last = '';
	for (let page = 0; ; page++) {
		if (page >= MAX_PAGES)
			throw new WalletError('more than 25,000 transactions', 'WALLET_TOO_LARGE', 413);
		/** @type {import('./bitcoin.js').EsploraTx[]} */
		const list = await get(`${base}/txs/chain${last ? `/${last}` : ''}`);
		if (!Array.isArray(list) || !list.length) return;
		for (const tx of list) if (tx?.status?.confirmed) into.set(tx.txid, tx);
		last = list[list.length - 1].txid;
		if (list.length < PAGE) return;
		const oldest = dayOf(list[list.length - 1]);
		if (since && oldest && oldest < since) return;
	}
}

/** @param {string} api @param {any} info */
function statsOf(api, info) {
	const stats = info?.chain_stats;
	if (!stats || typeof stats !== 'object')
		throw new WalletError(`${new URL(api).host} answered without the address`, 'WALLET_NODE');
	return stats;
}

/**
 * An address's confirmed transactions and its balance (see readPages for `since`).
 *
 * @param {ReadOptions & { since?: string }} p
 */
export async function historyOf(p) {
	const chain = p.chain ?? BITCOIN;
	if (!isBitcoinAddress(p.account, chain))
		throw new WalletError('not a valid Bitcoin address', 'WALLET_ADDRESS', 400);
	const api = (p.endpoints?.api ?? chain.endpoints.api).replace(/\/+$/, '');
	const get = patientGetter(api, p);
	const base = `${api}/address/${encodeURIComponent(p.account)}`;

	const info = await get(base);
	const stats = statsOf(api, info);
	/** @type {Map<string, import('./bitcoin.js').EsploraTx>} */
	const txs = new Map();
	if (Number(stats.tx_count ?? 0) > 0) await readPages(get, base, txs, p.since);
	const balance = BigInt(stats.funded_txo_sum ?? 0) - BigInt(stats.spent_txo_sum ?? 0);
	return {
		txs: [...txs.values()],
		balance: unitsToDecimal(balance, chain.native.decimals),
		unconfirmed: Number(info?.mempool_stats?.tx_count ?? 0)
	};
}

/**
 * A wallet's confirmed transactions and its balance, from its account's
 * extended public key: addresses derived as bitcoin.js does (receive /0/i
 * and change /1/i, until 20 in a row were never used), each asked of the
 * API. The key itself is never sent; the API sees the addresses, and can
 * tell they belong together.
 *
 * @param {ReadOptions & { since?: string, type?: string }} p `account` is the xpub, ypub or zpub
 */
export async function walletHistoryOf(p) {
	const chain = p.chain ?? BITCOIN;
	const { account, type } = parseExtendedKey(p.account, p.type);
	const api = (p.endpoints?.api ?? chain.endpoints.api).replace(/\/+$/, '');
	const sleep = p.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const patient = patientGetter(api, { ...p, sleep });
	// A wallet asks many addresses: a short pause between requests keeps a
	// public API from limiting them.
	const pause = p.pauseMs ?? 250;
	/** @param {string} url */
	const get = async (url) => {
		if (pause) await sleep(pause);
		return patient(url);
	};

	/** @type {Set<string>} */
	const own = new Set();
	/** @type {{ address: string, txs: number }[]} */
	const used = [];
	let funded = 0n;
	let spent = 0n;
	let unconfirmed = 0;
	for (const branch of /** @type {const} */ ([0, 1])) {
		for (let i = 0, unused = 0; unused < GAP_LIMIT; i++) {
			if (own.size >= MAX_ADDRESSES)
				throw new WalletError('more than 2000 addresses in use', 'WALLET_TOO_LARGE', 413);
			const address = deriveAddress(account, type, branch, i);
			own.add(address);
			const info = await get(`${api}/address/${address}`);
			const stats = statsOf(api, info);
			const pending = Number(info?.mempool_stats?.tx_count ?? 0);
			const count = Number(stats.tx_count ?? 0);
			if (count + pending === 0) {
				unused++;
				continue;
			}
			unused = 0;
			unconfirmed += pending;
			funded += BigInt(stats.funded_txo_sum ?? 0);
			spent += BigInt(stats.spent_txo_sum ?? 0);
			used.push({ address, txs: count });
		}
	}
	/** @type {Map<string, import('./bitcoin.js').EsploraTx>} */
	const txs = new Map();
	for (const u of used)
		if (u.txs) await readPages(get, `${api}/address/${u.address}`, txs, p.since);
	return {
		txs: [...txs.values()],
		own,
		balance: unitsToDecimal(funded - spent, chain.native.decimals),
		unconfirmed,
		addresses: { used: used.length, derived: own.size }
	};
}

/**
 * Whether the text is an extended public key (xpub…, ypub…, zpub…) rather
 * than an address. Says nothing about its checksum; reading checks that.
 *
 * @param {string} text
 */
export const isExtendedKey = (text) =>
	/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,}$/.test(String(text ?? '').trim());

/**
 * What a document names as the account: the address, or for a wallet its
 * key's fingerprint (`btc-` + 8 hex), never the key, which would show every
 * address of the wallet to whoever reads the document.
 *
 * @param {string} account an address or an extended public key
 */
export const accountOf = (account) =>
	isExtendedKey(account) ? keyFingerprint(account) : String(account ?? '').trim();

/** @param {ReadOptions & { since?: string, type?: string }} p */
async function ledgerHistory(p) {
	const chain = p.chain ?? BITCOIN;
	const wallet = isExtendedKey(p.account);
	const name = accountOf(p.account);
	const read = wallet ? await walletHistoryOf(p) : await historyOf(p);
	const mine = wallet
		? /** @type {Set<string>} */ (/** @type {{ own: Set<string> }} */ (read).own)
		: new Set([p.account]);
	const others = new Set((p.own ?? []).filter((a) => !mine.has(a)));
	return {
		all: sortEntries(normalizeBitcoin(read.txs, mine, chain).map((e) => toLedger(e, name, others))),
		balances: [{ asset: chain.native.symbol, amount: read.balance }]
	};
}

/**
 * Ledger entries for an address, or a wallet by its extended key, and a
 * period. A wallet's entries carry its fingerprint as their account
 * (accountOf); payments between its own addresses (change) are no entries.
 *
 * @param {ReadOptions & { from: string, to: string, type?: string }} p
 */
export async function readBitcoin(p) {
	const { all } = await ledgerHistory({ ...p, since: p.from.slice(0, 10) });
	return all.filter((e) => e.date >= p.from && e.date <= p.to);
}

/**
 * For a Kontoauszug: balances derived from today's balance less the movements
 * since, so everything from the period's start to today is read, nothing older.
 *
 * @param {ReadOptions & { from: string, to: string, type?: string }} p
 */
export async function statementBitcoin(p) {
	const { all, balances } = await ledgerHistory({ ...p, since: p.from.slice(0, 10) });
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

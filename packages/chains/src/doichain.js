// SPDX-License-Identifier: AGPL-3.0-or-later
// A Doichain address, read only (issue #884): what it paid, what it received
// and what the miners got, as ledger entries for an Eigenbeleg or a monthly
// Kontoauszug. The history comes from an ElectrumX server over WebSocket
// (electrum.js), no key:
//
//   blockchain.block.header [431018]             is this the valid chain?
//   blockchain.scripthash.get_history [h]        the address's transactions
//   blockchain.transaction.get [txid, true]      one transaction, decoded by
//                                                the node; asked again for
//                                                each input's earlier output
//   blockchain.scripthash.get_balance [h]        the balance now
//
// `h` is the script hash of the address: the SHA-256 of its output script,
// byte-reversed. The server sees every script hash asked and the caller's IP
// address, so it can tell the addresses of one request belong together.
//
// Doichain descends from Bitcoin through Namecoin, so a transaction becomes
// entries as in bitcoin.js, seen from the one address:
//   - every input from the address: it sent. The miner fee is an entry of
//     its own, the rest went to the others (nothing, if all came back);
//   - no input from it: it received what went to it; a block's first
//     transaction (coinbase) is a reward;
//   - some inputs from it: one entry with the net change, fee included.
// Only confirmed transactions are read.
//
// Name operations (name_doi, name_firstupdate, name_update, …): a name is a
// coin of 0.01 DOI whose output script carries the name in front of the
// address script. ElectrumX files it under the address, so it is part of
// the address's balance and its history. Registering or updating a name of
// one's own therefore moves nothing: the coin comes back to the address, and
// only the fee is spent – the entry names the operation and the name. A name
// that goes to another address takes its 0.01 DOI along, as a transfer.

import { bech32, bech32m, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from '@le-space/ledger/bytes';
import { unitsToDecimal } from '@le-space/ledger/decimal';
import { derivedStatement, fromWalletEntry, sortEntries } from '@le-space/ledger';

import { normalizeBitcoin } from './bitcoin.js';
import { DOICHAIN } from './doichain-chain.js';
import { connectElectrum } from './electrum.js';
import { WalletError } from './http.js';

export { DOICHAIN };

const base58check = createBase58check(sha256);
/** Requests in flight at once on the one connection. */
const PARALLEL = 8;
/** A name on a document: long enough for an e-mail name, not a whole value. */
const NAME_LENGTH = 80;

/**
 * The output script of an address, or null where it is none of this chain.
 *
 * @param {string} address
 * @param {import('./doichain-chain.js').DoichainChain} [chain]
 * @returns {Uint8Array | null}
 */
export function scriptOf(address, chain = DOICHAIN) {
	if (typeof address !== 'string' || address.length < 26 || address.length > 90) return null;
	const { bech32: prefix, pubKeyHash, scriptHash } = chain.address;
	if (address.toLowerCase().startsWith(`${prefix}1`)) {
		for (const coder of [bech32, bech32m]) {
			try {
				const { prefix: found, words } = coder.decode(
					/** @type {`${string}1${string}`} */ (address),
					90
				);
				if (found !== prefix || words.length < 1) return null;
				const version = words[0];
				const program = coder.fromWords(words.slice(1));
				// Version 0 is bech32 with a 20 or 32 byte program; 1 to 16 are bech32m (BIP350).
				if (version === 0 && coder === bech32 && (program.length === 20 || program.length === 32))
					return Uint8Array.of(0x00, program.length, ...program);
				if (
					version >= 1 &&
					version <= 16 &&
					coder === bech32m &&
					program.length >= 2 &&
					program.length <= 40
				)
					return Uint8Array.of(0x50 + version, program.length, ...program);
				return null;
			} catch {
				// the other checksum, or no address
			}
		}
		return null;
	}
	try {
		const payload = base58check.decode(address);
		if (payload.length !== 21) return null;
		const hash = payload.subarray(1);
		if (payload[0] === pubKeyHash) return Uint8Array.of(0x76, 0xa9, 0x14, ...hash, 0x88, 0xac);
		if (payload[0] === scriptHash) return Uint8Array.of(0xa9, 0x14, ...hash, 0x87);
	} catch {
		// no base58check
	}
	return null;
}

/** @param {string} address @param {import('./doichain-chain.js').DoichainChain} [chain] */
export const isDoichainAddress = (address, chain = DOICHAIN) => scriptOf(address, chain) !== null;

/**
 * What ElectrumX knows an address by.
 *
 * @param {string} address
 * @param {import('./doichain-chain.js').DoichainChain} [chain]
 */
export function scripthashOf(address, chain = DOICHAIN) {
	const script = scriptOf(address, chain);
	if (!script) throw new WalletError('not a valid Doichain address', 'WALLET_ADDRESS', 400);
	return toHex(sha256(script).reverse());
}

/** A block's hash from its header (the first 80 bytes; a merge-mined header carries more). @param {string} headerHex */
export function blockHash(headerHex) {
	return toHex(sha256(sha256(fromHex(headerHex.slice(0, 160)))).reverse());
}

/**
 * Does this server follow the valid chain? Asked before anything is read.
 *
 * @param {import('./electrum.js').ElectrumServer} server
 * @param {import('./doichain-chain.js').DoichainChain} [chain]
 */
export async function verifyChain(server, chain = DOICHAIN) {
	const header = await server.request('blockchain.block.header', [chain.checkpoint.height]);
	const hex = typeof header === 'string' ? header : String(header?.header ?? '');
	return /^[0-9a-f]{160,}$/i.test(hex) && blockHash(hex) === chain.checkpoint.hash;
}

/** A node's amount in DOI (a JSON number) → swartz. @param {unknown} value */
const swartz = (value) => Math.round(Number(value ?? 0) * 1e8);

/** @param {any} scriptPubKey */
const addressOf = (scriptPubKey) =>
	String(scriptPubKey?.address ?? scriptPubKey?.addresses?.[0] ?? '');

/**
 * @typedef {import('./bitcoin.js').EsploraTx & {
 *   coinbase: boolean,
 *   nameOps: { op: string, name: string, address: string }[]
 * }} DoichainTx a transaction in the form bitcoin.js normalises, with what Doichain adds
 */

/**
 * Entries for one address's transactions (pure; the tests call it directly).
 *
 * @param {DoichainTx[]} txs confirmed, each once
 * @param {string} account the own address they are seen from
 * @param {import('./doichain-chain.js').DoichainChain} [chain]
 * @returns {import('./cosmos.js').WalletEntry[]}
 */
export function normalizeDoichain(txs, account, chain = DOICHAIN) {
	const byId = new Map(txs.map((tx) => [tx.txid, tx]));
	return normalizeBitcoin(txs, new Set([account]), /** @type {any} */ (chain)).map((e) =>
		byId.get(e.hash)?.coinbase && e.type === 'received' ? { ...e, kind: 'reward' } : e
	);
}

/** `name_update: e/…` for a transaction's name outputs, '' without one. @param {DoichainTx | undefined} tx */
function nameMemo(tx) {
	return (tx?.nameOps ?? [])
		.map(
			(n) => `${n.op}: ${n.name.length > NAME_LENGTH ? `${n.name.slice(0, NAME_LENGTH)}…` : n.name}`
		)
		.join('; ');
}

/**
 * A WalletEntry → the ledger entry a document books.
 *
 * @param {import('@le-space/ledger/wallet-entry').WalletEntry} e
 * @param {string} account
 * @param {DoichainTx} [tx] its transaction, for a name operation
 * @param {Set<string>} [own] the other own addresses of the request, to name a transfer between them
 */
export function toLedger(e, account, tx, own = new Set()) {
	const fee = e.type === 'fee';
	const names = nameMemo(tx);
	return fromWalletEntry(
		e,
		{ chain: 'doichain', network: 'mainnet', account, priceAs: 'DOI' },
		{
			kind: fee ? 'fee' : e.kind === 'reward' ? 'reward' : 'transfer',
			counterparty: fee ? 'doichain' : String(e.counterparty ?? ''),
			counterpartyLabel: fee
				? 'Doichain-Netzwerk (Miner-Gebühr)'
				: own.has(String(e.counterparty ?? ''))
					? 'eigene Adresse'
					: '',
			method: tx?.nameOps?.[0]?.op ?? '',
			memo: [names, e.memo].filter(Boolean).join(' – ')
		}
	);
}

/**
 * Runs `tasks` with a few in flight at once, in order of their results.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} run
 * @returns {Promise<R[]>}
 */
async function pooled(items, run) {
	/** @type {R[]} */
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await run(items[i]);
			}
		})
	);
	return out;
}

/**
 * An address's confirmed transactions and its balance, from one server.
 *
 * @param {import('./electrum.js').ElectrumServer} server
 * @param {string} address
 * @param {import('./doichain-chain.js').DoichainChain} [chain]
 * @returns {Promise<{ txs: DoichainTx[], balance: string, unconfirmed: number }>}
 */
export async function historyOf(server, address, chain = DOICHAIN) {
	const scripthash = scripthashOf(address, chain);
	/** @type {{ tx_hash: string, height: number }[]} */
	const history = (await server.request('blockchain.scripthash.get_history', [scripthash])) ?? [];
	const confirmed = history.filter((h) => Number(h.height) > 0);

	/** @type {Map<string, Promise<any>>} one request per transaction, also as an input's source */
	const cache = new Map();
	const get = (/** @type {string} */ txid) => {
		let tx = cache.get(txid);
		if (!tx) {
			tx = server.request('blockchain.transaction.get', [txid, true]);
			cache.set(txid, tx);
		}
		return tx;
	};

	const txs = await pooled(confirmed, async ({ tx_hash: txid, height }) => {
		const tx = await get(txid);
		if (!tx || !Array.isArray(tx.vin) || !Array.isArray(tx.vout))
			throw new WalletError(`${server.host} answered without a transaction`, 'DOICHAIN_ANSWER');
		const coinbase = tx.vin.some((/** @type {any} */ i) => i.coinbase !== undefined);
		const vin = await pooled(tx.vin, async (/** @type {any} */ input) => {
			if (input.coinbase !== undefined) return { prevout: null };
			const spent = (await get(input.txid))?.vout?.[input.vout];
			if (!spent)
				throw new WalletError(
					`${server.host} answered without an input's output`,
					'DOICHAIN_ANSWER'
				);
			return {
				prevout: {
					scriptpubkey_address: addressOf(spent.scriptPubKey),
					value: swartz(spent.value)
				}
			};
		});
		const vout = tx.vout.map((/** @type {any} */ o) => ({
			scriptpubkey_address: addressOf(o.scriptPubKey),
			value: swartz(o.value)
		}));
		const paid = vin.reduce((s, i) => s + (i.prevout?.value ?? 0), 0);
		const got = vout.reduce(
			(/** @type {number} */ s, /** @type {{ value: number }} */ o) => s + o.value,
			0
		);
		return /** @type {DoichainTx} */ ({
			txid,
			status: {
				confirmed: true,
				block_height: Number(height),
				block_time: Number(tx.blocktime ?? tx.time ?? 0)
			},
			fee: coinbase ? 0 : Math.max(0, paid - got),
			vin,
			vout,
			coinbase,
			nameOps: tx.vout
				.filter((/** @type {any} */ o) => o.scriptPubKey?.nameOp)
				.map((/** @type {any} */ o) => ({
					op: String(o.scriptPubKey.nameOp.op ?? 'name'),
					name: String(o.scriptPubKey.nameOp.name ?? ''),
					address: addressOf(o.scriptPubKey)
				}))
		});
	});

	const balance = await server.request('blockchain.scripthash.get_balance', [scripthash]);
	return {
		txs,
		balance: unitsToDecimal(BigInt(Number(balance?.confirmed ?? 0)), chain.native.decimals),
		unconfirmed: history.length - confirmed.length
	};
}

/**
 * The first server that answers and follows the valid chain, handed to `use`
 * and closed after it.
 *
 * @template R
 * @param {object} o
 * @param {import('./electrum.js').ElectrumConnect} [o.connect]
 * @param {{ electrum?: string[] }} [o.endpoints]
 * @param {import('./doichain-chain.js').DoichainChain} [o.chain]
 * @param {(server: import('./electrum.js').ElectrumServer) => Promise<R>} use
 * @returns {Promise<R>}
 */
export async function withServer({ connect = connectElectrum, endpoints, chain = DOICHAIN }, use) {
	const urls = endpoints?.electrum?.length ? endpoints.electrum : chain.endpoints.electrum;
	let wrongChain = false;
	for (const url of urls) {
		let server;
		try {
			server = await connect(url);
			if (!(await verifyChain(server, chain))) {
				wrongChain = true;
				server.close();
				continue;
			}
		} catch {
			server?.close();
			continue; // the next server
		}
		try {
			return await use(server);
		} finally {
			server.close();
		}
	}
	throw new WalletError(
		wrongChain ? 'no Doichain server on the valid chain answered' : 'no Doichain server answered',
		'DOICHAIN_NO_SERVER'
	);
}

/**
 * @typedef {object} ReadOptions
 * @property {string} account the own address (M…/N…, 6…, dc1…)
 * @property {string[]} [own] the request's other own addresses: a transfer to or from one is named so
 * @property {import('./electrum.js').ElectrumConnect} [connect] instead of a WebSocket to the server
 * @property {{ electrum?: string[] }} [endpoints] instead of the public servers, e.g. an own ElectrumX
 * @property {import('./doichain-chain.js').DoichainChain} [chain]
 */

/** @param {ReadOptions} p */
async function ledgerHistory(p) {
	const chain = p.chain ?? DOICHAIN;
	if (!isDoichainAddress(p.account, chain)) throw new Error('not a valid Doichain address');
	const own = new Set((p.own ?? []).filter((a) => a !== p.account));
	const { txs, balance } = await withServer(p, (server) => historyOf(server, p.account, chain));
	const byId = new Map(txs.map((tx) => [tx.txid, tx]));
	return {
		all: sortEntries(
			normalizeDoichain(txs, p.account, chain).map((e) =>
				toLedger(e, p.account, byId.get(e.hash), own)
			)
		),
		balances: [{ asset: chain.native.symbol, amount: balance }]
	};
}

/** Ledger entries for an address and period. @param {ReadOptions & { from: string, to: string }} p */
export async function readDoichain(p) {
	const { all } = await ledgerHistory(p);
	return all.filter((e) => e.date >= p.from && e.date <= p.to);
}

/** For a Kontoauszug: balances derived from today's balance less the movements since. @param {ReadOptions & { from: string, to: string }} p */
export async function statementDoichain(p) {
	const { all, balances } = await ledgerHistory(p);
	return derivedStatement(all, balances, p.from, p.to);
}

/** Is a server up and on the valid chain? @param {Pick<ReadOptions, 'connect' | 'endpoints' | 'chain'>} [o] */
export async function probe(o = {}) {
	return withServer(o, async (server) => {
		const tip = await server.request('blockchain.headers.subscribe');
		if (!(Number(tip?.height) > (o.chain ?? DOICHAIN).checkpoint.height))
			throw new Error('ElectrumX answered without a tip');
		return { sample: 'ElectrumX tip on the valid chain', entries: 1 };
	});
}

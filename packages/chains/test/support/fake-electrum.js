// SPDX-License-Identifier: AGPL-3.0-or-later
// A Doichain ElectrumX server for tests, in memory: it answers what the
// Doichain reader asks from a list of made-up transactions, in the form
// Doichain Core decodes them (amounts as JSON numbers in DOI, a name output
// with `nameOp`). Addresses, transaction ids, names and amounts are made up;
// the addresses carry valid checksums.
//
//   const net = fakeDoichain({ txs: [coinbase('mined', 100, MINER, 50), …] });
//   await readDoichain({ account, from, to, connect: net.connect, chain: net.chain });

import { bech32, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '@le-space/ledger/bytes';

import { DOICHAIN } from '../../src/doichain-chain.js';
import { blockHash, scripthashOf } from '../../src/doichain.js';

const base58check = createBase58check(sha256);

/**
 * A made-up address with a valid checksum.
 *
 * @param {string} seed
 * @param {'p2wpkh' | 'p2pkh' | 'p2sh'} [type]
 */
export function fakeDoichainAddress(seed, type = 'p2wpkh') {
	const hash = sha256(utf8(`doichain address:${seed}`)).subarray(0, 20);
	if (type === 'p2wpkh')
		return bech32.encode(DOICHAIN.address.bech32, [0, ...bech32.toWords(hash)]);
	const version = type === 'p2pkh' ? DOICHAIN.address.pubKeyHash : DOICHAIN.address.scriptHash;
	return base58check.encode(Uint8Array.of(version, ...hash));
}

/** A made-up transaction id. @param {string} seed */
export const fakeTxid = (seed) => toHex(sha256(utf8(`doichain tx:${seed}`)));

/** A made-up 80-byte block header. @param {string} seed */
export const fakeHeader = (seed) =>
	toHex(
		Uint8Array.of(
			...sha256(utf8(`header a:${seed}`)),
			...sha256(utf8(`header b:${seed}`)),
			...new Uint8Array(16)
		)
	);

/**
 * @typedef {object} FakeTx
 * @property {string} txid
 * @property {number} height 0 while unconfirmed
 * @property {number} time Unix seconds
 * @property {({ txid: string, vout: number } | { coinbase: string })[]} vin
 * @property {{ address: string, value: number, nameOp?: { op: string, name: string } }[]} vout value in DOI
 */

/**
 * A payment: spends the named outputs, pays the listed ones.
 *
 * @param {string} seed
 * @param {number} height
 * @param {[string, number][]} spends `[seed of the earlier transaction, output index]`
 * @param {FakeTx['vout']} vout
 * @returns {FakeTx}
 */
export const payment = (seed, height, spends, vout) => ({
	txid: fakeTxid(seed),
	height,
	time: 1_780_000_000 + height * 600,
	vin: spends.map(([from, index]) => ({ txid: fakeTxid(from), vout: index })),
	vout
});

/** A block's first transaction: new coins to a miner. @param {string} seed @param {number} height @param {string} address @param {number} value */
export const coinbase = (seed, height, address, value) => ({
	txid: fakeTxid(seed),
	height,
	time: 1_780_000_000 + height * 600,
	vin: [{ coinbase: '03' }],
	vout: [{ address, value }]
});

/**
 * @param {object} o
 * @param {FakeTx[]} o.txs
 * @param {string[]} [o.wrongChain] URLs of servers that follow another chain
 * @param {string[]} [o.down] URLs of servers that do not answer
 */
export function fakeDoichain({ txs, wrongChain = [], down = [] }) {
	const header = fakeHeader('the valid chain');
	/** @type {import('../../src/doichain-chain.js').DoichainChain} */
	const chain = {
		...DOICHAIN,
		checkpoint: { height: 10, hash: blockHash(header) },
		endpoints: { electrum: ['wss://electrum-a.example:50004', 'wss://electrum-b.example:50004'] }
	};
	const byId = new Map(txs.map((tx) => [tx.txid, tx]));
	const state = { requests: /** @type {[string, string][]} */ ([]), connections: 0, closed: 0 };

	/** Every address a transaction touches: its outputs, and the outputs it spends. @param {FakeTx} tx */
	const touched = (tx) => [
		...tx.vout.map((o) => o.address),
		...tx.vin.flatMap((i) => ('txid' in i ? [byId.get(i.txid)?.vout[i.vout]?.address ?? ''] : []))
	];
	// As ElectrumX counts: the confirmed balance does not know the mempool's spends yet.
	const spent = new Set(
		txs
			.filter((tx) => tx.height > 0)
			.flatMap((tx) => tx.vin.flatMap((i) => ('txid' in i ? [`${i.txid}:${i.vout}`] : [])))
	);
	/** @param {string} scripthash */
	const of = (scripthash) =>
		txs.filter((tx) => touched(tx).some((a) => a && scripthashOf(a) === scripthash));

	/** @type {import('../../src/electrum.js').ElectrumConnect} */
	const connect = async (url) => {
		if (down.includes(url)) throw new Error('unreachable');
		state.connections++;
		const host = new URL(url).host;
		return {
			host,
			async request(method, params = []) {
				state.requests.push([host, method]);
				const [first] = /** @type {any[]} */ (params);
				switch (method) {
					case 'blockchain.block.header':
						return wrongChain.includes(url) ? fakeHeader('the old chain') : header;
					case 'blockchain.headers.subscribe':
						return { height: 1000, hex: header };
					case 'blockchain.scripthash.get_history':
						return of(first)
							.sort((a, b) => (a.height || Infinity) - (b.height || Infinity))
							.map((tx) => ({ tx_hash: tx.txid, height: tx.height }));
					case 'blockchain.scripthash.get_balance': {
						let confirmed = 0;
						for (const tx of of(first))
							tx.vout.forEach((o, n) => {
								if (
									tx.height > 0 &&
									scripthashOf(o.address) === first &&
									!spent.has(`${tx.txid}:${n}`)
								)
									confirmed += Math.round(o.value * 1e8);
							});
						return { confirmed, unconfirmed: 0 };
					}
					case 'blockchain.transaction.get': {
						const tx = byId.get(first);
						if (!tx) throw new Error('no such transaction');
						return {
							txid: tx.txid,
							version: tx.vout.some((o) => o.nameOp) ? 0x7100 : 2,
							vin: tx.vin,
							vout: tx.vout.map((o, n) => ({
								value: o.value,
								n,
								scriptPubKey: {
									address: o.address,
									...(o.nameOp ? { nameOp: { ...o.nameOp, name_encoding: 'ascii' } } : {})
								}
							})),
							blocktime: tx.time,
							time: tx.time
						};
					}
					default:
						throw new Error(`the fake does not answer ${method}`);
				}
			},
			close() {
				state.closed++;
			}
		};
	};
	return { chain, connect, state };
}

/**
 * A WebSocket whose other end is a function: what `connectElectrum` is handed
 * in a test. `answer(request)` gives a JSON-RPC result, throws for an error,
 * or returns `undefined` to stay silent.
 *
 * @param {(request: { method: string, params: unknown[] }) => unknown} answer
 * @param {{ refuse?: boolean }} [options] refuse: the connection never opens
 */
export function fakeWebSocket(answer, { refuse = false } = {}) {
	return /** @type {any} */ (
		class {
			/** @param {string} url */
			constructor(url) {
				this.url = url;
				/** @type {any} */ this.onopen = null;
				/** @type {any} */ this.onerror = null;
				/** @type {any} */ this.onclose = null;
				/** @type {any} */ this.onmessage = null;
				queueMicrotask(() => (refuse ? this.onerror?.({}) : this.onopen?.({})));
			}
			/** @param {string} text */
			send(text) {
				const request = JSON.parse(text);
				queueMicrotask(() => {
					let message;
					try {
						const result = answer(request);
						if (result === undefined) return;
						message = { jsonrpc: '2.0', id: request.id, result };
					} catch (error) {
						message = {
							jsonrpc: '2.0',
							id: request.id,
							error: { code: 2, message: String(/** @type {Error} */ (error).message) }
						};
					}
					this.onmessage?.({ data: JSON.stringify(message) });
				});
			}
			close() {
				queueMicrotask(() => this.onclose?.({}));
			}
		}
	);
}

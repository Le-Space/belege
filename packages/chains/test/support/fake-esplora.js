// SPDX-License-Identifier: AGPL-3.0-or-later
// An Esplora API for tests, in memory: it answers what the Bitcoin address
// reader asks (bitcoin-address.js) from a list of made-up transactions, in
// Esplora's form (amounts in satoshis, newest first, 25 a page). Addresses,
// transaction ids and amounts are made up; the addresses carry valid
// checksums.
//
//   const api = fakeEsplora({ txs: [btcTx('paid', 100, [[OURS, 50_000]], [[SHOP, 40_000]])] });
//   await readBitcoin({ account: OURS, from, to, fetch: api.fetch, endpoints: { api: api.url } });

import { bech32, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, utf8 } from '@le-space/ledger/bytes';

import { BITCOIN } from '../../src/bitcoin-chain.js';

const base58check = createBase58check(sha256);

/** A block every 600 s from a made-up start, so each height has its own time. */
export const blockTime = (/** @type {number} */ height) => 1_780_000_000 + height * 600;

/**
 * A made-up address with a valid checksum.
 *
 * @param {string} seed
 * @param {'p2wpkh' | 'p2pkh' | 'p2sh'} [type]
 */
export function fakeBitcoinAddress(seed, type = 'p2wpkh') {
	const hash = sha256(utf8(`bitcoin address:${seed}`)).subarray(0, 20);
	if (type === 'p2wpkh') return bech32.encode(BITCOIN.address.bech32, [0, ...bech32.toWords(hash)]);
	const version = type === 'p2pkh' ? BITCOIN.address.pubKeyHash : BITCOIN.address.scriptHash;
	return base58check.encode(Uint8Array.of(version, ...hash));
}

/** A made-up transaction id. @param {string} seed */
export const fakeBtcTxid = (seed) => toHex(sha256(utf8(`bitcoin tx:${seed}`)));

/**
 * A transaction in Esplora's form; the fee is what the inputs hold beyond the outputs.
 *
 * @param {string} seed
 * @param {number} height 0 for one in the mempool
 * @param {[string, number][]} inputs [address, satoshis] each input spent
 * @param {[string, number][]} outputs [address, satoshis]
 */
export function btcTx(seed, height, inputs, outputs) {
	const vin = inputs.map(([address, value]) => ({
		prevout: { scriptpubkey_address: address, value }
	}));
	const vout = outputs.map(([address, value]) => ({ scriptpubkey_address: address, value }));
	const sum = (/** @type {{ value: number }[]} */ l) => l.reduce((s, o) => s + o.value, 0);
	return {
		txid: fakeBtcTxid(seed),
		status: height
			? { confirmed: true, block_height: height, block_time: blockTime(height) }
			: { confirmed: false },
		fee: sum(vin.map((i) => i.prevout)) - sum(vout),
		vin,
		vout
	};
}

/**
 * @param {object} o
 * @param {ReturnType<typeof btcTx>[]} o.txs
 * @param {number} [o.tip] the tip's height
 * @param {boolean} [o.down] every request fails as a network error
 */
export function fakeEsplora({ txs, tip = 950_000, down = false }) {
	const url = 'https://esplora.example.com/api';
	/** @type {string[]} */
	const calls = [];
	const touches = (/** @type {ReturnType<typeof btcTx>} */ tx, /** @type {string} */ a) =>
		tx.vin.some((i) => i.prevout.scriptpubkey_address === a) ||
		tx.vout.some((o) => o.scriptpubkey_address === a);

	/** @param {string} a */
	function stats(a, confirmed) {
		const list = txs.filter((tx) => tx.status.confirmed === confirmed && touches(tx, a));
		let funded = 0;
		let spent = 0;
		for (const tx of list) {
			for (const o of tx.vout) if (o.scriptpubkey_address === a) funded += o.value;
			for (const i of tx.vin) if (i.prevout.scriptpubkey_address === a) spent += i.prevout.value;
		}
		return { tx_count: list.length, funded_txo_sum: funded, spent_txo_sum: spent };
	}

	const json = (/** @type {unknown} */ body, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});

	/** @type {typeof fetch} */
	const fakeFetch = async (input) => {
		const href = String(input);
		calls.push(href);
		if (down) throw new TypeError('fetch failed');
		if (!href.startsWith(`${url}/`)) return json({ error: 'unknown host' }, 404);
		const path = href.slice(url.length);
		if (path === '/blocks/tip/height') return new Response(String(tip));
		const m = path.match(/^\/address\/([^/]+)(\/txs\/chain(?:\/([0-9a-f]{64}))?)?$/);
		if (!m) return new Response('not found', { status: 404 });
		const a = decodeURIComponent(m[1]);
		if (!m[2])
			return json({ address: a, chain_stats: stats(a, true), mempool_stats: stats(a, false) });
		const newest = txs
			.filter((tx) => tx.status.confirmed && touches(tx, a))
			.sort((x, y) => (y.status.block_height ?? 0) - (x.status.block_height ?? 0));
		const after = m[3] ? newest.findIndex((tx) => tx.txid === m[3]) + 1 : 0;
		return json(newest.slice(after, after + 25));
	};
	return { url, fetch: fakeFetch, calls };
}

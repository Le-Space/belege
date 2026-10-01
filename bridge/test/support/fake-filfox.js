// Filfox's API on 127.0.0.1 for tests: an address's balance and its
// transfers, newest first, 100 a page (Filfox refuses more), and 404 for an
// address it does not know. Addresses and message CIDs are made up, with
// valid Filecoin checksums.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { base32nopad } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';

/** A made-up f1 address with a valid checksum. @param {string} seed */
export function fakeFilecoinAddress(seed) {
	const payload = createHash('sha256').update(`f1:${seed}`).digest().subarray(0, 20);
	const sum = blake2b(new Uint8Array([1, ...payload]), { dkLen: 4 });
	return `f1${base32nopad.encode(new Uint8Array([...payload, ...sum])).toLowerCase()}`;
}

/** A made-up message CID in Filecoin's form. @param {string} seed */
export function fakeMessageCid(seed) {
	const bytes = createHash('sha256').update(`cid:${seed}`).digest();
	return `bafy2bzace${base32nopad
		.encode(new Uint8Array([...bytes, ...bytes.subarray(0, 1)]))
		.toLowerCase()
		.slice(0, 52)}`;
}

/**
 * @param {object} options
 * @param {Record<string, { balance: string, transfers: any[] }>} options.addresses
 */
export async function startFakeFilfox({ addresses }) {
	const state = { requests: 0, pages: 0 };
	const server = http.createServer((req, res) => {
		state.requests++;
		const url = new URL(req.url ?? '/', 'http://x');
		/** @param {number} status @param {unknown} body */
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const m = /^\/api\/v1\/address\/([a-z0-9]+)(\/transfers)?$/.exec(url.pathname);
		const known = m ? addresses[m[1]] : undefined;
		if (!m || !known) return send(404, { error: 'Not Found' });
		if (!m[2]) return send(200, { address: m[1], balance: known.balance, actor: 'account' });
		const size = Number(url.searchParams.get('pageSize') ?? 20);
		if (size > 100) return send(400, { error: 'pageSize' });
		const page = Number(url.searchParams.get('page') ?? 0);
		state.pages++;
		const sorted = [...known.transfers].sort((a, b) => b.height - a.height);
		send(200, {
			totalCount: sorted.length,
			transfers: sorted.slice(page * size, page * size + size),
			types: ['burn-fee', 'miner-fee', 'transfer']
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}/api/v1`,
		state,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}

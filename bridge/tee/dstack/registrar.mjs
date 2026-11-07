// SPDX-License-Identifier: AGPL-3.0-or-later
//
// registrar.mjs <run dir>: the hosted bridge's answer to its start (#696).
//
// Waits until the bridge has written its node key's hash, asks dstack for a
// TDX quote whose report data binds that key to the start it was made for,
// and hands the quote to the launcher, which submits it to the NEAR contract
// (bridge/tee/near-contract). The VM holds no NEAR key and no money; the
// quote is the proof, and it answers this one start only.
//
//   report data = SHA-256("belege-bridge/start/1" ‖ books ‖ ":" ‖ start ms)
//                 ‖ SHA-256 of the bridge's libp2p public key
//
// Nothing here is secret: the books' account and the start time are on chain,
// the key hash is in the peer id. It runs with an empty environment but the
// launcher's address, which is fixed in the measured compose file.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';

export const START_DOMAIN = 'belege-bridge/start/1';
const DSTACK_SOCKET = '/var/run/dstack.sock';
const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;

/**
 * @param {string} books the books' NEAR account
 * @param {number | string} startAtMs the start request's time, as the contract stored it
 * @param {string} keyHashHex the bridge's node key hash, 64 hex
 */
export function reportData(books, startAtMs, keyHashHex) {
	if (!ACCOUNT.test(books)) throw new Error('not a NEAR account');
	if (!/^\d{1,16}$/.test(String(startAtMs))) throw new Error('not a start time');
	if (!/^[0-9a-f]{64}$/.test(keyHashHex)) throw new Error('not a key hash');
	const binding = createHash('sha256').update(`${START_DOMAIN}${books}:${startAtMs}`).digest();
	return Buffer.concat([binding, Buffer.from(keyHashHex, 'hex')]);
}

/**
 * dstack's guest API over its Unix socket.
 *
 * @param {string} path e.g. /GetQuote
 * @param {object} body
 * @param {string} [socketPath]
 * @returns {Promise<any>}
 */
export function dstack(path, body, socketPath = DSTACK_SOCKET) {
	const data = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path,
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
			},
			(res) => {
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					if ((res.statusCode ?? 500) >= 300)
						return reject(new Error(`dstack ${path}: HTTP ${res.statusCode}`));
					try {
						resolve(JSON.parse(text));
					} catch {
						reject(new Error(`dstack ${path}: not JSON`));
					}
				});
			}
		);
		req.on('error', reject);
		req.end(data);
	});
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} file
 * @param {number} [timeoutMs]
 */
async function waitFor(file, timeoutMs = 120_000) {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const text = await readFile(file, 'utf8').catch(() => '');
		if (text.trim()) return text.trim();
		if (Date.now() > until) throw new Error(`no ${file}`);
		await sleep(500);
	}
}

/**
 * @param {{ run: string, launcher: string, socketPath?: string, fetchImpl?: typeof fetch, log?: (l: string) => void }} o
 */
export async function register({
	run,
	launcher,
	socketPath,
	fetchImpl = fetch,
	log = (l) => console.error(`[tee] ${l}`)
}) {
	const url = new URL('/v1/bridge-quote', launcher);
	if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1')
		throw new Error('the launcher must be https');
	let start;
	try {
		start = JSON.parse(await readFile(join(run, 'start.json'), 'utf8'));
	} catch {
		log('no start came with this VM: nothing to register');
		return null;
	}
	const keyHash = await waitFor(join(run, 'node', 'public-key.sha256'));
	const data = reportData(start.books, start.at_ms, keyHash);
	const quote = await dstack('/GetQuote', { report_data: data.toString('hex') }, socketPath);
	const info = await dstack('/Info', {}, socketPath);
	const body = {
		books: start.books,
		start_at_ms: String(start.at_ms),
		peer_key_hash: keyHash,
		quote: quote.quote,
		event_log: quote.event_log,
		tcb_info: info.tcb_info
	};
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetchImpl(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				redirect: 'error'
			});
			if (res.ok) {
				log(`quote handed to the launcher for ${start.books}`);
				return body;
			}
			log(`launcher: HTTP ${res.status} (attempt ${attempt})`);
			if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
		} catch (e) {
			log(`launcher unreachable (attempt ${attempt}): ${/** @type {Error} */ (e).message}`);
		}
		if (attempt >= 10) return null;
		await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const run = process.argv[2];
	const launcher = process.env.BELEGE_LAUNCHER_URL;
	if (!run || !launcher) {
		console.error('usage: BELEGE_LAUNCHER_URL=https://… registrar.mjs <run dir>');
		process.exit(2);
	}
	register({ run, launcher }).catch((e) =>
		console.error(`[tee] registration failed: ${e.message}`)
	);
}

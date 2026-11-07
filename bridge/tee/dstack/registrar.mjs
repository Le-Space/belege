// SPDX-License-Identifier: AGPL-3.0-or-later
//
// registrar.mjs <run dir>: the hosted bridge's answer to its start (#696),
// before the bridge runs.
//
// The VM boots without the bridge's secrets. This makes an X25519 key of its
// own (intake.mjs), asks dstack for a TDX quote whose report data binds that
// key to the start it was made for, and hands the quote to the launcher,
// which submits it to the NEAR contract (bridge/tee/near-contract). The VM
// holds no NEAR key and no money; the quote is the proof, and it answers this
// one start only.
//
//   report data = SHA-256("belege-bridge/start/1" ‖ books ‖ ":" ‖ start ms)
//                 ‖ SHA-256 of the intake public key
//
// Once the contract shows the VM attested, the browser seals the secrets to
// that key; this fetches them from the launcher, opens them and sorts them
// into the run directory (sort-secrets.mjs). Then the entrypoint starts the
// bridge. The private key never leaves this process. It runs with an empty
// environment but the launcher's address, fixed in the measured compose file.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { intakeKey, openSecrets } from './intake.mjs';
import { sortSecrets } from './sort-secrets.mjs';
import { request } from 'node:http';
import { join } from 'node:path';

export const START_DOMAIN = 'belege-bridge/start/1';
const DSTACK_SOCKET = '/var/run/dstack.sock';
const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;

/**
 * @param {string} books the books' NEAR account
 * @param {number | string} startAtMs the start request's time, as the contract stored it
 * @param {string} keyHashHex SHA-256 of the intake public key, 64 hex
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

/** How long the VM waits for its secrets after the quote was taken. */
export const SECRETS_TIMEOUT_MS = 15 * 60_000;

/**
 * @param {{ run: string, launcher: string, socketPath?: string, fetchImpl?: typeof fetch, log?: (l: string) => void, pollMs?: number, timeoutMs?: number }} o
 */
export async function register({
	run,
	launcher,
	socketPath,
	fetchImpl = fetch,
	log = (l) => console.error(`[tee] ${l}`),
	pollMs = 3_000,
	timeoutMs = SECRETS_TIMEOUT_MS
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
	const key = intakeKey();
	const keyHash = createHash('sha256').update(Buffer.from(key.publicKey, 'hex')).digest('hex');
	const data = reportData(start.books, start.at_ms, keyHash);
	const quote = await dstack('/GetQuote', { report_data: data.toString('hex') }, socketPath);
	const info = await dstack('/Info', {}, socketPath);
	const body = {
		books: start.books,
		start_at_ms: String(start.at_ms),
		intake_key: key.publicKey,
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
				return await receive({ run, launcher, start, key, fetchImpl, log, pollMs, timeoutMs });
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

/**
 * Wait for the sealed secrets, open them, sort them into the run directory.
 *
 * @param {{ run: string, launcher: string, start: { books: string, at_ms: string|number }, key: ReturnType<typeof intakeKey>, fetchImpl: typeof fetch, log: (l: string) => void, pollMs: number, timeoutMs: number }} o
 */
async function receive({ run, launcher, start, key, fetchImpl, log, pollMs, timeoutMs }) {
	const url = new URL(
		`/v1/bridge-secrets/${encodeURIComponent(start.books)}/${start.at_ms}`,
		launcher
	);
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		try {
			const res = await fetchImpl(url, { redirect: 'error' });
			if (res.ok) {
				const { sealed } = await res.json();
				const json = openSecrets(String(sealed), key, start.books, start.at_ms);
				const r = sortSecrets(run, { BELEGE_BRIDGE_SECRETS: json });
				log(
					`secrets received: ${r.accounts} accounts, peer key ${r.peerKey ? 'yes' : 'no'}, config ${r.config ? 'yes' : 'no'}`
				);
				return { quoted: true, secrets: true };
			}
			if (res.status !== 404) log(`secrets: HTTP ${res.status}`);
		} catch (e) {
			log(`secrets not opened: ${/** @type {Error} */ (e).message}`);
		}
		await sleep(pollMs);
	}
	log('no secrets in time: the bridge starts unarmed');
	return { quoted: true, secrets: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const run = process.argv[2];
	const launcher = process.env.BELEGE_LAUNCHER_URL;
	if (!run || !launcher) {
		console.error('usage: BELEGE_LAUNCHER_URL=https://… registrar.mjs <run dir>');
		process.exit(2);
	}
	// The entrypoint waits for this, then starts the bridge either way.
	register({ run, launcher })
		.catch((e) => console.error(`[tee] registration failed: ${e.message}`))
		.finally(() => process.exit(0));
}

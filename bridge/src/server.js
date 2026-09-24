// The bridge's HTTP API, on 127.0.0.1 only.
//
//   GET  /health                         no token
//   POST /pair         { code }          no token → { token }
//   GET  /hibiscus/accounts              token
//   GET  /hibiscus/transactions?account=<id>&since=YYYY-MM-DD   token
//
// Guards, in this order, on every request:
//   1. Host header is 127.0.0.1:<port> or localhost:<port> (DNS rebinding)
//   2. an Origin, when there is one, is in `appOrigins` (CORS; others get 403
//      and no CORS headers, so a foreign page cannot read anything)
//   3. a bearer token whose hash is on file, except for /health and /pair
//
// What leaves the bridge about Hibiscus is limited to accounts whose IBAN ends
// in one of `hibiscus.ibanSuffixes`. Other accounts are dropped straight after
// `konto.find`, before anything else looks at them, and their transactions
// are never asked for.

import http from 'node:http';

import { HibiscusUnreachableError, PinMismatchError } from './hibiscus.js';
import { ibanAllowed, normalizeAccount, normalizeTransaction } from './normalize.js';

export const LOOPBACK = '127.0.0.1';
const VERSION = '0.1.0';
const MAX_BODY = 4096;

/**
 * @param {object} options
 * @param {import('./config.js').BridgeConfig} options.config
 * @param {ReturnType<typeof import('./pairing.js').createPairing>} options.pairing
 * @param {(() => import('./hibiscus.js').HibiscusClient) | null} options.hibiscus
 *   null when Hibiscus is not set up yet
 * @param {(message: string) => void} [options.log] never gets a secret or bank data
 */
export function createBridgeServer({ config, pairing, hibiscus, log = () => {} }) {
	const allowedOrigins = new Set(config.appOrigins.map((o) => o.replace(/\/$/, '')));
	const suffixes = config.hibiscus.ibanSuffixes;

	/** @type {number} */ let boundPort = 0;

	/**
	 * @param {http.ServerResponse} res
	 * @param {number} status
	 * @param {unknown} body
	 */
	function send(res, status, body) {
		const text = JSON.stringify(body);
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Length': Buffer.byteLength(text),
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		});
		res.end(text);
	}

	/** @param {http.IncomingMessage} req */
	function hostAllowed(req) {
		const host = String(req.headers.host ?? '').toLowerCase();
		return host === `${LOOPBACK}:${boundPort}` || host === `localhost:${boundPort}`;
	}

	/** @param {http.IncomingMessage} req */
	function bearer(req) {
		const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization ?? ''));
		return m ? m[1] : null;
	}

	/** @param {http.IncomingMessage} req */
	function readJson(req) {
		return new Promise((resolve, reject) => {
			let size = 0;
			/** @type {Buffer[]} */ const chunks = [];
			req.on('data', (/** @type {Buffer} */ c) => {
				size += c.length;
				if (size > MAX_BODY) {
					reject(Object.assign(new Error('Body too large'), { status: 413 }));
					req.destroy();
				} else chunks.push(c);
			});
			req.on('end', () => {
				try {
					resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
				} catch {
					reject(Object.assign(new Error('Body is not JSON'), { status: 400 }));
				}
			});
			req.on('error', reject);
		});
	}

	/** Allowed accounts only; the rest never leaves this function. */
	async function allowedAccounts() {
		if (!hibiscus)
			throw Object.assign(new Error('Hibiscus is not set up: run setup:hibiscus.'), {
				status: 503
			});
		const all = await hibiscus().accounts();
		return all.filter((k) => ibanAllowed(k.iban, suffixes));
	}

	/**
	 * @param {http.IncomingMessage} req
	 * @param {http.ServerResponse} res
	 * @param {URL} url
	 */
	async function route(req, res, url) {
		const path = url.pathname.replace(/\/+$/, '') || '/';

		if (path === '/health' && req.method === 'GET') {
			return send(res, 200, {
				ok: true,
				service: 'belege-bridge',
				version: VERSION,
				paired: pairing.isPaired(),
				pairingOpen: pairing.hasPendingCode(),
				hibiscus: { configured: Boolean(hibiscus) }
			});
		}

		if (path === '/pair' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req));
			const token = await pairing.pair(body?.code);
			log('paired a new client');
			return send(res, 200, { token });
		}

		if (!pairing.verify(bearer(req))) {
			return send(res, 401, { error: 'unauthorized' });
		}

		if (path === '/hibiscus/accounts' && req.method === 'GET') {
			const accounts = (await allowedAccounts()).map(normalizeAccount);
			return send(res, 200, { accounts });
		}

		if (path === '/hibiscus/transactions' && req.method === 'GET') {
			const accountId = url.searchParams.get('account') ?? '';
			const since = url.searchParams.get('since') ?? '';
			if (!/^[0-9A-Za-z_-]{1,40}$/.test(accountId))
				return send(res, 400, { error: 'account is required' });
			if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
				return send(res, 400, { error: 'since must be YYYY-MM-DD' });
			// Only an allowed account; any other id looks like one that does not exist.
			const account = (await allowedAccounts()).find((k) => String(k.id) === accountId);
			if (!account) return send(res, 404, { error: 'unknown account' });
			const normalized = normalizeAccount(account);
			const raw = await /** @type {() => import('./hibiscus.js').HibiscusClient} */ (
				hibiscus
			)().transactions(accountId, since);
			const transactions = raw
				// Defence in depth: nothing that Hibiscus files under another account.
				.filter((u) => u.konto_id === undefined || String(u.konto_id) === accountId)
				.map((u) => normalizeTransaction(u, normalized))
				.filter((t) => t.date === null || t.date >= since);
			return send(res, 200, { account: normalized.id, since, transactions });
		}

		return send(res, 404, { error: 'not found' });
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${LOOPBACK}`);
		if (!hostAllowed(req)) return send(res, 421, { error: 'wrong host' });

		const origin = req.headers.origin;
		if (origin !== undefined) {
			if (!allowedOrigins.has(origin)) {
				log(`refused origin ${JSON.stringify(origin).slice(0, 80)}`);
				return send(res, 403, { error: 'origin not allowed' });
			}
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}

		if (req.method === 'OPTIONS') {
			if (origin === undefined) return send(res, 400, { error: 'preflight without origin' });
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
			res.setHeader('Access-Control-Max-Age', '600');
			// Chrome's Private/Local Network Access asks this of loopback targets.
			if (req.headers['access-control-request-private-network'] === 'true') {
				res.setHeader('Access-Control-Allow-Private-Network', 'true');
			}
			res.writeHead(204);
			return res.end();
		}

		try {
			await route(req, res, url);
		} catch (/** @type {any} */ error) {
			const status =
				error.status ??
				(error instanceof PinMismatchError
					? 502
					: error instanceof HibiscusUnreachableError
						? 502
						: error.code?.startsWith?.('KEYCHAIN')
							? 503
							: error.code?.startsWith?.('HIBISCUS')
								? 502
								: 500);
			// Messages are the bridge's own; they carry no password and no bank data.
			log(`${req.method} ${url.pathname}: ${error.code ?? error.name}: ${error.message}`);
			if (!res.headersSent) send(res, status, { error: error.message, code: error.code ?? null });
		}
	});

	return {
		server,
		/**
		 * @param {{ host?: string, port?: number }} [options]
		 * @returns {Promise<{ host: string, port: number }>}
		 */
		async listen({ host = LOOPBACK, port = config.bridge.port } = {}) {
			if (host !== LOOPBACK) {
				throw new Error(`The bridge listens on ${LOOPBACK} only, not on ${host}.`);
			}
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen({ host, port, exclusive: true }, () => resolve(undefined));
			});
			const address = /** @type {import('node:net').AddressInfo} */ (server.address());
			if (address.address !== LOOPBACK) {
				server.close();
				throw new Error(`Bound to ${address.address} instead of ${LOOPBACK}; refusing to serve.`);
			}
			boundPort = address.port;
			return { host: address.address, port: address.port };
		},
		close() {
			return new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			});
		}
	};
}

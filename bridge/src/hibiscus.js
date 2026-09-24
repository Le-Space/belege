// A Hibiscus XML-RPC client with certificate pinning.
//
// Jameica serves a self-signed certificate. Instead of switching
// verification off, the bridge pins its SHA-256 fingerprint (trust on first
// use, see setup-hibiscus.js). Every call opens its own TLS connection, checks
// the fingerprint of the certificate on *that* connection, and only then asks
// the keychain for the master password and sends the request over the same
// socket. A mismatch never reaches the keychain, let alone the wire.

import tls from 'node:tls';
import http from 'node:http';

import { decodeResponse, encodeCall } from './xmlrpc.js';

export class PinMismatchError extends Error {
	/** @param {string} got */
	constructor(got) {
		super(`Hibiscus certificate fingerprint does not match the pinned one (got ${got}).`);
		this.name = 'PinMismatchError';
		this.code = 'PIN_MISMATCH';
		this.fingerprint = got;
	}
}

export class HibiscusUnreachableError extends Error {
	/** @param {string} host @param {number} port @param {string} reason */
	constructor(host, port, reason) {
		super(
			`Cannot reach Hibiscus at ${host}:${port} (${reason}). Is Jameica running with XML-RPC enabled?`
		);
		this.name = 'HibiscusUnreachableError';
		this.code = 'HIBISCUS_UNREACHABLE';
	}
}

/** `ab:cd…` or `ABCD…` → `AB:CD:…` */
export function normalizeFingerprint(/** @type {string} */ value) {
	const hex = String(value ?? '')
		.replace(/[^0-9a-f]/gi, '')
		.toUpperCase();
	if (hex.length !== 64) throw new Error('A SHA-256 fingerprint has 64 hex digits.');
	return hex.match(/.{2}/g)?.join(':') ?? '';
}

/**
 * Connect, and hand back the socket and the certificate's fingerprint.
 * `rejectUnauthorized: false` because the certificate is self-signed; the pin
 * below is the check.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ socket: import('node:tls').TLSSocket, fingerprint: string }>}
 */
function connect(host, port, timeoutMs) {
	return new Promise((resolve, reject) => {
		const socket = tls.connect({ host, port, rejectUnauthorized: false });
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new HibiscusUnreachableError(host, port, 'timeout'));
		}, timeoutMs);
		socket.once('secureConnect', () => {
			clearTimeout(timer);
			const cert = socket.getPeerCertificate(false);
			resolve({ socket, fingerprint: String(cert?.fingerprint256 ?? '') });
		});
		socket.once('error', (/** @type {any} */ e) => {
			clearTimeout(timer);
			reject(new HibiscusUnreachableError(host, port, e.code ?? e.message));
		});
	});
}

/**
 * The fingerprint Hibiscus presents now. Sends nothing but a TLS handshake.
 *
 * @param {{ host: string, port: number, timeoutMs?: number }} options
 */
export async function peerFingerprint({ host, port, timeoutMs = 5000 }) {
	const { socket, fingerprint } = await connect(host, port, timeoutMs);
	socket.end();
	return fingerprint;
}

/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} options.certSha256 the pinned fingerprint
 * @param {() => Promise<string>} options.getPassword asked only after the pin matched
 * @param {string} [options.username] Jameica's web server ignores it; `admin` by convention
 * @param {number} [options.timeoutMs]
 */
export function createHibiscusClient({
	host,
	port,
	certSha256,
	getPassword,
	username = 'admin',
	timeoutMs = 30_000
}) {
	if (!certSha256)
		throw new Error('No pinned certificate: run `pnpm --filter @belege/bridge setup:hibiscus`.');
	const pinned = normalizeFingerprint(certSha256);

	/**
	 * @param {string} method
	 * @param {...unknown} params
	 */
	async function call(method, ...params) {
		const { socket, fingerprint } = await connect(host, port, timeoutMs);
		let got;
		try {
			got = normalizeFingerprint(fingerprint);
		} catch {
			got = '(none)';
		}
		if (got !== pinned) {
			socket.destroy();
			throw new PinMismatchError(got);
		}

		let password;
		try {
			password = await getPassword();
		} catch (error) {
			socket.destroy();
			throw error;
		}

		const body = encodeCall(method, params);
		return new Promise((resolve, reject) => {
			// Plain `http.request` over the TLS socket checked above: no agent, so no
			// second connection with its own (unpinned) handshake.
			const req = http.request(
				{
					host,
					port,
					path: '/xmlrpc/',
					method: 'POST',
					// The connection whose certificate was just checked, nothing else.
					createConnection: () => socket,
					auth: `${username}:${password}`,
					headers: {
						'Content-Type': 'text/xml; charset=utf-8',
						'Content-Length': Buffer.byteLength(body)
					},
					timeout: timeoutMs
				},
				(res) => {
					let xml = '';
					res.setEncoding('utf8');
					res.on('data', (d) => (xml += d));
					res.on('end', () => {
						socket.destroy();
						if (res.statusCode === 401) {
							return reject(
								Object.assign(new Error('Hibiscus refused the master password (401).'), {
									code: 'HIBISCUS_AUTH'
								})
							);
						}
						if (res.statusCode !== 200) {
							return reject(
								Object.assign(new Error(`${method}: HTTP ${res.statusCode}`), {
									code: 'HIBISCUS_HTTP'
								})
							);
						}
						try {
							resolve(decodeResponse(xml));
						} catch (e) {
							reject(e);
						}
					});
				}
			);
			req.on('timeout', () => req.destroy(new HibiscusUnreachableError(host, port, 'timeout')));
			req.on('error', (e) => {
				socket.destroy();
				reject(e);
			});
			req.end(body);
		});
	}

	return {
		call,
		/** @returns {Promise<Record<string, any>[]>} */
		async accounts() {
			const result = await call('hibiscus.xmlrpc.konto.find');
			return Array.isArray(result) ? /** @type {Record<string, any>[]} */ (result) : [];
		},
		/**
		 * @param {string} accountId
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<Record<string, any>[]>}
		 */
		async transactions(accountId, since) {
			const result = await call('hibiscus.xmlrpc.umsatz.list', {
				konto_id: String(accountId),
				'datum:min': since
			});
			return Array.isArray(result) ? /** @type {Record<string, any>[]} */ (result) : [];
		}
	};
}

/** @typedef {ReturnType<typeof createHibiscusClient>} HibiscusClient */

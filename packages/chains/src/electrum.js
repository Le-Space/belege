// SPDX-License-Identifier: AGPL-3.0-or-later
// An ElectrumX server over WebSocket, as a browser and Node 22 both reach it:
// JSON-RPC 2.0, one text frame per message, answers matched by id.
//
//   const server = await connectElectrum('wss://host:50004');
//   await server.request('blockchain.headers.subscribe');
//   server.close();
//
// Only requests and their answers; a server's notifications (a subscription's
// later messages) are dropped. The server sees what it is asked and the
// caller's IP address. Error messages name the host at most: a request's
// parameters carry script hashes of the caller's addresses.

import { WalletError, hostOf } from './http.js';

/**
 * @typedef {object} ElectrumServer
 * @property {string} host
 * @property {(method: string, params?: unknown[]) => Promise<any>} request
 * @property {() => void} close
 */

/** @typedef {(url: string) => Promise<ElectrumServer>} ElectrumConnect */

/**
 * @param {string} url `wss://host:port`
 * @param {object} [options]
 * @param {typeof WebSocket} [options.WebSocket] the constructor to use (a test's fake)
 * @param {number} [options.timeoutMs] for the connection and for each request
 * @param {string} [options.client] the name given in `server.version`
 * @returns {Promise<ElectrumServer>}
 */
export async function connectElectrum(
	url,
	{ WebSocket: Socket = globalThis.WebSocket, timeoutMs = 20_000, client = 'le-space-chains' } = {}
) {
	const host = hostOf(url);
	if (!/^wss?:\/\//.test(url))
		throw new WalletError(`not a WebSocket URL: ${host}`, 'ELECTRUM_URL');
	if (typeof Socket !== 'function')
		throw new WalletError('no WebSocket in this runtime', 'ELECTRUM_NO_WEBSOCKET', 500);

	/** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
	const waiting = new Map();
	let next = 0;
	let closed = false;
	const socket = new Socket(url);

	const failAll = (/** @type {Error} */ error) => {
		for (const w of waiting.values()) {
			clearTimeout(w.timer);
			w.reject(error);
		}
		waiting.clear();
	};

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.close();
			reject(new WalletError(`${host} did not answer`, 'ELECTRUM_TIMEOUT', 504));
		}, timeoutMs);
		socket.onopen = () => {
			clearTimeout(timer);
			resolve(undefined);
		};
		socket.onerror = () => {
			clearTimeout(timer);
			reject(new WalletError(`cannot reach ${host}`, 'ELECTRUM_UNREACHABLE'));
		};
	});

	socket.onerror = () =>
		failAll(new WalletError(`the connection to ${host} failed`, 'ELECTRUM_UNREACHABLE'));
	socket.onclose = () => {
		closed = true;
		failAll(new WalletError(`${host} closed the connection`, 'ELECTRUM_CLOSED'));
	};
	socket.onmessage = (/** @type {{ data: unknown }} */ event) => {
		let message;
		try {
			message = JSON.parse(String(event.data));
		} catch {
			return;
		}
		const w = waiting.get(message?.id);
		if (!w) return;
		waiting.delete(message.id);
		clearTimeout(w.timer);
		if (message.error) {
			// The server's own text can quote what it was sent; only its code is kept.
			const code = Number.isInteger(message.error?.code) ? ` (${message.error.code})` : '';
			w.reject(new WalletError(`${host} refused a request${code}`, 'ELECTRUM_REFUSED'));
		} else w.resolve(message.result);
	};

	/** @type {ElectrumServer} */
	const server = {
		host,
		request(method, params = []) {
			if (closed)
				return Promise.reject(new WalletError(`${host} closed the connection`, 'ELECTRUM_CLOSED'));
			const id = ++next;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					waiting.delete(id);
					reject(new WalletError(`${host} did not answer`, 'ELECTRUM_TIMEOUT', 504));
				}, timeoutMs);
				waiting.set(id, { resolve, reject, timer });
				socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
			});
		},
		close() {
			closed = true;
			socket.onclose = null;
			socket.close();
			failAll(new WalletError(`the connection to ${host} was closed`, 'ELECTRUM_CLOSED'));
		}
	};
	try {
		await server.request('server.version', [client, '1.4']);
	} catch (error) {
		server.close();
		throw error;
	}
	return server;
}

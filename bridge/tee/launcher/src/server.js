// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The launcher's HTTP API, behind the Le Space reverse proxy:
//
//   GET  /v1/starts/<books>   the open start's env key, for the browser   (CORS)
//   POST /v1/starts/<books>   the browser's encrypted env, signed          (CORS)
//   POST /v1/bridge-quote     the VM's quote (registrar.mjs)
//   GET  /healthz
//
// Bodies are limited; nothing secret is logged (the env is encrypted to the
// VM, the quote is public).

import { createServer } from 'node:http';

const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;
const MAX_BODY = 1024 * 1024;

/**
 * @param {ReturnType<typeof import('./launcher.js').createLauncher>} launcher
 * @param {{ origins: string[], log?: (l: string) => void }} o
 */
export function launcherServer(
	launcher,
	{ origins, log = (l) => console.error(`[launcher] ${l}`) }
) {
	return createServer(async (req, res) => {
		const origin = String(req.headers.origin ?? '');
		/** @param {number} status @param {any} body */
		const send = (status, body) => {
			const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
			if (origins.includes(origin))
				Object.assign(headers, {
					'access-control-allow-origin': origin,
					'access-control-allow-methods': 'GET, POST',
					'access-control-allow-headers': 'content-type',
					vary: 'Origin'
				});
			res.writeHead(status, headers).end(JSON.stringify(body));
		};
		try {
			const url = new URL(req.url ?? '/', 'http://launcher');
			if (req.method === 'OPTIONS') return send(204, {});
			if (url.pathname === '/healthz') return send(200, { ok: true });

			/** @returns {Promise<any>} */
			const json = () =>
				new Promise((resolve, reject) => {
					let size = 0;
					/** @type {Buffer[]} */
					const chunks = [];
					req.on('data', (c) => {
						size += c.length;
						if (size > MAX_BODY) {
							reject(Object.assign(new Error('too large'), { status: 413 }));
							req.destroy();
						} else chunks.push(c);
					});
					req.on('end', () => {
						try {
							resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
						} catch {
							reject(Object.assign(new Error('not JSON'), { status: 400 }));
						}
					});
				});

			const m = /^\/v1\/starts\/([^/]+)$/.exec(url.pathname);
			if (m) {
				const books = decodeURIComponent(m[1]);
				if (!ACCOUNT.test(books)) return send(400, { error: 'not a NEAR account' });
				if (req.method === 'GET') {
					const info = launcher.startInfo(books);
					return info ? send(200, info) : send(404, { error: 'no open start' });
				}
				if (req.method === 'POST') {
					const r = await launcher.uploadEnv(books, await json());
					return send(r.status, r.body ?? { error: r.error });
				}
			}
			if (url.pathname === '/v1/bridge-quote' && req.method === 'POST') {
				const r = await launcher.quote(await json());
				return send(r.status, r.body ?? { error: r.error });
			}
			send(404, { error: 'not found' });
		} catch (e) {
			const status = /** @type {any} */ (e).status ?? 500;
			if (status === 500) log(`error: ${/** @type {Error} */ (e).message}`);
			send(status, { error: status === 500 ? 'failed' : /** @type {Error} */ (e).message });
		}
	});
}

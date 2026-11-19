// A fake of everything the Filecoin Pay reader asks, on 127.0.0.1, for the
// bridge's own tests and the app's E2E: the package's fake `fetch`
// (@le-space/chains/testing/filecoin-pay) behind an HTTP server, one path
// per service –
//
//   POST /index                       the makers' index (GraphQL)
//   GET  /filfox/address/<a>/token-transfers
//   GET  /blockscout?module=logs&…    Blockscout without a key
//   POST /blockscout/eth-rpc          its eth_call
//   GET  /keyed/v2/api?chain_id=314&… Blockscout's keyed host: only with the
//   POST /keyed/314/json-rpc          one key, in the `authorization` header
//
// Every address, hash and amount handed to it is made up.
import http from 'node:http';

import { filecoinPayFetch } from '@le-space/chains/testing/filecoin-pay';

export { blockAt, units } from '@le-space/chains/testing/filecoin-pay';

const HOSTS = /** @type {const} */ ({
	index: 'https://api.goldsky.com',
	filfox: 'https://filfox.info/api/v1',
	blockscout: 'https://filecoin.blockscout.com/api',
	keyed: 'https://api.blockscout.com'
});

/**
 * @param {Parameters<typeof filecoinPayFetch>[0]} options the events, the balances, the key
 * @returns {Promise<{ url: string, calls: string[], authorizations: string[], close: () => Promise<void> }>}
 *   `authorizations`: every `authorization` header seen, by the path it came to
 */
export async function startFakeFilecoinPay(options) {
	const inner = filecoinPayFetch(options);
	/** @type {string[]} */
	const authorizations = [];
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const part = /** @type {keyof typeof HOSTS | undefined} */ (
			Object.keys(HOSTS).find((p) => url.pathname === `/${p}` || url.pathname.startsWith(`/${p}/`))
		);
		if (!part) {
			res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
			return;
		}
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const auth = req.headers.authorization;
		if (auth) authorizations.push(`${url.pathname} ${auth}`);
		const answer = await inner(
			`${HOSTS[part]}${url.pathname.slice(part.length + 1)}${url.search}`,
			{
				method: req.method,
				headers: auth ? { authorization: auth } : {},
				...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {})
			}
		);
		res.writeHead(answer.status, { 'content-type': 'application/json' }).end(await answer.text());
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		calls: inner.calls,
		authorizations,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}

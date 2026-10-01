// An Enable Banking API on 127.0.0.1 for tests (issue #224), as strict as the
// real one about what it checks: the JWT's header (RS256, `kid` = a known
// application) and claims (issuer, audience, issued now, valid at most a day),
// and its signature against the application's public key. A rate limit can
// be switched on. GET /application only, for now; linking and accounts come
// with the next steps. All data made up.

import http from 'node:http';
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';

export const FAKE_EB_APP_ID = '00000000-0000-4000-8000-0000000000eb';

/** A made-up application key, generated once per test run (2048 bits: quick). */
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const FAKE_EB_PRIVATE_KEY = /** @type {string} */ (
	pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
);

/**
 * @param {object} [options]
 * @param {string} [options.appId]
 * @param {string} [options.publicKey] PEM; defaults to the made-up key's
 * @param {string} [options.environment]
 * @param {boolean} [options.active]
 * @param {string[]} [options.redirectUrls]
 * @param {number} [options.rateLimit] requests allowed before 429; Infinity by default
 * @param {() => number} [options.now] ms
 */
export async function startFakeEnableBanking({
	appId = FAKE_EB_APP_ID,
	publicKey,
	environment = 'SANDBOX',
	active = true,
	redirectUrls = ['https://belege.le-space.de/integrationen/bank/verbunden'],
	rateLimit = Infinity,
	now = Date.now
} = {}) {
	const key = publicKey ? createPublicKey(publicKey) : pair.publicKey;
	const state = { requests: 0, refused: /** @type {string[]} */ ([]) };

	/** @param {string | undefined} header @returns {string | null} why it is refused */
	function checkJwt(header) {
		const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(header ?? '');
		if (!m) return 'no bearer token';
		let head, claims;
		try {
			head = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
			claims = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8'));
		} catch {
			return 'not a JWT';
		}
		if (head.alg !== 'RS256' || head.typ !== 'JWT') return 'algorithm';
		if (head.kid !== appId) return 'unknown application';
		if (claims.iss !== 'enablebanking.com' || claims.aud !== 'api.enablebanking.com')
			return 'claims';
		const t = Math.floor(now() / 1000);
		if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return 'times';
		if (claims.iat > t + 60 || claims.exp <= t || claims.exp - claims.iat > 86400) return 'expired';
		const ok = createVerify('RSA-SHA256')
			.update(`${m[1]}.${m[2]}`)
			.verify(key, Buffer.from(m[3], 'base64url'));
		return ok ? null : 'signature';
	}

	const server = http.createServer((req, res) => {
		/** @param {number} status @param {unknown} body */
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		state.requests++;
		const why = checkJwt(req.headers.authorization);
		if (why) {
			state.refused.push(why);
			return send(401, { code: 401, error: 'UNAUTHORIZED', message: `JWT refused: ${why}` });
		}
		if (state.requests > rateLimit) {
			return send(429, { code: 429, error: 'TOO_MANY_REQUESTS', message: 'Rate limit' });
		}
		const path = new URL(req.url ?? '/', 'http://x').pathname;
		if (req.method === 'GET' && path === '/application') {
			return send(200, {
				name: 'Beispiel Belege',
				kid: appId,
				environment,
				redirect_urls: redirectUrls,
				active,
				countries: ['DE']
			});
		}
		// For the client's hardening: an answer that tries to send it elsewhere.
		if (path === '/moved') {
			res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
			return res.end();
		}
		if (path === '/huge') {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(`"${'x'.repeat(64 * 1024)}"`);
		}
		send(404, { code: 404, error: 'NOT_FOUND', message: 'Not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		state,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}

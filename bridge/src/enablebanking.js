// Enable Banking, the client (issue #224, step 1): signed requests to their
// API, and nothing else yet. Linking a bank and reading its accounts build on
// this.
//
// Every installation uses its own Enable Banking application. A request is
// authenticated by a JWT the bridge signs with that application's private key
// (RS256, `kid` = the application id, valid ten minutes). The key never
// leaves this machine and is never sent; Enable Banking knows only its public
// half.
//
// Hardening:
//   - one host: `api.enablebanking.com` (tests: a fake on 127.0.0.1), set in
//     the configuration, never by a caller; a path is a path, not a URL;
//   - redirects are not followed: an answer 3xx is an error;
//   - a timeout, and a limit on the size of an answer;
//   - a refusal says what kind it is (key, rate limit, the bank, unavailable)
//     with Enable Banking's short error code, never its text or a body.

import { createPrivateKey, createSign } from 'node:crypto';
import { dirname, join } from 'node:path';

import { sealedFile } from './sealed-file.js';

export const API = 'https://api.enablebanking.com';

/** Where the bank sends the browser back to: the app's own page. */
export const DEFAULT_REDIRECT_URL = 'https://belege.le-space.de/integrationen/bank/verbunden';

/**
 * The application key and, later, the sessions: sealed beside the
 * configuration, opened by the keychain's `enablebanking` entry.
 *
 * @param {{ configPath: string, keychain: import('./keychain.js').Keychain }} params
 */
export const enableBankingSecrets = ({ configPath, keychain }) =>
	sealedFile({
		path: join(dirname(configPath), 'enablebanking.sealed'),
		keychain,
		label: 'enablebanking',
		setup: 'setup:enablebanking'
	});

/**
 * @typedef {object} EnableBankingSecrets what the sealed file holds
 * @property {string} privateKey the application's key, PEM
 * @property {Record<string, unknown>} sessions linked banks, by session id (step 2)
 */

/** Seconds a signed request stays valid; Enable Banking accepts up to a day. */
const JWT_LIFETIME = 600;
const TIMEOUT_MS = 20_000;
/** An account's transactions come in pages; none is near this. */
const MAX_ANSWER_BYTES = 5 * 1024 * 1024;

export class EnableBankingError extends Error {
	/**
	 * @param {string} message plain words, no bank data
	 * @param {'EB_AUTH' | 'EB_RATE_LIMIT' | 'EB_REFUSED' | 'EB_UNAVAILABLE' | 'EB_BAD_ANSWER' | 'EB_KEY'} code
	 * @param {number} [status] what the bridge answers the app
	 * @param {string | null} [providerCode] Enable Banking's own short code, when it sent one
	 */
	constructor(message, code, status = 502, providerCode = null) {
		super(message);
		this.name = 'EnableBankingError';
		this.code = code;
		this.status = status;
		this.providerCode = providerCode;
	}
}

/** An application id as the Control Panel shows it. @param {unknown} id */
export const isApplicationId = (id) =>
	typeof id === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());

/**
 * The private key file the Control Panel hands out → a key to sign with.
 * Only an RSA private key of at least 2048 bits; never echoes the input.
 *
 * @param {string} pem
 * @returns {import('node:crypto').KeyObject}
 */
export function parsePrivateKey(pem) {
	let key;
	try {
		key = createPrivateKey({ key: String(pem), format: 'pem' });
	} catch {
		throw new EnableBankingError('That is not a private key in PEM format.', 'EB_KEY', 503);
	}
	const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
	if (key.asymmetricKeyType !== 'rsa' || bits < 2048) {
		throw new EnableBankingError(
			'Enable Banking signs with RSA; this key is not an RSA key of 2048 bits or more.',
			'EB_KEY',
			503
		);
	}
	return key;
}

/**
 * The bearer token of one request.
 *
 * @param {{ appId: string, key: import('node:crypto').KeyObject, now?: number }} params now in ms
 */
export function signJwt({ appId, key, now = Date.now() }) {
	const iat = Math.floor(now / 1000);
	const b64 = (/** @type {object} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const head = b64({ typ: 'JWT', alg: 'RS256', kid: appId });
	const body = b64({
		iss: 'enablebanking.com',
		aud: 'api.enablebanking.com',
		iat,
		exp: iat + JWT_LIFETIME
	});
	const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
	return `${head}.${body}.${sig}`;
}

/**
 * @typedef {object} Application what GET /application says about the key's application
 * @property {string} name
 * @property {string} environment `SANDBOX` or `PRODUCTION`
 * @property {boolean} active false until Enable Banking has activated it
 * @property {string[]} redirectUrls as registered
 */

/**
 * @param {object} options
 * @param {string} options.appId
 * @param {() => Promise<string>} options.getPrivateKey the PEM, read when a request is made
 * @param {string} [options.baseUrl] the configuration's; tests: a fake on 127.0.0.1
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {() => number} [options.now]
 */
export function createEnableBankingClient({
	appId,
	getPrivateKey,
	baseUrl = API,
	fetch: fetchImpl = fetch,
	timeoutMs = TIMEOUT_MS,
	maxBytes = MAX_ANSWER_BYTES,
	now = Date.now
}) {
	const origin = new URL(baseUrl).origin;

	/**
	 * @param {'GET' | 'POST' | 'DELETE'} method
	 * @param {string} path starting with `/`, with its query
	 * @param {unknown} [body]
	 * @returns {Promise<any>}
	 */
	async function request(method, path, body) {
		if (!/^\/[A-Za-z0-9/_\-.?=&%:+~]*$/.test(path) || path.startsWith('//')) {
			throw new EnableBankingError('Not a path of the Enable Banking API.', 'EB_BAD_ANSWER', 500);
		}
		const url = new URL(path, origin);
		if (url.origin !== origin) {
			throw new EnableBankingError('Not a path of the Enable Banking API.', 'EB_BAD_ANSWER', 500);
		}
		const key = parsePrivateKey(await getPrivateKey());
		/** @type {Response} */ let res;
		try {
			res = await fetchImpl(url, {
				method,
				redirect: 'manual',
				signal: AbortSignal.timeout(timeoutMs),
				headers: {
					authorization: `Bearer ${signJwt({ appId, key, now: now() })}`,
					accept: 'application/json',
					...(body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			throw new EnableBankingError(
				'Enable Banking did not answer (network or timeout).',
				'EB_UNAVAILABLE',
				502
			);
		}
		const text = await readLimited(res, maxBytes);
		/** @type {any} */ let json = null;
		try {
			json = text ? JSON.parse(text) : {};
		} catch {
			json = null;
		}
		if (res.status >= 300 && res.status < 400) {
			throw new EnableBankingError(
				`Enable Banking answered with a redirect (HTTP ${res.status}); not followed.`,
				'EB_BAD_ANSWER',
				502
			);
		}
		if (!res.ok) throw refusal(res.status, json);
		if (json === null || typeof json !== 'object') {
			throw new EnableBankingError('Enable Banking sent no JSON.', 'EB_BAD_ANSWER', 502);
		}
		return json;
	}

	return {
		request,

		/** @returns {Promise<Application>} */
		async application() {
			const a = await request('GET', '/application');
			return {
				name: typeof a.name === 'string' ? a.name : '',
				environment: typeof a.environment === 'string' ? a.environment : '',
				active: a.active === true,
				redirectUrls: Array.isArray(a.redirect_urls)
					? a.redirect_urls.filter((/** @type {unknown} */ u) => typeof u === 'string')
					: []
			};
		}
	};
}

/**
 * The body, but no more than `max` bytes of it.
 *
 * @param {Response} res
 * @param {number} max
 */
async function readLimited(res, max) {
	if (!res.body) return '';
	const reader = res.body.getReader();
	/** @type {Uint8Array[]} */ const parts = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			throw new EnableBankingError('Enable Banking’s answer is too large.', 'EB_BAD_ANSWER', 502);
		}
		parts.push(value);
	}
	return Buffer.concat(parts).toString('utf8');
}

/**
 * A refusal in plain words. Enable Banking's own code goes along (it says
 * what to fix); its message and the body do not, they may echo request data.
 *
 * @param {number} status
 * @param {any} json
 */
function refusal(status, json) {
	const raw = json?.error ?? json?.code;
	const providerCode =
		typeof raw === 'string' && /^[A-Z0-9_]{2,64}$/.test(raw)
			? raw
			: typeof raw === 'number'
				? String(raw)
				: null;
	if (status === 401 || status === 403) {
		return new EnableBankingError(
			'Enable Banking refused the application key: check the application id and the key file (pnpm setup:enablebanking).',
			'EB_AUTH',
			503,
			providerCode
		);
	}
	if (status === 429) {
		return new EnableBankingError(
			'Enable Banking or the bank allows no more requests for now; try again later.',
			'EB_RATE_LIMIT',
			429,
			providerCode
		);
	}
	if (status >= 500) {
		return new EnableBankingError(
			`Enable Banking is not available (HTTP ${status}).`,
			'EB_UNAVAILABLE',
			502,
			providerCode
		);
	}
	return new EnableBankingError(
		`Enable Banking refused the request (HTTP ${status}${providerCode ? `, ${providerCode}` : ''}).`,
		'EB_REFUSED',
		502,
		providerCode
	);
}

// JSON over HTTPS for the chain clients: a timeout per request, a few
// retries on what is worth retrying (no answer, 5xx, 429, a body that is no
// JSON – public RPCs do that now and then), and errors with a code.
//
// Error messages name the host at most, never a path or a query: those
// carry the wallet's address, and the bridge logs error messages.

export class WalletError extends Error {
	/** @param {string} message @param {string} code @param {number} [status] */
	constructor(message, code, status = 502) {
		super(message);
		this.name = 'WalletError';
		this.code = code;
		this.status = status;
	}
}

/** @param {string} url */
export function hostOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return '?';
	}
}

/**
 * An endpoint the bridge may call: https, or http on this machine when
 * `allowLoopback` (tests). No user:password@, no fragment. Returns it
 * without a trailing slash, or null.
 *
 * @param {unknown} value
 * @param {{ allowLoopback?: boolean }} [options]
 */
export function checkEndpoint(value, { allowLoopback = false } = {}) {
	if (typeof value !== 'string' || value.length > 300) return null;
	let url;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	if (url.username || url.password || url.hash || url.search) return null;
	const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	if (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) {
		return null;
	}
	return url.toString().replace(/\/+$/, '');
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createJsonFetcher({
	fetch: f,
	timeoutMs = 20_000,
	retries = 2,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
	/**
	 * @param {string} url
	 * @param {RequestInit} [init]
	 * @param {{ retryIf?: (body: any) => boolean }} [options] a JSON answer that is a transient error
	 * @returns {Promise<any>}
	 */
	return async function getJson(url, init = {}, { retryIf } = {}) {
		const host = hostOf(url);
		/** @type {WalletError | null} */
		let last = null;
		for (let attempt = 0; attempt <= retries; attempt++) {
			if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
			let res;
			try {
				res = await f(url, {
					...init,
					headers: { accept: 'application/json', ...(init.headers ?? {}) },
					signal: AbortSignal.timeout(timeoutMs),
					redirect: 'error'
				});
			} catch (/** @type {any} */ error) {
				last =
					error?.name === 'TimeoutError' || error?.name === 'AbortError'
						? new WalletError(`${host} did not answer in time`, 'WALLET_TIMEOUT', 504)
						: new WalletError(`${host} is not reachable`, 'WALLET_UNREACHABLE');
				continue;
			}
			const body = await res.json().catch(() => undefined);
			if (res.status === 429 || res.status >= 500 || body === undefined) {
				last = new WalletError(
					res.status === 429
						? `${host} limits requests (HTTP 429)`
						: `${host} answered ${res.status}${body === undefined ? ' without JSON' : ''}`,
					res.status === 429 ? 'WALLET_RATE_LIMIT' : 'WALLET_NODE',
					res.status === 429 ? 429 : 502
				);
				continue;
			}
			if (retryIf?.(body)) {
				last = new WalletError(`${host} is busy`, 'WALLET_RATE_LIMIT', 429);
				continue;
			}
			if (!res.ok) {
				throw new WalletError(`${host} answered ${res.status}`, 'WALLET_NODE');
			}
			return body;
		}
		throw /** @type {WalletError} */ (last);
	};
}

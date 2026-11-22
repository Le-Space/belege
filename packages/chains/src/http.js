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
		/** @type {number | undefined} the HTTP status of a refusal, when there was one */
		this.httpStatus = undefined;
		/** @type {unknown} its JSON body, never sent on or logged */
		this.body = undefined;
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

/** @param {string} text four numbers with dots @returns {number[] | null} */
function ipv4Of(text) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
	if (!m) return null;
	const parts = m.slice(1).map(Number);
	return parts.every((n) => n <= 255) ? parts : null;
}

/** @param {number[]} ip */
const privateIpv4 = ([a, b, c]) =>
	a === 0 || // "this network"
	a === 10 ||
	a === 127 || // loopback
	(a === 100 && b >= 64 && b <= 127) || // shared address space (carrier NAT)
	(a === 169 && b === 254) || // link-local, and where cloud metadata lives
	(a === 172 && b >= 16 && b <= 31) ||
	(a === 192 && b === 168) ||
	(a === 192 && b === 0 && c === 0) || // protocol assignments
	(a === 198 && (b === 18 || b === 19)) || // benchmarking
	a >= 224; // multicast, reserved, broadcast

/**
 * Whether an address is not one on the public internet: this machine, a
 * private or link-local network, a carrier's shared space, multicast – in
 * IPv4 or IPv6, an IPv4 address mapped into IPv6 included. For an address as
 * a resolver gives it, or as it stands in a URL (IPv6 in brackets).
 *
 * @param {string} address
 */
export function isPrivateAddress(address) {
	const text = String(address)
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '');
	const v4 = ipv4Of(text);
	if (v4) return privateIpv4(v4);
	if (!text.includes(':')) return false; // not an address
	const zone = text.split('%')[0];
	if (zone === '::' || zone === '::1') return true; // unspecified, loopback
	// An IPv4 address in an IPv6 one – mapped, compatible, or under the NAT64
	// prefix – written with dots or, as `URL` writes it, as two hex groups.
	const dotted = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(zone);
	if (dotted) {
		const inner = ipv4Of(dotted[1]);
		return !inner || privateIpv4(inner);
	}
	const hex = /^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(zone);
	if (hex) {
		const hi = parseInt(hex[1], 16);
		const lo = parseInt(hex[2], 16);
		return privateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
	}
	const first = parseInt(zone.split(':')[0] || '0', 16);
	return (
		(first & 0xfe00) === 0xfc00 || // unique local, fc00::/7
		(first & 0xffc0) === 0xfe80 || // link-local, fe80::/10
		(first & 0xff00) === 0xff00 // multicast
	);
}

/**
 * Whether a host name in a URL can only mean this machine or a private
 * network: an address that is one (above), `localhost`, a name without a dot,
 * or one under a suffix kept for local use.
 *
 * @param {string} hostname as `URL.hostname` gives it
 */
export function isLocalHostname(hostname) {
	const name = String(hostname).trim().toLowerCase().replace(/\.$/, '');
	if (!name) return true;
	if (name.startsWith('[') || ipv4Of(name)) return isPrivateAddress(name);
	// Other spellings of an IPv4 address (one number, hex, octal): `URL` has
	// turned those into dotted form already; what is left of digits and dots is no name.
	if (/^[\d.]+$/.test(name) || /^0x[0-9a-f.x]+$/.test(name)) return true;
	if (!name.includes('.')) return true; // `localhost`, a machine's bare name
	return /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/.test(
		name
	);
}

/**
 * An endpoint the bridge may call: https on a host of the public internet –
 * not this machine, not a private or link-local address, not a name kept for
 * local use – or http on this machine when `allowLoopback` (tests). No
 * user:password@, no query, no fragment. Returns it without a trailing slash,
 * or null.
 *
 * A name is checked as it is written. What it resolves to is checked where
 * the request is made (the bridge's `publicOnlyFetch`).
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
	if (allowLoopback && loopback && (url.protocol === 'http:' || url.protocol === 'https:')) {
		return url.toString().replace(/\/+$/, '');
	}
	if (url.protocol !== 'https:' || isLocalHostname(url.hostname)) return null;
	return url.toString().replace(/\/+$/, '');
}

/**
 * A Retry-After header in milliseconds: seconds, or an HTTP date.
 *
 * @param {string | null | undefined} value
 * @param {number} [now]
 * @returns {number | null}
 */
export function retryAfterMs(value, now = Date.now()) {
	if (!value) return null;
	const text = value.trim();
	if (/^\d+$/.test(text)) return Number(text) * 1000;
	const at = Date.parse(text);
	return Number.isNaN(at) ? null : Math.max(0, at - now);
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
			// A refusal in plain text (Aleph's 404 for an empty window): asking
			// again changes nothing, and the caller may tell it apart by its status.
			if (body === undefined && res.status >= 400 && res.status < 500 && res.status !== 429) {
				const error = new WalletError(`${host} answered ${res.status} without JSON`, 'WALLET_NODE');
				error.httpStatus = res.status;
				throw error;
			}
			if (res.status === 429 || res.status >= 500 || body === undefined) {
				// A refusal that says when to come back: wait that long (a minute at
				// most) before the next try, on top of the usual pause.
				const after = retryAfterMs(res.headers?.get?.('retry-after'));
				if (after !== null && attempt < retries) await sleep(Math.min(after, 60_000));
				last = new WalletError(
					res.status === 429
						? `${host} limits requests (HTTP 429)`
						: `${host} answered ${res.status}${body === undefined ? ' without JSON' : ''}`,
					res.status === 429 ? 'WALLET_RATE_LIMIT' : 'WALLET_NODE',
					res.status === 429 ? 429 : 502
				);
				last.httpStatus = res.status;
				continue;
			}
			if (retryIf?.(body)) {
				last = new WalletError(`${host} is busy`, 'WALLET_RATE_LIMIT', 429);
				continue;
			}
			if (!res.ok) {
				const error = new WalletError(`${host} answered ${res.status}`, 'WALLET_NODE');
				// For a caller that tells its API's refusals apart (Alchemy: 401, 403).
				error.httpStatus = res.status;
				error.body = body;
				throw error;
			}
			return body;
		}
		throw /** @type {WalletError} */ (last);
	};
}

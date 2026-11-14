// Fetching from Aleph's API for the hosted bridge (#587), so a slow or
// failing Aleph shows as that: what is downloading and how far it is, a
// second Aleph host when the first one fails, and an error that names Aleph
// and what it answered – instead of a card that just says "Lade …".
//
// Only Aleph's own API hosts are retried on another one; any other URL (AMD's
// key service during attestation) passes through untouched. Files from
// Aleph's storage (`/api/v0/storage/raw/<sha256>`) are content-addressed:
// one whose bytes hash to its name is kept in the browser's cache, so the
// SEV-SNP runtime (about 15 MB) is downloaded once, not at every unlock.
// It is public and checked against its manifest anyway; nothing secret is
// kept there.

/** The hosts tried, in order, after the one asked (both named in the consent screen). */
export const ALEPH_API_HOSTS = Object.freeze(['https://api2.aleph.im', 'https://api.aleph.im']);

/** The browser cache for Aleph's content-addressed files. */
export const ALEPH_CACHE = 'aleph-storage-v1';

/** No byte for this long: give up on this host. */
const IDLE_MS = 30_000;

/** A failed fetch from Aleph: what each host answered. */
export class AlephUnavailable extends Error {
	/** @param {string} path @param {{ host: string, outcome: string }[]} tried */
	constructor(path, tried) {
		super(
			`Aleph: ${tried.map((t) => `${new URL(t.host).host} ${t.outcome}`).join(', ')} (${path})`
		);
		this.name = 'AlephUnavailable';
		this.path = path;
		this.tried = tried;
	}
}

/** @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		/** @type {BufferSource} */ (bytes)
	);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} pathname */
const storageHash = (pathname) =>
	/^\/api\/v0\/storage\/raw\/([0-9a-f]{64})$/.exec(pathname)?.[1] ?? null;

/**
 * A `fetch` for the hosted bridge's calls to Aleph.
 *
 * @param {{
 *   hosts?: readonly string[],
 *   fetch?: typeof fetch,
 *   cache?: { open: (name: string) => Promise<Cache> } | null,
 *   idleMs?: number,
 *   onDownload?: (p: { host: string, received: number, total: number | null, ms: number }) => void,
 *   now?: () => number
 * }} [options]
 * @returns {typeof fetch}
 */
export function alephFetch({
	hosts = ALEPH_API_HOSTS,
	fetch: base = globalThis.fetch.bind(globalThis),
	cache = globalThis.caches ?? null,
	idleMs = IDLE_MS,
	onDownload = () => {},
	now = () => Date.now()
} = {}) {
	const origins = hosts.map((h) => new URL(h).origin);

	/** @param {string} key */
	async function fromCache(key) {
		try {
			const hit = await (await cache?.open(ALEPH_CACHE))?.match(key);
			return hit ?? null;
		} catch {
			return null;
		}
	}

	/** @param {string} key @param {Uint8Array} bytes */
	async function intoCache(key, bytes) {
		try {
			await (
				await cache?.open(ALEPH_CACHE)
			)?.put(key, new Response(/** @type {BodyInit} */ (bytes)));
		} catch {
			// a full or blocked cache only means downloading again next time
		}
	}

	/**
	 * The whole body, with progress, given up when no byte comes for `idleMs`.
	 *
	 * @param {string} url @param {RequestInit | undefined} init @param {string} host
	 */
	async function download(url, init, host) {
		const controller = new AbortController();
		let timer = setTimeout(() => controller.abort(), idleMs);
		const started = now();
		try {
			const response = await base(url, { ...init, signal: controller.signal });
			if (!response.ok || !response.body) {
				return { status: response.status, ok: response.ok, headers: response.headers, bytes: null };
			}
			const total = Number(response.headers.get('content-length')) || null;
			const reader = response.body.getReader();
			/** @type {Uint8Array[]} */
			const parts = [];
			let received = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				clearTimeout(timer);
				timer = setTimeout(() => controller.abort(), idleMs);
				parts.push(value);
				received += value.length;
				onDownload({ host, received, total, ms: now() - started });
			}
			const bytes = new Uint8Array(received);
			let at = 0;
			for (const part of parts) {
				bytes.set(part, at);
				at += part.length;
			}
			return { status: response.status, ok: true, headers: response.headers, bytes };
		} finally {
			clearTimeout(timer);
		}
	}

	/** @type {typeof fetch} */
	return async function (input, init) {
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
		);
		if (!origins.includes(url.origin) || (init?.method && init.method !== 'GET')) {
			return base(input, init);
		}
		const hash = storageHash(url.pathname);
		const key = hash ? `https://aleph-storage.invalid/${hash}` : null;
		if (key) {
			const hit = await fromCache(key);
			if (hit) return hit;
		}
		const order = [url.origin, ...origins.filter((o) => o !== url.origin)];
		/** @type {{ host: string, outcome: string }[]} */
		const tried = [];
		for (const origin of order) {
			const target = `${origin}${url.pathname}${url.search}`;
			try {
				const got = await download(target, init, origin);
				if (got.ok && got.bytes) {
					// A content-addressed file is kept only if it is what its name says.
					if (key && hash && (await sha256Hex(got.bytes)) === hash) await intoCache(key, got.bytes);
					return new Response(/** @type {BodyInit} */ (got.bytes), {
						status: got.status,
						headers: got.headers
					});
				}
				tried.push({ host: origin, outcome: `HTTP ${got.status}` });
				// A 4xx other than "not here (yet)" is an answer, not an outage.
				if (got.status >= 400 && got.status < 500 && got.status !== 404 && got.status !== 429) {
					return new Response(null, { status: got.status });
				}
			} catch (error) {
				const aborted = /** @type {any} */ (error)?.name === 'AbortError';
				tried.push({
					host: origin,
					outcome: aborted ? `no answer for ${Math.round(idleMs / 1000)} s` : 'unreachable'
				});
			}
		}
		throw new AlephUnavailable(url.pathname, tried);
	};
}

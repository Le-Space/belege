import { describe, expect, it } from 'vitest';
import { ALEPH_CACHE, AlephUnavailable, alephFetch } from './aleph-fetch.js';

const A = 'https://api2.aleph.im';
const B = 'https://api.aleph.im';
const bytes = new TextEncoder().encode('runtime bytes');

async function sha(/** @type {Uint8Array} */ b) {
	const d = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (b));
	return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** A fake fetch answering per origin; records the URLs asked. */
function fake(
	/** @type {Record<string, (url: string) => Response | Promise<Response>>} */ byOrigin
) {
	/** @type {string[]} */
	const asked = [];
	const f = /** @type {typeof fetch} */ (
		async (input) => {
			const url = String(input);
			asked.push(url);
			const answer = byOrigin[new URL(url).origin];
			if (!answer) throw new TypeError('fetch failed');
			return answer(url);
		}
	);
	return { f, asked };
}

function memoryCache() {
	const store = new Map();
	return {
		store,
		open: async (/** @type {string} */ name) =>
			/** @type {any} */ ({
				match: async (/** @type {string} */ k) => store.get(`${name} ${k}`)?.clone() ?? undefined,
				put: async (/** @type {string} */ k, /** @type {Response} */ r) =>
					void store.set(`${name} ${k}`, r)
			})
	};
}

describe('alephFetch', () => {
	it('passes anything not Aleph’s API through untouched', async () => {
		const { f, asked } = fake({ 'https://kdsintf.amd.com': () => new Response('cert') });
		const get = alephFetch({ fetch: f, cache: null });
		expect(await (await get('https://kdsintf.amd.com/vcek/x')).text()).toBe('cert');
		expect(asked).toEqual(['https://kdsintf.amd.com/vcek/x']);
	});

	it('asks the other Aleph host when the first answers 404, and reports the bytes', async () => {
		const { f, asked } = fake({
			[A]: () => new Response('not found', { status: 404 }),
			[B]: () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
		});
		/** @type {any[]} */
		const progress = [];
		const get = alephFetch({ fetch: f, cache: null, onDownload: (p) => progress.push(p) });
		const response = await get(`${A}/api/v0/messages/abc`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
		expect(asked).toEqual([`${A}/api/v0/messages/abc`, `${B}/api/v0/messages/abc`]);
		expect(progress.at(-1)).toMatchObject({ host: B, received: bytes.length, total: bytes.length });
	});

	it('says what each host answered when none can', async () => {
		const { f } = fake({ [A]: () => new Response('', { status: 502 }) });
		const get = alephFetch({ fetch: f, cache: null });
		const error = await get(`${A}/api/v0/messages/abc`).catch((e) => e);
		expect(error).toBeInstanceOf(AlephUnavailable);
		expect(error.tried).toEqual([
			{ host: A, outcome: 'HTTP 502' },
			{ host: B, outcome: 'unreachable' }
		]);
		expect(error.message).toBe(
			'Aleph: api2.aleph.im HTTP 502, api.aleph.im unreachable (/api/v0/messages/abc)'
		);
	});

	it('gives up on a host that sends nothing, and says so', async () => {
		// A host that never answers: only the abort ends the request.
		const f = /** @type {typeof fetch} */ (
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
					);
				})
		);
		const get = alephFetch({ fetch: f, cache: null, idleMs: 20 });
		const error = await get(`${A}/api/v0/messages/abc`).catch((e) => e);
		expect(error.tried.map((/** @type {any} */ t) => t.outcome)).toEqual([
			'no answer for 0 s',
			'no answer for 0 s'
		]);
	});

	it('a refusal is an answer: no other host, no error', async () => {
		const { f, asked } = fake({ [A]: () => new Response('', { status: 403 }) });
		const response = await alephFetch({ fetch: f, cache: null })(`${A}/api/v0/messages/abc`);
		expect(response.status).toBe(403);
		expect(asked).toHaveLength(1);
	});

	it('keeps a content-addressed file that matches its hash, and serves it from the cache', async () => {
		const hash = await sha(bytes);
		const cache = memoryCache();
		const { f, asked } = fake({ [A]: () => new Response(bytes) });
		const get = alephFetch({ fetch: f, cache });
		await get(`${A}/api/v0/storage/raw/${hash}`);
		const again = await get(`${A}/api/v0/storage/raw/${hash}`);
		expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);
		expect(asked).toHaveLength(1);
		expect([...cache.store.keys()]).toEqual([
			`${ALEPH_CACHE} https://aleph-storage.invalid/${hash}`
		]);
	});

	it('does not keep a file whose bytes are not what its name says', async () => {
		const cache = memoryCache();
		const { f } = fake({ [A]: () => new Response(bytes) });
		await alephFetch({ fetch: f, cache })(`${A}/api/v0/storage/raw/${'0'.repeat(64)}`);
		expect(cache.store.size).toBe(0);
	});
});

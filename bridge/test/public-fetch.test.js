// The fetch for hosts a caller may name reaches the public internet only.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { publicOnlyFetch } from '../src/public-fetch.js';

/** A fetch that notes what it was asked, and a resolver with a table. */
function setup(/** @type {Record<string, string[]>} */ table, options = {}) {
	/** @type {string[]} */
	const fetched = [];
	/** @type {string[]} */
	const resolved = [];
	const fetchPublic = publicOnlyFetch(
		/** @type {any} */ (
			async (/** @type {any} */ input) => {
				fetched.push(String(input));
				return new Response('{}');
			}
		),
		{
			lookup: async (hostname) => {
				resolved.push(hostname);
				if (!table[hostname]) throw new Error('ENOTFOUND');
				return table[hostname].map((address) => ({ address }));
			},
			...options
		}
	);
	return { fetchPublic, fetched, resolved };
}

test('a name that resolves to the public internet is fetched', async () => {
	const { fetchPublic, fetched, resolved } = setup({ 'rpc.example.com': ['93.184.216.34'] });
	await fetchPublic('https://rpc.example.com/v1');
	assert.deepEqual(resolved, ['rpc.example.com']);
	assert.deepEqual(fetched, ['https://rpc.example.com/v1']);
});

test('a name that resolves to this machine or a private network is not', async () => {
	for (const addresses of [
		['127.0.0.1'],
		['10.0.0.5'],
		['192.168.1.20'],
		['169.254.169.254'],
		['::1'],
		['fd00::1'],
		['fe80::1'],
		['::ffff:10.0.0.5'],
		// One private address among public ones is enough.
		['93.184.216.34', '10.0.0.5']
	]) {
		const { fetchPublic, fetched } = setup({ 'node.example.com': addresses });
		await assert.rejects(
			fetchPublic('https://node.example.com/'),
			/fetch failed/,
			String(addresses)
		);
		assert.deepEqual(fetched, [], String(addresses));
	}
});

test('an address in the URL is checked as it stands, without asking the resolver', async () => {
	const { fetchPublic, fetched, resolved } = setup({});
	await assert.rejects(fetchPublic('https://10.0.0.5/'), /fetch failed/);
	await assert.rejects(fetchPublic('https://[::1]:8443/'), /fetch failed/);
	await assert.rejects(fetchPublic(new URL('https://169.254.169.254/latest')), /fetch failed/);
	await fetchPublic('https://93.184.216.34/');
	assert.deepEqual(resolved, []);
	assert.deepEqual(fetched, ['https://93.184.216.34/']);
});

test('the refusal reads like a host that is down', async () => {
	const { fetchPublic } = setup({ 'node.example.com': ['10.0.0.5'] });
	const error = await fetchPublic('https://node.example.com/').catch((e) => e);
	assert.equal(error.message, 'fetch failed');
	assert.doesNotMatch(error.message, /10\.0\.0\.5|private/);
});

test('a name that does not resolve is left to fail as a request', async () => {
	const { fetchPublic, fetched } = setup({});
	await fetchPublic('https://nowhere.example.com/');
	assert.deepEqual(fetched, ['https://nowhere.example.com/']);
});

test('for the tests, this machine by its two plain names – and nothing else private', async () => {
	const { fetchPublic, fetched } = setup(
		{ 'node.example.com': ['127.0.0.1'] },
		{ allowLoopback: true }
	);
	await fetchPublic('http://127.0.0.1:9/api');
	await fetchPublic('http://localhost:9/api');
	assert.equal(fetched.length, 2);
	await assert.rejects(fetchPublic('https://node.example.com/'), /fetch failed/);
	await assert.rejects(fetchPublic('http://192.168.1.20:9/'), /fetch failed/);
});

/** A fetch that answers with `size` bytes, saying so in its header or not. */
function answering(/** @type {number} */ size, { declare = true, chunk = 64 * 1024 } = {}) {
	return publicOnlyFetch(
		/** @type {any} */ (
			async () => {
				let sent = 0;
				const body = new ReadableStream({
					pull(controller) {
						if (sent >= size) return controller.close();
						const n = Math.min(chunk, size - sent);
						sent += n;
						controller.enqueue(new Uint8Array(n).fill(0x20));
					}
				});
				return new Response(body, {
					status: 200,
					headers: declare ? { 'content-length': String(size) } : {}
				});
			}
		),
		{ lookup: async () => [{ address: '93.184.216.34' }], maxBytes: 1024 * 1024 }
	);
}

test('an answer within the limit is read whole, status and headers as they were', async () => {
	const res = await answering(1024 * 1024)('https://node.example.com/');
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-length'), String(1024 * 1024));
	assert.equal((await res.arrayBuffer()).byteLength, 1024 * 1024);
});

test('an answer that says it is larger than the limit is refused before it is read', async () => {
	await assert.rejects(answering(1024 * 1024 + 1)('https://node.example.com/'), (e) => {
		assert.equal(/** @type {any} */ (e).code, 'ANSWER_TOO_LARGE');
		return true;
	});
});

test('an answer that does not say its size is cut off once it passes the limit', async () => {
	const res = await answering(8 * 1024 * 1024, { declare: false })('https://node.example.com/');
	await assert.rejects(res.text(), (e) => {
		assert.equal(/** @type {any} */ (e).code, 'ANSWER_TOO_LARGE');
		return true;
	});
	// … and JSON too, as the chain readers read it.
	const again = await answering(8 * 1024 * 1024, { declare: false })('https://node.example.com/');
	await assert.rejects(again.json());
});

test('the default limit is 32 MiB', async () => {
	const { MAX_ANSWER_BYTES } = await import('../src/public-fetch.js');
	assert.equal(MAX_ANSWER_BYTES, 32 * 1024 * 1024);
});

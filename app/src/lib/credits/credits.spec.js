// The Le Space Credits client with a made-up key and a fake service. Nothing here is real.
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { canonical, createCreditsClient, isInvoiceUrl, isPaidMessage, payUrl } from './credits.js';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const BASE = 'https://credits.example.com';

/** Who signed `message` (EIP-191), as the service recovers it. @param {string} message @param {string} signature */
function signer(message, signature) {
	const body = new TextEncoder().encode(message);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const bytes = Uint8Array.from(signature.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16));
	const recovered = new Uint8Array(65);
	recovered[0] = bytes[64] - 27;
	recovered.set(bytes.subarray(0, 64), 1);
	const point = secp256k1.Signature.fromBytes(recovered, 'recovered').recoverPublicKey(
		keccak_256(new Uint8Array([...prefix, ...body]))
	);
	const hash = keccak_256(point.toBytes(false).slice(1)).slice(-20);
	return `0x${Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function fakeService() {
	/** @type {{ url: string, method: string, headers: Record<string, string>, body: any }[]} */
	const seen = [];
	/** @type {typeof fetch} */
	const f = async (url, init) => {
		const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
		seen.push({
			url: String(url),
			method: String(init?.method),
			headers,
			body: init?.body ? JSON.parse(String(init.body)) : null
		});
		if (String(url).includes('/v1/refund'))
			return new Response(JSON.stringify({ error: 'nothing to refund', code: 'NOTHING' }), {
				status: 409
			});
		return new Response(JSON.stringify({ credits: 2500, client_secret: 'cs_test_x' }));
	};
	return { seen, f };
}

describe('Le Space Credits client', () => {
	it('signs each request with the books’ key over the line the service checks', async () => {
		const { seen, f } = fakeService();
		const client = await createCreditsClient({
			key: KEY,
			base: BASE,
			fetch: f,
			now: () => 1_800_000_000_000
		});
		await client.balance();
		await client.checkout('topup-25', 'de');

		const [get, post] = seen;
		expect(get.url).toBe(`${BASE}/v1/balance?product=belege`);
		expect(post.body).toEqual({ product: 'belege', package: 'topup-25', locale: 'de' });
		for (const [r, method, path] of /** @type {const} */ ([
			[get, 'GET', '/v1/balance'],
			[post, 'POST', '/v1/checkout']
		])) {
			const line = canonical({
				method,
				path,
				address: r.headers['x-ls-address'],
				timestamp: Number(r.headers['x-ls-timestamp'])
			});
			expect(line.startsWith(`ls-credits/v1\n${method}\n${path}\nbelege\n`)).toBe(true);
			expect(signer(line, r.headers['x-ls-signature'])).toBe(client.address.toLowerCase());
		}
		// Two requests in one second never share a timestamp: the service takes each once.
		expect(post.headers['x-ls-timestamp']).not.toBe(get.headers['x-ls-timestamp']);
	});

	it('says what the service refused', async () => {
		const { f } = fakeService();
		const client = await createCreditsClient({ key: KEY, base: BASE, fetch: f });
		await expect(client.refund()).rejects.toMatchObject({ status: 409, code: 'NOTHING' });
	});

	it('puts the secret in the fragment and trusts only the service’s own message', () => {
		const url = payUrl('cs_test_a/b', 'https://belege.example.com', BASE);
		expect(url).toBe(`${BASE}/pay#cs=cs_test_a%2Fb&origin=https%3A%2F%2Fbelege.example.com`);
		expect(new URL(url).search).toBe('');
		expect(isPaidMessage({ origin: BASE, data: { type: 'ls-credits:paid' } }, BASE)).toBe(true);
		expect(
			isPaidMessage({ origin: 'https://evil.example.com', data: { type: 'ls-credits:paid' } }, BASE)
		).toBe(false);
		expect(isPaidMessage({ origin: BASE, data: { type: 'other' } }, BASE)).toBe(false);
	});

	it('opens only Stripe’s hosted invoice pages', () => {
		expect(isInvoiceUrl('https://invoice.stripe.com/i/acct_test/test_abc')).toBe(true);
		expect(isInvoiceUrl('http://invoice.stripe.com/i/x')).toBe(false);
		expect(isInvoiceUrl('https://invoice.stripe.com.example.com/i/x')).toBe(false);
		expect(isInvoiceUrl('https://user@invoice.stripe.com/i/x')).toBe(false);
		expect(isInvoiceUrl('javascript:alert(1)')).toBe(false);
		expect(isInvoiceUrl(null)).toBe(false);
	});

	it('reads the purchase list out of the service’s answer', async () => {
		/** @type {typeof fetch} */
		const f = async () =>
			new Response(JSON.stringify({ purchases: [{ id: 'p1', amount_cents: 1000 }] }));
		const client = await createCreditsClient({ key: KEY, base: BASE, fetch: f });
		expect(await client.purchases()).toEqual([{ id: 'p1', amount_cents: 1000 }]);
		const empty = await createCreditsClient({
			key: KEY,
			base: BASE,
			fetch: async () => new Response('{}')
		});
		expect(await empty.purchases()).toEqual([]);
	});
});

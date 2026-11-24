// The Le Space Credits client with a made-up key and a fake service. Nothing here is real.
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import {
	canonical,
	createCreditsClient,
	creditsPage,
	isInvoiceUrl,
	isPaidMessage,
	payUrl,
	publishedTerms,
	termsOf,
	withdrawalOf
} from './credits.js';

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

	it('asks for the terms, agrees to a version and sends the waiver with a top-up', async () => {
		/** @type {{ url: string, method: string, body: any }[]} */
		const seen = [];
		/** @type {typeof fetch} */
		const f = async (url, init) => {
			seen.push({
				url: String(url),
				method: String(init?.method),
				body: init?.body ? JSON.parse(String(init.body)) : null
			});
			return new Response(
				JSON.stringify({
					current: { version: '1', url: `${BASE}/agb/belege`, changes: 'first version' },
					withdrawal: { version: 'w2', de: 'DE text', en: 'EN text' }
				})
			);
		};
		const client = await createCreditsClient({ key: KEY, base: BASE, fetch: f });
		const terms = await client.terms();
		expect(terms.current).toEqual({
			version: '1',
			url: `${BASE}/agb/belege`,
			changes: ['first version'],
			effectiveAt: null,
			publishedAt: null
		});
		expect(terms.pending).toBeNull();
		expect(terms.withdrawal).toEqual({ version: 'w2', de: 'DE text', en: 'EN text' });
		await client.acceptTerms('1');
		await client.checkout('topup-10', 'en', 'w2');
		expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
			`GET ${BASE}/v1/terms?product=belege`,
			`POST ${BASE}/v1/terms/accept`,
			`POST ${BASE}/v1/checkout`
		]);
		expect(seen[1].body).toEqual({ product: 'belege', version: '1' });
		expect(seen[2].body).toEqual({
			product: 'belege',
			package: 'topup-10',
			locale: 'en',
			waiver: 'w2'
		});
	});

	it('links only to the service’s own pages and takes no terms for granted', () => {
		expect(creditsPage(`${BASE}/agb/belege`, BASE)).toBe(`${BASE}/agb/belege`);
		expect(creditsPage('/agb/belege', BASE)).toBe(`${BASE}/agb/belege`);
		expect(creditsPage('https://evil.example.com/agb', BASE)).toBeNull();
		expect(creditsPage('javascript:alert(1)', BASE)).toBeNull();
		expect(creditsPage(null, BASE)).toBeNull();
		const none = publishedTerms({ current: null, withdrawal: { version: 'w1', de: 'Text' } }, BASE);
		expect(none.current).toBeNull();
		// Without an English text the German one is shown, not the app's own.
		expect(none.withdrawal).toEqual({ version: 'w1', de: 'Text', en: 'Text' });
		expect(publishedTerms({ withdrawal: { de: 'no version' } }, BASE).withdrawal).toBeNull();
		expect(
			publishedTerms({ current: { version: 2, url: 'https://evil.example.com/x' } }, BASE).current
		).toEqual({ version: '2', url: null, changes: [], effectiveAt: null, publishedAt: null });
	});

	it('knows when the terms are due', () => {
		expect(termsOf(undefined)).toMatchObject({ due: false, announced: false, current: null });
		expect(termsOf({ accepted: null, current: null, pending: null }).due).toBe(false);
		expect(termsOf({ accepted: null, current: '1' }).due).toBe(true);
		expect(termsOf({ accepted: { version: '1' }, current: '1' })).toMatchObject({
			due: false,
			accepted: '1'
		});
		expect(termsOf({ accepted: { version: '1' }, current: { version: '2' } }).due).toBe(true);
		expect(
			termsOf({ accepted: { version: '1' }, current: '1', pending: { version: '2' } })
		).toMatchObject({ due: false, announced: true });
		expect(
			termsOf({ accepted: { version: '2' }, current: '1', pending: { version: '2' } }).announced
		).toBe(false);
	});

	it('asks for exactly the version the service says is due', () => {
		// A new customer: the newest published version, before it takes effect for earlier contracts.
		const fresh = termsOf({
			accepted: null,
			current: '2',
			pending: { version: '3', publishedAt: '2030-01-01T00:00:00Z', effectiveAt: '2030-02-12' },
			due: '3'
		});
		expect(fresh).toMatchObject({ due: true, dueVersion: '3', announced: false });
		// An existing customer of version 2: nothing due, version 3 announced from its effective date.
		const existing = termsOf({
			accepted: { version: '2', accepted_at: '2030-01-01T00:00:00Z' },
			current: '2',
			pending: { version: '3', publishedAt: '2030-01-01T00:00:00Z', effectiveAt: '2030-02-12' },
			due: null
		});
		expect(existing).toMatchObject({
			due: false,
			dueVersion: null,
			announced: true,
			pendingEffectiveAt: '2030-02-12',
			pendingPublishedAt: '2030-01-01T00:00:00Z'
		});
		// The service's null wins over the old computation.
		expect(termsOf({ accepted: { version: '1' }, current: '2', due: null }).due).toBe(false);
		// Agreed early: nothing due, nothing announced.
		expect(
			termsOf({ accepted: { version: '3' }, current: '2', pending: { version: '3' }, due: null })
		).toMatchObject({ due: false, announced: false });
		// While the service does not say (before le-space-credits#115): the version in force.
		expect(termsOf({ accepted: null, current: '2', pending: { version: '3' } })).toMatchObject({
			dueVersion: '2',
			announced: true
		});
	});

	it('withdraws only after a quote, and ends a plan with null', async () => {
		/** @type {{ url: string, method: string, body: any }[]} */
		const seen = [];
		/** @type {typeof fetch} */
		const f = async (url, init) => {
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			seen.push({ url: String(url), method: String(init?.method), body });
			const item = {
				subject: 'credits',
				what: 'topup-10',
				concluded_at: '2030-01-01T00:00:00Z',
				until: '2030-01-15T00:00:00Z'
			};
			if (String(url).endsWith('/v1/package'))
				return new Response(JSON.stringify({ package: { id: 'bridge-s', state: 'ending' } }));
			return new Response(
				JSON.stringify(
					body.quote
						? { quote: true, withdrawable: [item] }
						: { received_at: '2030-01-02T10:00:00Z', withdrawn: [item], refund: { id: 'r1' } }
				)
			);
		};
		const client = await createCreditsClient({ key: KEY, base: BASE, fetch: f });
		expect(await client.withdraw(true)).toEqual({
			quote: true,
			items: [
				{
					subject: 'credits',
					what: 'topup-10',
					concludedAt: '2030-01-01T00:00:00Z',
					until: '2030-01-15T00:00:00Z'
				}
			],
			receivedAt: null,
			refund: false
		});
		const done = await client.withdraw(false);
		expect(done).toMatchObject({ quote: false, receivedAt: '2030-01-02T10:00:00Z', refund: true });
		expect((await client.endPlan()).package?.state).toBe('ending');
		expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
			`POST ${BASE}/v1/withdrawal`,
			`POST ${BASE}/v1/withdrawal`,
			`PUT ${BASE}/v1/package`
		]);
		expect(seen.map((r) => r.body)).toEqual([
			{ product: 'belege', quote: true },
			{ product: 'belege', quote: false },
			{ product: 'belege', package: null }
		]);
		expect(withdrawalOf(null)).toEqual({
			quote: false,
			items: [],
			receivedAt: null,
			refund: false
		});
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

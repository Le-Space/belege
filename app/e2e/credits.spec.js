// Le Space Credits (#593), end to end against a fake service on 127.0.0.1:
// its signed balance, a Checkout, and a payment page of its own that stands
// in for Stripe's embedded Checkout (it books the top-up, as the webhook
// would, and says "paid" by postMessage). Nothing is asked before the person
// switches it on; the balance is the books' Aleph key's, read back signed.
// Every amount and address is made up.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;

/** Who signed `message` (EIP-191), lower case. @param {string} message @param {string} signature */
function signer(message, signature) {
	const body = new TextEncoder().encode(message);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const bytes = Buffer.from(signature.slice(2), 'hex');
	const recovered = new Uint8Array(65);
	recovered[0] = bytes[64] - 27;
	recovered.set(bytes.subarray(0, 64), 1);
	const point = secp256k1.Signature.fromBytes(recovered, 'recovered').recoverPublicKey(
		keccak_256(new Uint8Array([...prefix, ...body]))
	);
	return `0x${Buffer.from(keccak_256(point.toBytes(false).slice(1)).slice(-20)).toString('hex')}`;
}

/** A fake credits service: one balance per address, top-ups booked by its pay page. */
async function startFakeCredits({ mode = 'live' } = {}) {
	/** @type {Map<string, number>} */
	const balances = new Map();
	/** @type {Map<string, { address: string, cents: number }>} */
	const sessions = new Map();
	/** @type {Map<string, { id: string, product: string, package: string, amount_cents: number, credits: number, stripe_invoice_url: string | null, created_at: string }[]>} */
	const purchases = new Map();
	/** @type {string[]} */
	const calls = [];
	const cors = {
		'access-control-allow-origin': APP_ORIGIN,
		'access-control-allow-methods': 'GET, POST, PUT',
		'access-control-allow-headers': 'content-type, x-ls-address, x-ls-timestamp, x-ls-signature'
	};
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			res.writeHead(status, { 'content-type': 'application/json', ...cors });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'OPTIONS') {
			res.writeHead(204, cors);
			return res.end();
		}
		let raw = '';
		for await (const chunk of req) raw += chunk;
		if (url.pathname === '/pay') {
			// The stand-in for Stripe's embedded Checkout: reads the fragment, books, says "paid".
			res.writeHead(200, { 'content-type': 'text/html' });
			return res.end(`<!doctype html><button id="pay">Testzahlung</button><script>
				const f = new URLSearchParams(location.hash.slice(1));
				document.getElementById('pay').onclick = async () => {
					await fetch('/test/pay?cs=' + encodeURIComponent(f.get('cs')), { method: 'POST' });
					parent.postMessage({ type: 'ls-credits:paid' }, f.get('origin'));
				};
			</script>`);
		}
		if (url.pathname === '/test/pay') {
			const s = sessions.get(url.searchParams.get('cs') ?? '');
			if (s) {
				balances.set(s.address, (balances.get(s.address) ?? 0) + s.cents);
				const list = purchases.get(s.address) ?? [];
				list.unshift({
					id: `p${list.length + 1}`,
					product: 'belege',
					package: `topup-${s.cents / 100}`,
					amount_cents: s.cents,
					credits: s.cents,
					stripe_invoice_url: 'https://invoice.stripe.com/i/acct_test/test_made_up',
					created_at: new Date().toISOString()
				});
				purchases.set(s.address, list);
			}
			return send(200, { ok: Boolean(s) });
		}
		const address = String(req.headers['x-ls-address'] ?? '');
		const timestamp = String(req.headers['x-ls-timestamp'] ?? '');
		const line = `ls-credits/v1\n${req.method}\n${url.pathname}\nbelege\n${address}\n${timestamp}`;
		if (signer(line, String(req.headers['x-ls-signature'] ?? '')) !== address.toLowerCase())
			return send(401, { error: 'signature does not match the address', code: 'SIGNATURE' });
		calls.push(`${req.method} ${url.pathname}`);
		if (url.pathname === '/v1/balance')
			return send(200, {
				product: 'belege',
				address,
				credits: balances.get(address) ?? 0,
				reserved: 0,
				lines_this_month: { ki: 0, vm: 0, transfer: 0, refund: 0 },
				package: null,
				refund: null,
				mode
			});
		if (url.pathname === '/v1/purchases')
			return send(200, { purchases: purchases.get(address) ?? [] });
		if (url.pathname === '/v1/checkout') {
			const body = JSON.parse(raw);
			const cs = `cs_test_${sessions.size + 1}`;
			sessions.set(cs, { address, cents: Number(String(body.package).split('-')[1]) * 100 });
			return send(200, { client_secret: cs });
		}
		return send(404, { error: 'not here', code: 'NOT_FOUND' });
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		close: () => new Promise((r) => server.close(() => r(null)))
	};
}

/** @type {Awaited<ReturnType<typeof startFakeCredits>>} */ let credits;

test.beforeAll(async () => {
	credits = await startFakeCredits();
});

test.afterAll(async () => {
	await credits?.close();
});

/**
 * New books pointed at a fake service, on Integrationen → Aleph.
 *
 * @param {import('@playwright/test').Page} page @param {string} url
 */
async function openCreditsCard(page, url) {
	await page.addInitScript((u) => localStorage.setItem('belege.e2e.creditsUrl', u), url);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await openIntegration(page, 'aleph');
	return page.getByTestId('credits-card');
}

test('while the service runs in test mode, the card says so and offers no top-up', async ({
	page
}) => {
	const testing = await startFakeCredits({ mode: 'test' });
	try {
		const card = await openCreditsCard(page, testing.url);
		await card.getByTestId('credits-on').click();
		await expect(card.getByTestId('credits-balance')).toHaveText(/0,00\s€/);
		await expect(card.getByTestId('credits-test-mode')).toContainText('Testbetrieb');
		await expect(card.getByTestId('credits-topup-10')).toHaveCount(0);
		expect(testing.calls).not.toContain('POST /v1/checkout');
	} finally {
		await testing.close();
	}
});

test('a top-up through the service’s own payment page shows as balance', async ({ page }) => {
	const card = await openCreditsCard(page, credits.url);
	await expect(card).toBeVisible();
	// Off until switched on: nothing has been asked of the service.
	expect(credits.calls).toEqual([]);
	await card.getByTestId('credits-on').click();
	await expect(card.getByTestId('credits-balance')).toHaveText(/0,00\s€/);
	const address = await card.getByTestId('credits-address').textContent();
	expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

	await card.getByTestId('credits-topup-25').click();
	// The withdrawal consent comes before the payment page.
	await expect(card.getByTestId('credits-checkout')).toBeDisabled();
	await card.getByTestId('credits-agree').check();
	await card.getByTestId('credits-checkout').click();
	await expect(card.getByTestId('credits-frame')).toHaveAttribute(
		'src',
		new RegExp(`^${credits.url}/pay#cs=cs_test_1&origin=`)
	);
	await page
		.frameLocator('[data-testid="credits-frame"]')
		.getByRole('button', { name: 'Testzahlung' })
		.click();

	await expect(card.getByTestId('credits-frame')).toHaveCount(0);
	await expect(card.getByTestId('credits-balance')).toHaveText(/25,00\s€/);
	await expect(card.getByTestId('credits-note')).toHaveText('Aufgeladen.');
	expect(credits.calls).toContain('POST /v1/checkout');

	// The top-up with its invoice: Stripe's hosted page, opened in a tab of its own.
	const invoice = card.getByTestId('credits-purchases').getByTestId('credits-invoice');
	await expect(invoice).toHaveAttribute(
		'href',
		'https://invoice.stripe.com/i/acct_test/test_made_up'
	);
	await expect(invoice).toHaveAttribute('target', '_blank');
	await expect(invoice).toHaveAttribute('rel', /noopener/);
	await expect(card.getByTestId('credits-purchases')).toContainText('25,00');
});

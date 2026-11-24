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
/** The declaration on withdrawal, as the fake service words it (made up). */
const WITHDRAWAL = {
	version: 'w-test-1',
	de: 'Erklärung des Testdienstes.',
	en: 'The test service’s declaration.'
};

/**
 * @param {{ mode?: string, terms?: string | null, pending?: string | null, plan?: string | null }} [options]
 *   `terms`: the version in force; `pending`: a published, coming version. As
 *   the service since le-space-credits#115, the balance says which version is
 *   `due` – a new customer the newest published one – and a purchase is
 *   refused (412 TERMS) while one is. `plan`: a plan running from the balance.
 */
async function startFakeCredits({ mode = 'live', terms = null, pending = null, plan = null } = {}) {
	/** @type {string | null} */
	let planState = plan ? 'active' : null;
	const periodEnd = '2030-01-31T00:00:00.000Z';
	/** @param {string} address */
	const dueFor = (address) => {
		const accepted = agreed.get(address);
		if (accepted && (accepted === terms || accepted === pending)) return null;
		return pending ?? terms;
	};
	/** @type {Map<string, string>} the version each address agreed to */
	const agreed = new Map();
	/** @type {any[]} the bodies of the Checkouts */
	const checkouts = [];
	/** @type {Map<string, number>} */
	const balances = new Map();
	/** @type {Map<string, { address: string, cents: number }>} */
	const sessions = new Map();
	/** @type {Map<string, { id: string, product: string, package: string, amount_cents: number, credits: number, stripe_invoice_url: string | null, created_at: string }[]>} */
	const purchases = new Map();
	/** @type {string[]} */
	const calls = [];
	/** @type {any[]} the bodies of the withdrawals (not the quotes) */
	const withdrawals = [];
	/** @type {any[]} the bodies of PUT /v1/package */
	const packages = [];
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
				package: plan
					? {
							id: plan,
							state: planState,
							billing: 'credits',
							period_start: '2030-01-01T00:00:00.000Z',
							period_end: periodEnd,
							hours_left: 60
						}
					: null,
				refund: null,
				mode,
				terms: {
					accepted: agreed.has(address) ? { version: agreed.get(address) } : null,
					current: terms,
					pending: pending
						? {
								version: pending,
								publishedAt: '2030-01-01T00:00:00.000Z',
								effectiveAt: '2030-02-12T00:00:00.000Z'
							}
						: null,
					due: dueFor(address)
				}
			});
		if (url.pathname === '/v1/terms')
			return send(200, {
				current: terms
					? { version: terms, url: `http://127.0.0.1:${port}/agb/belege`, changes: [] }
					: null,
				pending: pending
					? {
							version: pending,
							url: `http://127.0.0.1:${port}/agb/belege/${pending}`,
							changes: ['Eine erfundene Änderung.'],
							publishedAt: '2030-01-01T00:00:00.000Z',
							effectiveAt: '2030-02-12T00:00:00.000Z'
						}
					: null,
				withdrawal: WITHDRAWAL
			});
		if (url.pathname === '/v1/terms/accept') {
			agreed.set(address, String(JSON.parse(raw).version));
			return send(200, { accepted: { version: agreed.get(address) } });
		}
		if (url.pathname === '/v1/purchases')
			return send(200, { purchases: purchases.get(address) ?? [] });
		if (url.pathname === '/v1/checkout') {
			const body = JSON.parse(raw);
			if (dueFor(address))
				return send(412, { error: 'the terms are not agreed to', code: 'TERMS' });
			if (body.waiver !== WITHDRAWAL.version)
				return send(412, { error: 'the declaration is missing', code: 'WAIVER' });
			checkouts.push(body);
			const cs = `cs_test_${sessions.size + 1}`;
			sessions.set(cs, { address, cents: Number(String(body.package).split('-')[1]) * 100 });
			return send(200, { client_secret: cs });
		}
		if (url.pathname === '/v1/withdrawal') {
			const body = JSON.parse(raw);
			const items = (purchases.get(address) ?? []).map((p) => ({
				subject: 'credits',
				what: p.package,
				concluded_at: p.created_at,
				until: new Date(Date.parse(p.created_at) + 14 * 86400_000).toISOString()
			}));
			if (body.quote === true) return send(200, { quote: true, withdrawable: items });
			if (!items.length)
				return send(409, {
					error: 'nothing can be withdrawn any more',
					code: 'NOTHING_TO_WITHDRAW'
				});
			withdrawals.push(body);
			purchases.set(address, []);
			return send(200, {
				received_at: new Date().toISOString(),
				withdrawn: items,
				refund: { id: 'r1', state: 'requested' }
			});
		}
		if (url.pathname === '/v1/package' && req.method === 'PUT') {
			const body = JSON.parse(raw);
			packages.push(body);
			if (body.package === null && planState) planState = 'ending';
			return send(200, {
				package: plan
					? { id: plan, state: planState, billing: 'credits', period_end: periodEnd }
					: null
			});
		}
		return send(404, { error: 'not here', code: 'NOT_FOUND' });
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		checkouts,
		withdrawals,
		packages,
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

	// The button that leads to the payment names the obligation to pay (§ 312j BGB).
	await expect(card.getByTestId('credits-topup-25')).toHaveText(
		/25,00\s€ kostenpflichtig aufladen/
	);
	await card.getByTestId('credits-topup-25').click();
	// No terms are published: none are asked for. The declaration on withdrawal
	// comes before the payment page, unticked, in the service's own words.
	await expect(card.getByTestId('credits-terms')).toHaveCount(0);
	await expect(card.getByTestId('credits-withdrawal')).toHaveText(WITHDRAWAL.de);
	await expect(card.getByTestId('credits-agree')).not.toBeChecked();
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
	// The Checkout names the declaration the person ticked.
	expect(credits.checkouts.at(-1)).toMatchObject({
		package: 'topup-25',
		waiver: WITHDRAWAL.version
	});
	for (const [name, path] of [
		['terms', '/agb/belege'],
		['privacy', '/datenschutz'],
		['security', '/security']
	]) {
		await expect(card.getByTestId(`credits-legal-${name}`)).toHaveAttribute(
			'href',
			`https://credits.le-space.de${path}`
		);
	}

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

test('with terms in force, a top-up waits for the agreement', async ({ page }) => {
	const gated = await startFakeCredits({ terms: '1' });
	try {
		const card = await openCreditsCard(page, gated.url);
		await card.getByTestId('credits-on').click();
		await expect(card.getByTestId('credits-balance')).toHaveText(/0,00\s€/);

		const terms = card.getByTestId('credits-terms');
		await expect(terms).toHaveAttribute('data-due', 'true');
		await expect(terms.getByTestId('credits-terms-link')).toHaveAttribute(
			'href',
			`${gated.url}/agb/belege`
		);
		await expect(card.getByTestId('credits-topup-10')).toBeDisabled();
		// Agreeing takes a tick of its own; nothing is ticked beforehand.
		await expect(terms.getByTestId('credits-terms-read')).not.toBeChecked();
		await expect(terms.getByTestId('credits-terms-accept')).toBeDisabled();
		expect(gated.calls).not.toContain('POST /v1/terms/accept');
		await terms.getByTestId('credits-terms-read').check();
		await terms.getByTestId('credits-terms-accept').click();

		await expect(card.getByTestId('credits-terms')).toHaveCount(0);
		await expect(card.getByTestId('credits-terms-accepted')).toContainText('Fassung 1');
		expect(gated.calls).toContain('POST /v1/terms/accept');
		await card.getByTestId('credits-topup-10').click();
		await card.getByTestId('credits-agree').check();
		await card.getByTestId('credits-checkout').click();
		await expect(card.getByTestId('credits-frame')).toBeVisible();
		expect(gated.checkouts).toHaveLength(1);
	} finally {
		await gated.close();
	}
});

test('a new customer is asked for the newest published terms at once', async ({ page }) => {
	const gated = await startFakeCredits({ terms: '2', pending: '3' });
	try {
		const card = await openCreditsCard(page, gated.url);
		await card.getByTestId('credits-on').click();
		const terms = card.getByTestId('credits-terms');
		await expect(terms).toHaveAttribute('data-due', 'true');
		// The service says version 3 is due: that one, not the one in force for earlier contracts.
		await expect(terms.getByTestId('credits-terms-link')).toHaveAttribute(
			'href',
			`${gated.url}/agb/belege/3`
		);
		await expect(terms.getByTestId('credits-terms-published')).toContainText('Fassung 3');
		await expect(terms).toContainText('Eine erfundene Änderung.');
		await terms.getByTestId('credits-terms-read').check();
		await terms.getByTestId('credits-terms-accept').click();
		await expect(card.getByTestId('credits-terms')).toHaveCount(0);
		await expect(card.getByTestId('credits-terms-accepted')).toContainText('Fassung 3');
		await expect(card.getByTestId('credits-topup-10')).toBeEnabled();
	} finally {
		await gated.close();
	}
});

test('“Vertrag widerrufen” says what it concerns, then withdraws and confirms', async ({
	page
}) => {
	const service = await startFakeCredits();
	try {
		const card = await openCreditsCard(page, service.url);
		await card.getByTestId('credits-on').click();
		await expect(card.getByTestId('credits-balance')).toHaveText(/0,00\s€/);

		// Nothing bought yet: nothing to withdraw, and nothing withdrawn by asking.
		await card.getByTestId('credits-withdraw').click();
		await expect(card.getByTestId('credits-withdraw-none')).toBeVisible();
		await expect(card.getByTestId('credits-withdraw-yes')).toHaveCount(0);
		expect(service.withdrawals).toHaveLength(0);

		await card.getByTestId('credits-topup-10').click();
		await card.getByTestId('credits-agree').check();
		await card.getByTestId('credits-checkout').click();
		await page
			.frameLocator('[data-testid="credits-frame"]')
			.getByRole('button', { name: 'Testzahlung' })
			.click();
		await expect(card.getByTestId('credits-balance')).toHaveText(/10,00\s€/);

		await card.getByTestId('credits-withdraw').click();
		const quote = card.getByTestId('credits-withdraw-quote');
		await expect(quote).toContainText('Aufladung 10,00');
		expect(service.withdrawals).toHaveLength(0);
		await quote.getByTestId('credits-withdraw-yes').click();
		const done = card.getByTestId('credits-withdraw-done');
		await expect(done).toContainText('Widerruf eingegangen am');
		await expect(done).toContainText('Aufladung 10,00');
		await expect(done).toContainText('Erstattung');
		await expect(done).toContainText('E-Mail');
		expect(service.withdrawals).toEqual([{ product: 'belege', quote: false }]);
	} finally {
		await service.close();
	}
});

test('“Verträge hier kündigen” names the contract, then cancels it with “Jetzt kündigen”', async ({
	page
}) => {
	const service = await startFakeCredits({ plan: 'bridge-s' });
	try {
		const card = await openCreditsCard(page, service.url);
		await card.getByTestId('credits-on').click();
		await expect(card.getByTestId('credits-package')).toContainText('Ab und zu');

		await card.getByTestId('credits-end').click();
		const confirm = card.getByTestId('credits-end-confirm');
		await expect(confirm.getByTestId('credits-end-contract')).toContainText('bridge-s');
		await expect(confirm.getByTestId('credits-end-contract')).toContainText('31.01.2030');
		expect(service.packages).toHaveLength(0);
		await confirm.getByTestId('credits-end-yes').click();

		const done = card.getByTestId('credits-end-done');
		await expect(done).toContainText('Kündigung eingegangen am');
		await expect(done).toContainText('endet am 31.01.2030');
		await expect(done).toContainText('E-Mail');
		await expect(card.getByTestId('credits-package')).toContainText('endet am 31.01.2030');
		expect(service.packages).toEqual([{ product: 'belege', package: null }]);
	} finally {
		await service.close();
	}
});

test('without a plan, “Verträge hier kündigen” says there is nothing to cancel', async ({
	page
}) => {
	const card = await openCreditsCard(page, credits.url);
	await card.getByTestId('credits-on').click();
	await expect(card.getByTestId('credits-balance')).toBeVisible();
	await card.getByTestId('credits-end').click();
	await expect(card.getByTestId('credits-end-none')).toBeVisible();
	await expect(card.getByTestId('credits-end-yes')).toHaveCount(0);
});

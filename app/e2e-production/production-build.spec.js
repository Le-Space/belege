// What visitors get (#536): the production build has no test hook, and after
// a session with a passkey, a bank statement and a reload, nothing this origin
// keeps – IndexedDB, localStorage, sessionStorage, Cache Storage – holds a key
// or a line of the books in the clear.
//
// The suite in e2e/ asks the E2E build for its keys (`__belegeE2E.secrets()`).
// This build has nobody to ask, so the spec listens where every key passes
// (e2e/secret-spy.js); e2e/passkey-books.spec.js checks that the listener
// hears every key the E2E build names.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addVirtualAuthenticator } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { cachedResponsesHolding, everythingStoredAsText, spellings } from '../e2e/storage-scan.js';
import { PUBLIC_BY_DESIGN, secretsSeen, spyOnSecrets } from '../e2e/secret-spy.js';

// A made-up statement; its merchants are the markers looked for on disk.
const STATEMENT = fileURLToPath(
	new URL('../src/lib/bank/fixtures/camt053-wise.xml', import.meta.url)
);
const MARKERS = ['Example Cloud Shop', 'Musterladen Berlin'];

/** Every global a build for the tests would answer to. */
const testGlobals = (/** @type {import('@playwright/test').Page} */ page) =>
	page.evaluate(() => ({
		hook: typeof (/** @type {any} */ (window).__belegeE2E),
		// The spec's own switch (addVirtualAuthenticator sets it) is not the app's.
		byTheApp: Object.getOwnPropertyNames(window).filter(
			(name) => name.startsWith('__belege') && name !== '__belegeSkipPasskeySteps'
		)
	}));

test('the published pages carry the Content-Security-Policy, with no allowance for tests', () => {
	// The files as they are published (`vite preview` renders the fallback itself).
	for (const file of ['index.html', '200.html']) {
		const html = readFileSync(new URL(`../build/${file}`, import.meta.url), 'utf8');
		const policy = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"/i.exec(
			html
		)?.[1];
		expect(policy, file).toContain("default-src 'none'");
		expect(policy, file).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-[^;]+;/);
		expect(policy, file).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
		// The E2E build lets the stand-in for the payment page be framed; this one does not.
		expect(policy, file).toContain('frame-src https://credits.le-space.de;');
	}
});

test('no test hook, and no key or booking at rest', async ({ page, context }) => {
	await spyOnSecrets(context);
	// This build is the published one, so it asks the bridge where a person's
	// own bridge listens (127.0.0.1:8765). On a developer's machine that is a
	// real bridge: nothing leaves the page's own origin in this spec.
	/** @type {string[]} */
	const refused = [];
	await context.route(
		(url) => url.origin !== new URL(String(test.info().project.use.baseURL)).origin,
		(route) => {
			refused.push(new URL(route.request().url()).origin);
			return route.abort();
		}
	);
	// Device sync on, as a person switches it on, without a relay to dial
	// ("Ohne Relay, per QR"): the sync node and its key are part of the session.
	await context.addInitScript(() => {
		localStorage.setItem('belege.device-sync', 'on');
		if (!localStorage.getItem('belege.network-mode')) {
			localStorage.setItem('belege.network-mode', 'qr');
		}
	});
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Beispiel Studio');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	// The switch that skips the steps between the prompts is set (webauthn.js)
	// and this build does not read it: the step is shown.
	await page.getByTestId('passkey-step-continue').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	expect(await testGlobals(page)).toEqual({ hook: 'undefined', byTheApp: [] });

	// Books with something in them, through the page: a bank statement.
	await page.getByTestId('setup-start-ack').check();
	await page.getByTestId('setup-start-file').click();
	await page.getByTestId('camt-file').setInputFiles(STATEMENT);
	await expect(page.getByTestId('camt-result')).toContainText('Neu: 5');
	await page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await expect(rows.filter({ hasText: MARKERS[0] })).toHaveCount(1);
	// "Testbuchung anlegen" is for development and the E2E build only.
	await expect(page.getByTestId('add-test-transaction')).toHaveCount(0);

	const seen = await secretsSeen(page);

	// A reload drops the keys; the stored passkey opens the same books.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await page.getByTestId('filter-all').click();
	await expect(rows.filter({ hasText: MARKERS[0] })).toHaveCount(1);
	expect(await testGlobals(page)).toEqual({ hook: 'undefined', byTheApp: [] });
	for (const s of await secretsSeen(page)) {
		if (!seen.some((known) => known.hex === s.hex)) seen.push(s);
	}

	// The listener heard the session's keys: without them the scan proves nothing.
	const heard = seen.map((s) => s.what);
	for (const what of [
		'passkey PRF first',
		'deriveBits HKDF belege/books-secret/v1',
		'deriveBits HKDF belege/db-key/v1',
		'deriveBits HKDF belege/replication-key/v1',
		'deriveBits HKDF belege/blob-key/v1',
		// The sync node's key on this device (device sync is on).
		'deriveBits HKDF belege/device-peer/v1'
	]) {
		expect(
			heard.some((h) => h.startsWith(what)),
			what
		).toBe(true);
	}
	const secrets = seen.filter((s) => !PUBLIC_BY_DESIGN.test(s.what));

	const { inventory, text } = await everythingStoredAsText(page);
	console.log('at rest:', JSON.stringify(inventory.map((d) => d.records)));
	// There is something to scan: the sealed blocks of the statement's entries.
	expect(inventory.reduce((sum, d) => sum + d.records, 0)).toBeGreaterThan(20);
	for (const marker of MARKERS) expect(text, marker).not.toContain(marker);
	// Named by what it was, never by its bytes: a failure may be read by anyone.
	const onDisk = secrets
		.filter((s) => spellings(s.hex).some((form) => text.includes(form)))
		.map((s) => s.what);
	expect(onDisk).toEqual([]);

	// The service worker's cache: the app itself, nothing of the session.
	await page.evaluate(() => navigator.serviceWorker?.ready);
	const cached = await cachedResponsesHolding(page, {
		needles: [...MARKERS, ...secrets.flatMap((s) => spellings(s.hex))],
		secrets: secrets.map((s) => s.hex)
	});
	console.log('cached responses:', cached.responses, 'refused:', [...new Set(refused)].join(' '));
	expect(cached.hits).toEqual([]);
});

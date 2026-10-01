// Enable Banking, step 2 (issue #224), end to end: a fake Enable Banking on
// 127.0.0.1 with a bank page that sends the browser back like a real bank,
// the real bridge in test mode holding the made-up application key, and the
// app. Integrationen → Bank → choose a bank → "Bei der Bank freigeben" → the
// bank → back on /integrationen/bank/verbunden, the code out of the address
// before the passkey is asked → unlock → linked → listed → unlinked; before
// that, a bank that says no. Every bank, IBAN and name is made up
// (@belege/bridge/testing/enablebanking).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, enableBankingSecrets, memoryKeychain, saveConfig } from '@belege/bridge';
import {
	FAKE_EB_APP_ID,
	FAKE_EB_PRIVATE_KEY,
	startFakeEnableBanking
} from '@belege/bridge/testing/enablebanking';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const RETURN = `${APP_ORIGIN}/integrationen/bank/verbunden`;

// The app's service worker would answer the routed bank page with the app itself.
test.use({ serviceWorkers: 'block' });

/** @type {Awaited<ReturnType<typeof startFakeEnableBanking>>} */ let eb;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	// The bank's page is said to be on the app's origin and routed to the fake
	// (see `bank` below): Chrome's virtual authenticator does not survive a
	// navigation to another site.
	eb = await startFakeEnableBanking({ redirectUrls: [RETURN], bankUrl: `${APP_ORIGIN}/__bank` });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-eb-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			enablebanking: {
				configured: true,
				appId: FAKE_EB_APP_ID,
				baseUrl: eb.url,
				redirectUrl: RETURN,
				// The Geschäftskonto may leave the bridge, the Tagesgeld stays.
				ibanSuffixes: ['1234']
			}
		},
		configPath
	);
	// The sealed key, as setup:enablebanking leaves it; the key to it for the test mode.
	const fileKey = randomBytes(32).toString('hex');
	await enableBankingSecrets({ configPath, keychain: memoryKeychain(fileKey) }).write({
		privateKey: FAKE_EB_PRIVATE_KEY,
		sessions: {}
	});
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_ENABLEBANKING_KEY: fileKey },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await eb?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

/** @param {import('@playwright/test').Page} page */
async function pairedOnTheBankPage(page) {
	await addVirtualAuthenticator(page);
	// The bank: its answer comes from the fake, a redirect back to the app.
	await page.route(`${APP_ORIGIN}/__bank/**`, async (route) => {
		const at = new URL(route.request().url());
		const res = await fetch(`${eb.url}${at.pathname.replace('/__bank', '')}${at.search}`, {
			redirect: 'manual'
		});
		await route.fulfill({
			status: res.status,
			headers: { location: res.headers.get('location') ?? '' }
		});
	});
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	await openIntegration(page, 'bank');
	return page.getByTestId('enablebanking-card');
}

/**
 * Start a link at the Beispielbank and come back; returns the address the
 * bank sent the browser to, as it arrived.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} card
 */
async function throughTheBank(page, card) {
	await expect(card.getByTestId('enablebanking-bank')).toHaveAttribute('placeholder', /2 Banken/);
	await card.getByTestId('enablebanking-bank').fill('Beispielbank');
	await expect(card.getByTestId('enablebanking-kind')).toHaveValue('business');
	/** @type {string[]} */ const arrived = [];
	page.on('framenavigated', (f) => {
		if (f === page.mainFrame() && f.url().startsWith(RETURN)) arrived.push(f.url());
	});
	await card.getByTestId('enablebanking-start').click();
	// Back from the bank: the books are locked again after the full load.
	await page.waitForURL((u) => u.pathname === '/integrationen/bank/verbunden');
	await page.getByTestId('passkey-unlock').click();
	return arrived;
}

test('a bank that says no links nothing; a bank that says yes is linked, listed and unlinked', async ({
	page
}) => {
	const card = await pairedOnTheBankPage(page);
	await expect(card).toContainText('Über Enable Banking');
	// What goes out, before anything is linked; the technical lines under "Technisch".
	await card.getByTestId('enablebanking-leaves').locator('summary').click();
	await expect(card.getByTestId('enablebanking-leaves')).toContainText(
		'Dein Bank-Passwort sehen weder Belege noch die Bridge'
	);

	// No: the bank refuses, nothing is linked, and the page says so.
	eb.state.deny = true;
	await throughTheBank(page, card);
	eb.state.deny = false;
	await expect(page.getByTestId('enablebanking-return')).toHaveAttribute('data-phase', 'refused');
	await expect(page.getByTestId('enablebanking-refused')).toContainText('keine Freigabe');
	expect(page.url()).toBe(RETURN);
	await page.getByTestId('enablebanking-back').click();
	await expect(
		page.getByTestId('enablebanking-card').getByTestId('enablebanking-link')
	).toHaveCount(0);

	// Yes.
	const arrived = await throughTheBank(page, page.getByTestId('enablebanking-card'));
	const result = page.getByTestId('enablebanking-return');
	await expect(result).toHaveAttribute('data-phase', 'linked');
	await expect(page.getByTestId('enablebanking-linked')).toContainText(
		'Beispielbank ist verbunden: 2 Konten.'
	);
	await expect(page.getByTestId('enablebanking-linked')).toContainText('freigegeben bis');
	await expect(result).toContainText('Geschäftskonto · ····1234 · EUR');
	// The bank sent the code in the address; it left the address before the passkey was asked.
	expect(arrived.some((u) => /[?&]code=/.test(u))).toBe(true);
	expect(page.url()).toBe(RETURN);
	expect(bridgeOut).not.toContain('Beispielbank');
	expect(bridgeOut).toContain('enablebanking: a bank was linked, 2 account(s)');

	await page.getByTestId('enablebanking-back').click();
	const listed = page.getByTestId('enablebanking-card').getByTestId('enablebanking-link');
	await expect(listed).toHaveCount(1);
	await expect(listed.getByTestId('enablebanking-account-label')).toHaveText([
		'Geschäftskonto · ····1234 · EUR',
		'Tagesgeld · ····5678 · EUR'
	]);
	await expect(listed).not.toContainText('DE00');
	const accounts = listed.getByTestId('enablebanking-account');
	await expect(accounts.nth(1)).toHaveAttribute('data-allowed', 'false');
	await expect(accounts.nth(1)).toContainText('Bleibt in der Bridge');
	await expect(accounts.nth(1).getByRole('checkbox')).toBeDisabled();

	// Step 3: fetch the allowed account – three booked, one pending.
	const card2 = page.getByTestId('enablebanking-card');
	await card2.getByTestId('enablebanking-fetch').click();
	await expect(card2.getByTestId('enablebanking-fetched')).toContainText('Neu: 3');
	await expect(card2.getByTestId('enablebanking-fetched')).toContainText('1 vorgemerkte');
	await expect(accounts.first()).toContainText('zuletzt geholt am');
	await expect(page.getByTestId('book-account').filter({ hasText: 'Enable Banking' })).toHaveCount(
		1
	);
	// Fetched again: nothing twice.
	await card2.getByTestId('enablebanking-fetch').click();
	await expect(card2.getByTestId('enablebanking-fetched')).toContainText('Neu: 0');
	await page.getByTestId('tab-zahlungen').click();
	await expect(page.getByText('Wolkenfabrik Hosting GmbH').first()).toBeVisible();
	await expect(page.getByText('Kundin Beispiel AG').first()).toBeVisible();
	expect(bridgeOut).not.toContain('Wolkenfabrik');
	await openIntegration(page, 'bank');

	page.once('dialog', (d) => d.accept());
	await listed.getByTestId('enablebanking-unlink').click();
	await expect(listed).toHaveCount(0);
	expect([...eb.state.sessions.values()].every((s) => !s.open)).toBe(true);

	// Step 5: a bank that grants only a week. "Braucht dich" says so, and "Erneuern" replaces it.
	eb.state.sessionDays = 7;
	await throughTheBank(page, page.getByTestId('enablebanking-card'));
	// The session is made after unlocking: reset only once the page says linked.
	await expect(page.getByTestId('enablebanking-return')).toHaveAttribute('data-phase', 'linked');
	eb.state.sessionDays = null;
	await page.getByTestId('tab-integrationen').click();
	await expect(
		page
			.getByText('die Freigabe bei Beispielbank (Enable Banking) endet am', { exact: false })
			.first()
	).toBeVisible();
	await openIntegration(page, 'bank');
	const short = page.getByTestId('enablebanking-card').getByTestId('enablebanking-link');
	await expect(short).toHaveCount(1);
	await expect(short.getByTestId('enablebanking-valid')).toHaveClass(/text-danger/);
	await short.getByTestId('enablebanking-renew').click();
	await page.waitForURL((u) => u.pathname === '/integrationen/bank/verbunden');
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('enablebanking-return')).toHaveAttribute('data-phase', 'linked');
	await page.getByTestId('enablebanking-back').click();
	const renewed = page.getByTestId('enablebanking-card').getByTestId('enablebanking-link');
	await expect(renewed).toHaveCount(1);
	await expect(renewed.getByTestId('enablebanking-renew')).toHaveCount(0);
	expect(bridgeOut).toContain('enablebanking: 1 older consent(s) replaced');
	await page.getByTestId('tab-integrationen').click();
	await expect(page.getByText('(Enable Banking) endet am', { exact: false })).toHaveCount(0);
});

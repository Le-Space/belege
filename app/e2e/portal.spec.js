// A customer portal end to end: a fake Kundenportal (bridge/test/support/
// fake-portal.js), a fake Hibiscus with one Vodafone booking, a fake LLM, the
// real bridge in test mode (its Chromium runs headless against the fake
// portal and fills the login with the test password), and the app.
//
// Pair → sync → Integrationen → Kundenportale: Anmelden → Rechnungen holen →
// the invoices are receipts of source "Vodafone MeinKabel", read, and the
// one with the booked invoice number is matched → Portal aufzeichnen (started,
// stopped, discarded) → Abmelden.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import {
	CUSTOMER_NUMBER,
	FAKE_PORTAL_PASSWORD,
	FAKE_PORTAL_USER,
	PORTAL_VENDOR,
	sampleInvoices,
	startFakePortal
} from '@belege/bridge/testing/portal';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

// Invoices on the 3rd of the month ten days ago and the two before it; the
// newest is paid five days after its date.
const INVOICES = sampleInvoices({ base: new Date(Date.now() - 10 * 864e5) });
const PAID = INVOICES[0];
const booked = new Date(Date.parse(`${PAID.date}T00:00:00Z`) + 5 * 864e5)
	.toISOString()
	.slice(0, 10);
const oldestMonth = INVOICES[2].date.slice(0, 7);

function bankData() {
	const data = sampleData();
	data.transactions = [
		{
			id: 401,
			konto_id: 1,
			datum: booked,
			valuta: booked,
			betrag: `-${PAID.gross}`,
			empfaenger_name: PORTAL_VENDOR,
			empfaenger_konto: '',
			zweck: `SVWZ+Rechnung ${PAID.number} Kundenkonto 000123`,
			zweck_raw: `SVWZ+Rechnung ${PAID.number} Kundenkonto 000123`,
			art: 'Basislastschrift',
			endtoendid: ''
		}
	];
	return data;
}

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: bankData() });
	llm = await startFakeLlm();
	portal = await startFakePortal({ invoices: INVOICES });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-portal-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			hibiscus: {
				host: hibiscus.host,
				port: hibiscus.port,
				certSha256: hibiscus.fingerprint,
				ibanSuffixes: ['4711']
			},
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true },
			portals: {
				vodafone: { username: FAKE_PORTAL_USER, passwordStored: true, baseUrl: portal.url }
			}
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY,
			BELEGE_BRIDGE_TEST_PORTAL_PASSWORD: FAKE_PORTAL_PASSWORD
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	if (bridge && bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await portal?.close();
	await llm?.close();
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('Vodafone invoices from the portal become receipts and match the booking', async ({
	page
}) => {
	test.setTimeout(180_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
	await expect(page.getByTestId('sync-result')).toHaveText(
		'Neu: 1 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// Kundenportale: never logged in, then logged in by the bridge.
	const vodafone = page.locator('[data-testid="portal"][data-portal="vodafone"]');
	await expect(vodafone).toContainText('Vodafone MeinKabel');
	await expect(vodafone.getByTestId('portal-state')).toHaveAttribute('data-state', 'never');
	await expect(vodafone.getByTestId('portal-fetch')).toHaveCount(0);
	await vodafone.getByTestId('portal-login').click();
	await expect(vodafone.getByTestId('portal-state')).toHaveAttribute('data-state', 'logged-in');
	expect(portal.state.logins).toEqual([{ usernameOk: true, passwordOk: true, remember: true }]);
	const profile = await stat(join(dir, 'portals', 'vodafone', 'profile'));
	expect(profile.mode & 0o777).toBe(0o700);

	// Rechnungen holen, from the oldest month on.
	await vodafone.getByTestId('portal-since').fill(oldestMonth);
	await vodafone.getByTestId('portal-fetch').click();
	await expect(vodafone.getByTestId('portal-result')).toHaveText(
		`3 Rechnungen ab ${oldestMonth} · neu: 3 · schon vorhanden: 0 · doppelt: 0 · ausgelesen: 3`
	);
	expect(portal.state.logins).toHaveLength(1);
	expect(llm.requests).toHaveLength(3);

	// Belege: a source of its own, the paid one matched by its invoice number.
	await tab('Belege').click();
	const source = page.locator('[data-testid="receipt-source"][data-source="portal:vodafone"]');
	await expect(source).toContainText('Vodafone MeinKabel');
	await expect(source.getByTestId('source-count')).toHaveText('3');
	await source.click();
	const receipts = page.getByTestId('receipt');
	await expect(receipts).toHaveCount(3);
	const paid = receipts.filter({ hasText: PAID.gross });
	await expect(paid.getByTestId('receipt-vendor')).toHaveText(PORTAL_VENDOR);
	await expect(paid.getByTestId('receipt-status')).toHaveText('Zugeordnet');
	await paid.click();
	await expect(page.getByTestId('field-source')).toHaveText('Vodafone MeinKabel');
	await expect(page.getByTestId('field-invoice')).toHaveText(PAID.number);
	await expect(page.getByTestId('receipt-linked-tx')).toContainText(PORTAL_VENDOR);

	// Again: nothing new, nothing downloaded twice.
	const downloads = portal.state.downloads;
	await tab('Integrationen').click();
	await vodafone.getByTestId('portal-since').fill(oldestMonth);
	await vodafone.getByTestId('portal-fetch').click();
	await expect(vodafone.getByTestId('portal-result')).toContainText('neu: 0 · schon vorhanden: 3');
	expect(portal.state.downloads).toBe(downloads);

	// Portal aufzeichnen: the window opens (headless here, nobody clicks), the
	// review says nothing was downloaded, so it cannot be saved; discarded.
	await vodafone.getByTestId('portal-record').click();
	await expect(vodafone.getByTestId('portal-recording')).toContainText(
		'Passwörter und Eingaben werden nie aufgezeichnet.'
	);
	await vodafone.getByTestId('portal-record-stop').click();
	const review = vodafone.getByTestId('portal-review');
	await expect(review).toContainText('Kein Klick aufgezeichnet.');
	await expect(review.getByTestId('portal-review-no-download')).toBeVisible();
	await expect(review.getByTestId('portal-record-save')).toBeDisabled();
	await review.getByTestId('portal-review-discard').click();
	await expect(vodafone.getByTestId('portal-review')).toHaveCount(0);
	await expect(vodafone.getByTestId('portal-recipe-export')).toHaveCount(0);

	// Abmelden: the session ends, the profile is gone.
	await vodafone.getByTestId('portal-logout').click();
	await expect(vodafone.getByTestId('portal-state')).toHaveAttribute('data-state', 'never');
	await expect(stat(join(dir, 'portals', 'vodafone'))).rejects.toThrow();

	// Nothing of the portal's pages and no password in the bridge's output.
	expect(bridgeOut).not.toContain(FAKE_PORTAL_PASSWORD);
	expect(bridgeOut).not.toContain(CUSTOMER_NUMBER);
});

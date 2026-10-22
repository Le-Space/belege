// Paperless-ngx as a receipt source end to end (#318): a fake Paperless
// (bridge/test/support/fake-paperless.js), a fake LLM, the real bridge in test
// mode, and the app.
//
// Pair → Belege: the Paperless card fetches on its own → three receipts of
// source "Paperless" (the spreadsheet is no receipt file), read right away –
// the photographed till receipt with Paperless' OCR text → the mail card is
// off while Paperless fetches the mail → a second fetch finds nothing new →
// "Belege ruft das Postfach trotzdem selbst ab" brings it back, with the tags
// to leave out. All documents made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { FAKE_PAPERLESS_TOKEN, startFakePaperless } from '@belege/bridge/testing/paperless';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {Awaited<ReturnType<typeof startFakePaperless>>} */ let paperless;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	llm = await startFakeLlm();
	paperless = await startFakePaperless();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-paperless-'));
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
			paperless: { configured: true, baseUrl: paperless.url }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY,
			BELEGE_BRIDGE_TEST_PAPERLESS_TOKEN: FAKE_PAPERLESS_TOKEN
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
	await paperless?.close();
	await llm?.close();
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('documents from Paperless become receipts, scans read with its OCR text', async ({ page }) => {
	test.setTimeout(180_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Paperless');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	await expect(page.getByTestId('integration-paperless')).toBeVisible();

	// Opening Belege fetches on its own: four documents, the spreadsheet is no receipt file.
	await tab('Belege').click();
	const card = page.getByTestId('paperless-card');
	await expect(card.getByTestId('paperless-result')).toHaveText(
		'4 Dokumente · neu: 3 · schon vorhanden: 0 · doppelt: 0 · ausgelassen: 0 · keine Belegdatei: 1',
		{ timeout: 30_000 }
	);
	const paperlessSource = page.locator('[data-testid="receipt-source"][data-source="paperless"]');
	await expect(paperlessSource.getByTestId('source-count')).toHaveText('3');
	// Paperless fetches the mail; Belege does not read the mailbox as well.
	await expect(page.getByTestId('mail-by-paperless')).toBeVisible();
	await expect(page.getByTestId('mail-fetch')).toHaveCount(0);
	await expect(page.locator('[data-testid="receipt-source"][data-source="mail"]')).toHaveCount(0);

	// Read right away: the photo of the till receipt went with Paperless' OCR text.
	await expect
		.poll(() => llm.requests.some((r) => JSON.stringify(r.body).includes('SUMME EUR 4,99')))
		.toBe(true);
	expect(paperless.authHeaders.every((h) => h === `Token ${FAKE_PAPERLESS_TOKEN}`)).toBe(true);
	expect(bridgeOut).not.toContain(FAKE_PAPERLESS_TOKEN);

	// A second fetch asks only for what came after the newest.
	await card.getByTestId('paperless-fetch').click();
	await expect(card.getByTestId('paperless-result')).toHaveText(
		'0 Dokumente · neu: 0 · schon vorhanden: 0 · doppelt: 0 · ausgelassen: 0 · keine Belegdatei: 0'
	);
	expect(paperless.seen.some((p) => p.startsWith('/api/documents/?') && /added__gt=/.test(p))).toBe(
		true
	);

	// Both, by choice: the mail card is back, with the tags to leave out.
	await card.getByTestId('paperless-mail-too').check();
	await expect(page.getByTestId('mail-fetch')).toBeVisible();
	await card.getByTestId('paperless-skip-tags').fill('aus-Mail');
	await card.getByTestId('paperless-skip-tags').blur();
	// Kept in the books: there again after leaving the page.
	await tab('Home').click();
	await tab('Belege').click();
	await expect(page.getByTestId('paperless-card').getByTestId('paperless-skip-tags')).toHaveValue(
		'aus-Mail'
	);

	// "Beleg finden" on a payment asks Paperless' own search and links the hit.
	await page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.addTransaction({
			bookedOn: '2026-09-10',
			counterparty: 'Musterbaumarkt',
			purpose: 'Kartenzahlung',
			amountCents: -499
		})
	);
	await tab('Zahlungen').click();
	await page.getByTestId('transaction').filter({ hasText: 'Musterbaumarkt' }).click();
	const detail = page.getByTestId('tx-detail');
	await detail.getByTestId('tx-find-tab-paperless').click();
	await detail.getByTestId('tx-find-query').fill('Schrauben');
	await detail.getByTestId('tx-paperless-search').click();
	const hit = detail.getByTestId('tx-paperless-hit');
	await expect(hit).toHaveCount(1);
	await expect(hit).toContainText('Kassenbon Baumarkt');
	// Fetched before: the hit says so, and taking it links that receipt, no copy.
	await expect(hit).toContainText('schon in den Belegen');
	const before = paperless.seen.filter((p) => p.includes('query=')).length;
	expect(before).toBeGreaterThan(0);
	await hit.getByTestId('tx-paperless-take').click();
	await expect(detail.getByTestId('tx-upload-result')).toContainText('Zugeordnet');
	await expect(detail.getByTestId('tx-linked-state')).toContainText('bestätigt');
	// The words searched for never reach the bridge's log.
	expect(bridgeOut).not.toContain('Schrauben');
});

// "Beleg hochladen und dieser Zahlung zuordnen" end to end: a fake LLM, the
// real bridge in test mode, the app. Two synthetic bookings: one whose
// purpose names the vendor's portal and whose invoice fits, one whose upload
// does not fit (another amount, another invoice number) – linked anyway,
// because the person said so, with the contradictions named. Then the
// Verlauf, and nothing readable at rest.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const KABEL = {
	vendor: 'Kabelnetz Beispiel GmbH',
	invoice: 'KB-2026-0901',
	marker: 'MARKER-KABEL-7C1E',
	portal: 'www.kabelnetz-beispiel.de/meinkabel'
};
const LADEN = {
	vendor: 'Anderer Laden Beispiel',
	invoice: 'AL-555555',
	marker: 'MARKER-LADEN-2D4F'
};

const kabelPdf = makePdf([
	`Anbieter: ${KABEL.vendor}`,
	`Rechnungsnummer: ${KABEL.invoice}`,
	'Rechnungsdatum: 2026-08-28',
	'Netto: 33,61 EUR',
	'USt 19%: 6,38 EUR',
	'Brutto: 39,99 EUR',
	`Kennung: ${KABEL.marker}`
]);
const ladenPdf = makePdf([
	`Anbieter: ${LADEN.vendor}`,
	`Rechnungsnummer: ${LADEN.invoice}`,
	'Rechnungsdatum: 2026-08-30',
	'Brutto: 15,00 EUR',
	`Kennung: ${LADEN.marker}`
]);

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-upload-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY },
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
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('upload a receipt onto one booking: portal link, points, contradictions, Verlauf', async ({
	page
}) => {
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

	await page.evaluate(
		async ({ kabel, laden }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: '2026-09-01',
				counterparty: kabel.vendor,
				purpose: `Kd 4711 Rechnung ${kabel.invoice} Ihre Rechnung unter ${kabel.portal}`,
				amountCents: -3999,
				currency: 'EUR'
			});
			await e2e.addTransaction({
				bookedOn: '2026-09-02',
				counterparty: laden.vendor,
				purpose: 'Kartenzahlung',
				amountCents: -1250,
				currency: 'EUR'
			});
		},
		{ kabel: KABEL, laden: LADEN }
	);

	await tab('Zahlungen').click();
	const row = (/** @type {string} */ text) =>
		page.getByTestId('transaction').filter({ hasText: text });
	await expect(row(KABEL.vendor)).toHaveCount(1);
	await row(KABEL.vendor).click();
	const detail = page.getByTestId('tx-detail');

	// The portal from the purpose: its host shown, https, a new tab without referrer.
	await expect(detail.getByTestId('tx-portal-host')).toHaveText('www.kabelnetz-beispiel.de');
	const portal = detail.getByTestId('tx-portal-link');
	await expect(portal).toHaveAttribute('href', `https://${KABEL.portal}`);
	await expect(portal).toHaveAttribute('target', '_blank');
	await expect(portal).toHaveAttribute('rel', 'noopener noreferrer');

	// Upload onto this booking: stored, read, linked – as the person's decision.
	await detail
		.getByTestId('tx-upload-input')
		.setInputFiles({ name: 'Rechnung-Kabel.pdf', mimeType: 'application/pdf', buffer: kabelPdf });
	await expect(detail.getByTestId('tx-upload-result')).toContainText(`Zugeordnet: ${KABEL.vendor}`);
	await expect(detail.getByTestId('tx-upload-result')).toContainText(
		`Rechnungsnummer ${KABEL.invoice} im Verwendungszweck`
	);
	await expect(detail.getByTestId('tx-upload-result')).toContainText(
		'120 Punkte, von dir zugeordnet'
	);
	await expect(detail.getByTestId('tx-upload-warning')).toHaveCount(0);
	await expect(detail.getByTestId('tx-linked-vendor')).toHaveText(KABEL.vendor);
	await expect(detail.getByTestId('tx-linked-state')).toContainText('bestätigt');
	await expect(detail.getByTestId('tx-why-line')).toContainText('von dir zugeordnet');
	expect(llm.requests.length).toBe(1);
	await detail.getByTestId('tx-detail-close').click();

	// A receipt that does not fit: linked anyway, with the contradictions named.
	await row(LADEN.vendor).click();
	await expect(detail.getByTestId('tx-portal')).toHaveCount(0);
	await detail
		.getByTestId('tx-upload-input')
		.setInputFiles({ name: 'Beleg-Laden.pdf', mimeType: 'application/pdf', buffer: ladenPdf });
	await expect(detail.getByTestId('tx-upload-result')).toContainText(`Zugeordnet: ${LADEN.vendor}`);
	const warnings = detail.getByTestId('tx-upload-warning');
	await expect(warnings).toHaveCount(2);
	await expect(warnings.first()).toContainText('15,00');
	await expect(warnings.first()).toContainText('-12,50');
	await expect(warnings.nth(1)).toContainText(LADEN.invoice);
	await expect(detail.getByTestId('tx-linked-state')).toContainText('bestätigt');
	await page.screenshot({ path: test.info().outputPath('upload-to-booking.png') });
	await detail.getByTestId('tx-detail-close').click();
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (0)');

	// Both are receipts like any upload.
	await tab('Belege').click();
	await expect(page.getByTestId('receipt')).toHaveCount(2);
	await expect(
		page.locator(
			'[data-testid="receipt-source"][data-source="upload"] [data-testid="source-count"]'
		)
	).toHaveText('2');

	// Verlauf: two decisions of this kind.
	await page.getByTestId('footer-verlauf').click();
	await page.locator('[data-testid="verlauf-filter"][data-group="entscheidungen"]').click();
	await expect(
		page
			.getByTestId('verlauf-event')
			.filter({ hasText: 'Beleg hochgeladen und dieser Zahlung zugeordnet' })
	).toHaveCount(2);

	const { text } = await everythingStoredAsText(page);
	for (const secret of [
		KABEL.vendor,
		KABEL.marker,
		KABEL.invoice,
		KABEL.portal,
		LADEN.vendor,
		LADEN.marker,
		'upload-link',
		'Rechnung-Kabel.pdf'
	]) {
		expect(text.includes(secret), `${secret} readable at rest`).toBe(false);
	}
});

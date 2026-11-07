// "Kurse holen" on a trip (#693): every receipt in another currency still
// without euros gets its day's rate from the bridge in one go, shown with its
// euros, and kept only on "Übernehmen". The bridge runs in test mode with
// fixed rates that stand for the ECB and the National Bank of Kazakhstan;
// every vendor, amount and rate is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
// EUR per unit, with the source and the day the rate is valid from.
const RATES = {
	CZK: { rate: '0.04', source: 'ecb', at: '2026-05-04T00:00:00Z' },
	KZT: { rate: '0.002', source: 'nbk', at: '2026-05-05T00:00:00Z' }
};

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-travel-rates-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify(RATES) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a trip’s receipts in other currencies get their rates in one go, kept on a click (#693)', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await pairBridge(page, { code, out: () => bridgeOut });

	// A bus ticket in CZK and a hotel in KZT, read as travel.
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		/** @param {string} vendor @param {string} currency @param {number} cents @param {string} day @param {Record<string, any>} travel */
		const add = (vendor, currency, cents, day, travel) =>
			e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: `${vendor}.pdf`,
				vendor,
				currency,
				amountCents: cents,
				documentDate: day,
				extraction: { document_type: 'invoice', gross: cents / 100, currency, vat: [], travel }
			});
		await add('Bus Beispiel', 'CZK', 50_000, '2026-05-04', {
			kind: 'bus',
			from: 'A-Stadt',
			to: 'Ortshausen',
			departure: '2026-05-04T08:00',
			arrival: '2026-05-04T13:00'
		});
		await add('Hotel Beispiel', 'KZT', 2_500_000, '2026-05-05', {
			kind: 'hotel',
			place: 'Ortshausen',
			check_in: '2026-05-04',
			check_out: '2026-05-05',
			nights: 1
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('05');
	await page.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-receipt')).toHaveCount(2);
	await expect(page.getByTestId('reise-sum-norate')).toBeVisible();

	await expect(page.getByTestId('reise-rates')).toContainText('ohne Kurs: 2');
	await page.getByTestId('reise-rates-fetch').click();
	const offers = page.getByTestId('reise-rate-offer');
	await expect(offers).toHaveCount(2);
	// 500,00 CZK at 0.04 = 20,00 EUR; 25.000 KZT at 0.002 = 50,00 EUR.
	await expect(offers.filter({ hasText: 'Bus Beispiel' })).toContainText('20,00');
	await expect(offers.filter({ hasText: 'Bus Beispiel' })).toContainText('EZB-Kurs');
	await expect(offers.filter({ hasText: 'Hotel Beispiel' })).toContainText('50,00');
	await expect(offers.filter({ hasText: 'Hotel Beispiel' })).toContainText(
		'Nationalbank Kasachstans'
	);
	// Nothing is kept before the click.
	await expect(page.getByTestId('reise-sum-norate')).toBeVisible();

	await page.getByTestId('reise-rates-take').click();
	await expect(page.getByTestId('reise-rates')).toHaveCount(0);
	await expect(page.getByTestId('reise-sum-norate')).toHaveCount(0);
	const rows = page.getByTestId('reise-receipt');
	await expect(rows.filter({ hasText: 'Bus Beispiel' })).toContainText('20,00');
	await expect(rows.filter({ hasText: 'Hotel Beispiel' })).toContainText('50,00');
});

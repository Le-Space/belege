// Outlays in another currency with a reference rate from the bridge (#293,
// step 5): a ruble receipt takes the Bank of Russia's rate – the ECB has
// none since 2022 –, a lira receipt the ECB's. The bridge runs in test mode
// with fixed rates that stand for those sources; every vendor, amount and
// rate is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
// EUR per unit, with the source and the day the rate is valid from.
const RATES = {
	RUB: { rate: '0.0105', source: 'cbr', at: '2025-03-01T00:00:00Z' },
	TRY: { rate: '0.026', source: 'ecb', at: '2025-03-04T00:00:00Z' }
};

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-outlay-rates-'));
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

test('a ruble outlay at the Bank of Russia rate, a lira outlay at the ECB rate', async ({
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
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const common = { source: 'upload', status: 'ausgelesen' };
		await e2e.addReceipt({
			...common,
			fileName: 'coworking.pdf',
			vendor: 'Coworking Beispiel',
			amountCents: 1_699_000,
			currency: 'RUB',
			documentDate: '2025-03-03'
		});
		await e2e.addReceipt({
			...common,
			fileName: 'flug.pdf',
			vendor: 'Flug Beispiel',
			amountCents: 250_000,
			currency: 'TRY',
			documentDate: '2025-03-04'
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const receipt = (/** @type {string} */ name) =>
		page.getByTestId('receipt').filter({ hasText: name });
	const detail = page.getByTestId('receipt-detail');

	// Rubles: the Bank of Russia's rate, valid from the Saturday before.
	await receipt('Coworking Beispiel').click();
	await detail.getByTestId('outlay-open').click();
	await expect(detail.getByTestId('outlay-rate-ecb')).toContainText(
		'Referenzkurs der Bank of Russia vom 01.03.2025'
	);
	// Shown as rubles per euro (#312); booked at the bank's full rate.
	await expect(detail.getByTestId('outlay-rate')).toHaveValue('95,2381');
	await expect(detail.getByTestId('outlay-euros')).toContainText('178,40');
	await detail.getByTestId('outlay-book').click();
	await expect(detail.getByTestId('outlay-booked-rate')).toContainText(
		'16990.00 RUB zu 95,2381 RUB je 1 EUR (Kurs der Bank of Russia)'
	);

	// Lira: the ECB's.
	await receipt('Flug Beispiel').click();
	await detail.getByTestId('outlay-open').click();
	await expect(detail.getByTestId('outlay-rate-ecb')).toContainText(
		'EZB-Referenzkurs vom 04.03.2025'
	);
	await expect(detail.getByTestId('outlay-euros')).toContainText('65,00');
	await detail.getByTestId('outlay-book').click();
	await expect(detail.getByTestId('outlay-booked-rate')).toContainText(
		'2500.00 TRY zu 38,4615 TRY je 1 EUR (EZB-Kurs)'
	);
});

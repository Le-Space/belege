// A receipt in another currency paid from a euro account links by itself
// (#474): a GBP invoice by the original amount the bank names on the card
// payment, a USD invoice by the ECB rate of the booking day (here fixed:
// 0,92 EUR per USD), which the app asks the bridge for only because the
// booking lies in the invoice's date window – and keeps only because, at
// it, the amount comes near. Real bridge in test mode, fixed rates; every
// name, number and amount is made up.
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

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-match-fx-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ USD: { rate: '0.92', source: 'ecb' } })
		},
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

test('invoices in dollars and pounds link to their euro card payments by themselves', async ({
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
		const receipt = (/** @type {Record<string, any>} */ x) => ({
			source: 'upload',
			status: 'ausgelesen',
			fileName: `${x.invoice_number}.pdf`,
			vendor: x.vendor,
			invoiceNumber: x.invoice_number,
			amountCents: Math.round(x.gross * 100),
			currency: x.currency,
			documentDate: x.invoice_date,
			extraction: { document_type: 'invoice', ...x }
		});
		const card = (/** @type {Record<string, any>} */ t) => ({
			accountId: 'ACC-E2E',
			source: 'hibiscus',
			currency: 'EUR',
			bookingType: 'Kartenzahlung',
			endToEndId: '',
			counterpartyIban: '',
			...t
		});
		await e2e.addReceipt(
			receipt({
				vendor: 'Example Cloud Ltd',
				invoice_number: 'INV-99812',
				invoice_date: '2026-03-02',
				currency: 'USD',
				gross: 87
			})
		);
		await e2e.addReceipt(
			receipt({
				vendor: 'Beispiel Books Ltd',
				invoice_number: 'BB-20260',
				invoice_date: '2026-03-10',
				currency: 'GBP',
				gross: 50
			})
		);
		// 80,32 € at 0,92: 87,30 USD, 0,3 % off – a card fee.
		await e2e.addTransaction(
			card({
				bookedOn: '2026-03-04',
				amountCents: -8_032,
				counterparty: 'EXAMPLE CLOUD LTD',
				purpose: 'INV-99812 Example Cloud'
			})
		);
		await e2e.addTransaction(
			card({
				bookedOn: '2026-03-11',
				amountCents: -5_910,
				counterparty: 'BEISPIEL BOOKS',
				purpose: 'BB-20260',
				original: { amount: '50.00', currency: 'GBP', rate: '1.182' }
			})
		);
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	await page.getByTestId('filter-all').click();
	await page.locator('[data-testid="transaction-month"][data-month="2026-03"]').click();
	const detail = page.getByTestId('tx-detail');

	// The pound invoice: by the bank's original amount.
	await page.getByTestId('transaction').filter({ hasText: 'BEISPIEL BOOKS' }).click();
	await expect(detail.getByTestId('tx-why-line')).toContainText(
		/Betrag gleich \(50,00\sGBP laut Bank\).*automatisch zugeordnet/,
		{ timeout: 30_000 }
	);
	await detail.getByTestId('tx-detail-close').click();

	// The dollar invoice: the rate came from the bridge, then matching ran again.
	await page.getByTestId('transaction').filter({ hasText: 'EXAMPLE CLOUD' }).click();
	await expect(detail.getByTestId('tx-why-line')).toContainText(
		/Betrag umgerechnet: 80,32\sEUR sind 87,30\sUSD zum EZB-Kurs vom 04\.03\.2026 \(1 USD = 0,92 EUR\), 0,3 % neben 87,00\sUSD.*automatisch zugeordnet/,
		{ timeout: 30_000 }
	);
});

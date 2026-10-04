// A USD invoice paid in three Monero instalments (follow-up to #258): each
// payment is booked in euros at the day's XMR rate; the ECB rate of its day
// (here fixed: 0,75 EUR per USD) is kept on it once it is linked, so every
// instalment counts in dollars – the invoice is offered for the next one and
// says what is open, in dollars, until it is paid. Real bridge in test mode,
// fixed rates; every hash, address, amount and name is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const ADDRESS = `4${'B'.repeat(94)}`;
const h = (/** @type {string} */ c) => c.repeat(64);
const epoch = (/** @type {string} */ iso) => Math.round(Date.parse(iso) / 1000);

// Three payments of 2 XMR: 300,00 € each at 150 €/XMR, 400,00 USD at 0,75 €/USD.
const EXPORT = [
	'blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description',
	`3300000,${epoch('2025-03-03T10:00:00Z')},2025-03-03 10:00,in,2,2000000000000,0.00003,${h('a')},"",0,,"Rate 1"`,
	`3310000,${epoch('2025-04-03T10:00:00Z')},2025-04-03 10:00,in,2,2000000000000,0.00003,${h('b')},"",0,,"Rate 2"`,
	`3320000,${epoch('2025-05-05T10:00:00Z')},2025-05-05 10:00,in,2,2000000000000,0.00003,${h('c')},"",0,,"Rate 3"`
].join('\n');

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-instalments-fx-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ XMR: '150', USD: '0.75' })
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

test('a USD invoice paid in three Monero instalments counts in dollars', async ({ page }) => {
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

	await openIntegration(page, 'wallets');
	const card = page.getByTestId('wallets-card');
	await card.getByTestId('wallet-chain').selectOption('monero');
	await card.getByTestId('wallet-address-input').fill(ADDRESS);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: ADDRESS.slice(-6) });
	await wallet
		.getByTestId('wallet-import-file')
		.setInputFiles({ name: 'monero.csv', mimeType: 'text/csv', buffer: Buffer.from(EXPORT) });
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 3 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// The invoice, in dollars.
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addReceipt({
			source: 'upload',
			status: 'ausgelesen',
			fileName: 'darlehen-usd.pdf',
			vendor: 'Beispiel Holding LLC',
			invoiceNumber: 'BH-2025-03',
			amountCents: 120_000,
			currency: 'USD',
			documentDate: '2025-03-01'
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	await page.getByTestId('filter-all').click();
	const detail = page.getByTestId('tx-detail');
	/** @param {string} month @param {string} memo */
	const open = async (month, memo) => {
		await page.locator(`[data-testid="transaction-month"][data-month="${month}"]`).click();
		await page.getByTestId('transaction').filter({ hasText: memo }).click();
		await detail.getByTestId('tx-find-tab-alle').click();
	};
	const invoice = () => detail.getByTestId('tx-choice').filter({ hasText: 'Beispiel Holding LLC' });

	// The first: linked; 800,00 USD open.
	await open('2025-03', 'Rate 1');
	await invoice().getByTestId('tx-choose').click();
	await expect(detail.getByTestId('tx-instalment')).toHaveText(
		/Teilzahlung 1 von 1 · BH-2025-03 ·\s+800,00\sUSD offen/
	);
	await detail.getByTestId('tx-detail-close').click();

	// The second: offered as one more instalment.
	await open('2025-04', 'Rate 2');
	await expect(invoice().getByTestId('tx-choice-instalment')).toContainText(
		'teilweise bezahlt (1×) · 800,00'
	);
	await invoice().getByTestId('tx-choose').click();
	await expect(detail.getByTestId('tx-instalment')).toHaveText(
		/Teilzahlung 2 von 2 · BH-2025-03 ·\s+400,00\sUSD offen/
	);
	await detail.getByTestId('tx-detail-close').click();

	// The third settles it.
	await open('2025-05', 'Rate 3');
	await invoice().getByTestId('tx-choose').click();
	await expect(detail.getByTestId('tx-instalment')).toHaveText(
		/Teilzahlung 3 von 3 · BH-2025-03 ·\s+bezahlt/
	);
	await detail.getByTestId('tx-detail-close').click();

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await expect(page.getByTestId('receipt-instalments')).toHaveText('in 3 Raten bezahlt');
});

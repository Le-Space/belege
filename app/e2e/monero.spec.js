// Monero from the wallet's own export, end to end: the real bridge in test mode
// with a fixed XMR rate, and the app. A Monero wallet is added by its address,
// "Verlauf importieren (CSV)" reads a made-up Monero GUI export in the
// browser – an incoming payment, one from private holdings, an outgoing one
// with its fee, and an unconfirmed one left out – and the bookings are in
// euros at the day's rate. Importing the same file again adds nothing. Every
// hash, address, amount and note is made up.
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
const ADDRESS = `4${'A'.repeat(94)}`;
const h = (/** @type {string} */ c) => c.repeat(64);
const epoch = (/** @type {string} */ iso) => Math.round(Date.parse(iso) / 1000);

const EXPORT = [
	'blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description',
	`3300000,${epoch('2025-03-01T10:00:00Z')},2025-03-01 10:00,in,2.5,2500000000000,0.00003,${h('a')},"Primary account",0,,"Einlage aus Privatbesitz"`,
	`3310000,${epoch('2025-04-15T12:30:00Z')},2025-04-15 12:30,in,1.2,1200000000000,0.00002,${h('b')},"",0,,"Rechnung 2025-021"`,
	`3320000,${epoch('2025-05-02T08:00:00Z')},2025-05-02 08:00,out,0.7,700000000000,0.000061,${h('c')},"",0,,""`,
	`0,${epoch('2025-05-03T08:00:00Z')},2025-05-03 08:00,out,0.1,100000000000,0.00005,${h('d')},"",0,,""`
].join('\n');

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-monero-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ XMR: '150' }) },
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

test('a Monero wallet from its export: bookings in euros, the fee apart, nothing twice', async ({
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

	await openIntegration(page, 'wallets');
	const card = page.getByTestId('wallets-card');
	await card.getByTestId('wallet-chain').selectOption('monero');
	await expect(card).toContainText('den Verlauf, den deine Wallet exportiert');
	await card.getByTestId('wallet-address-input').fill(ADDRESS);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: ADDRESS.slice(-6) });
	// No sync by address for Monero: the import instead.
	await expect(wallet.getByTestId('wallet-sync')).toHaveCount(0);
	const file = { name: 'monero.csv', mimeType: 'text/csv', buffer: Buffer.from(EXPORT) };
	await wallet.getByTestId('wallet-import-file').setInputFiles(file);
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 4 · Aktualisiert: 0 · Übersprungen: 0'
	);
	await expect(wallet.getByTestId('wallet-account')).toContainText('2,999939 XMR');

	// Again: nothing new.
	await wallet.getByTestId('wallet-import-file').setInputFiles(file);
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 4'
	);

	// In euros at the day's rate (150 € per XMR), the fee booked apart.
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	await page.getByTestId('year-switch').selectOption('2025');
	await expect(page.getByTestId('filter-all')).toContainText('(4)');
	const rows = page.getByTestId('transaction');
	const month = (/** @type {string} */ name) =>
		page.getByTestId('transaction-month').filter({ hasText: name }).click();
	// May: the payment out, and its fee booked apart.
	await month('Mai 2025');
	await expect(rows.filter({ hasText: '-105,00' })).toHaveCount(1);
	await expect(rows.filter({ hasText: 'Netzwerkgebühr' })).toHaveCount(1);
	await month('April 2025');
	await expect(rows.filter({ hasText: '180,00' })).toHaveCount(1);
	await month('März 2025');
	await expect(rows.filter({ hasText: '375,00' })).toHaveCount(1);
	expect(bridgeOut).not.toContain(ADDRESS);
});

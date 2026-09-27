// Aleph Cloud (issue #113), end to end: a fake Aleph API on 127.0.0.1, the
// real bridge in test mode pointed at it (BELEGE_BRIDGE_TEST_ALEPH_URL) with
// a fixed USD rate, and the app. An Aleph account typed in → "Bei Aleph
// prüfen" finds it → "Verbrauchsnachweis erstellen" for last month → an
// Eigenbeleg under Belege, and a second one for the same month is not
// offered. Every address, hash and amount is made up
// (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { fakeAlephAddress, fakeItemHash, startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const ACCOUNT = fakeAlephAddress('e2e hosting');
const VM = fakeItemHash('e2e vm');
// Last month, as the card offers it by default.
const now = new Date();
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const MONTH = last.toISOString().slice(0, 7);
const day = (/** @type {number} */ d, /** @type {string} */ time) =>
	`${MONTH}-${String(d).padStart(2, '0')}T${time}.000Z`;

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	const rows = [
		{
			at: day(2, '09:00:00'),
			amount: 3_000_000,
			price: '0.000001',
			txHash: '0x' + 'ef'.repeat(32)
		},
		{
			at: day(3, '00:30:00'),
			amount: -12_000,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 5,
			sizeMib: 800
		},
		{
			at: day(3, '01:00:00'),
			amount: -40_000,
			paymentMethod: 'credit_expense',
			originRef: fakeItemHash('bill'),
			origin: VM
		},
		{
			at: day(4, '00:30:00'),
			amount: -12_000,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 5,
			sizeMib: 800
		}
	];
	aleph = await startFakeAleph({
		accounts: { [ACCOUNT]: { balance: 2_936_000, rows } },
		messages: { [VM]: { type: 'INSTANCE', name: 'e2e-relay' } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-aleph-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_ALEPH_URL: aleph.url,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ USD: '0.9' })
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await aleph?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('an Aleph account is found, and last month becomes an Eigenbeleg', async ({ page }) => {
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

	const card = page.getByTestId('aleph-card');
	await expect(card.getByTestId('aleph-scan')).toBeDisabled();
	await card.getByTestId('aleph-extra-input').fill(ACCOUNT);
	await card.getByTestId('aleph-extra-add').click();
	await card.getByTestId('aleph-scan').click();
	await expect(card.getByTestId('aleph-scan-result')).toContainText('1 Adressen geprüft, 1 davon');
	await expect(card.getByTestId('aleph-account')).toHaveCount(1);
	await expect(card.getByTestId('aleph-account-credits')).toContainText('2.936.000 Credits');
	await expect(card.getByTestId('aleph-month')).toHaveValue(MONTH);

	await card.getByTestId('aleph-make').click();
	await expect(card.getByTestId('aleph-made')).toContainText(`EB-${MONTH.slice(0, 4)}-001`);
	// 64 000 credits × 0.000001 USD × 0.9 = 0.06 EUR
	await expect(card.getByTestId('aleph-made')).toContainText('0,06 EUR');
	await expect(card.getByTestId('aleph-statement-exists')).toContainText(
		`EB-${MONTH.slice(0, 4)}-001`
	);
	await expect(card.getByTestId('aleph-make')).toHaveCount(0);

	await page.getByRole('link', { name: 'Belege', exact: true }).click();
	await expect(page.getByTestId('receipt').filter({ hasText: 'Aleph Cloud' })).toHaveCount(1);
	// The address never reaches the bridge's log.
	expect(bridgeOut).not.toContain(ACCOUNT);
	expect(bridgeOut).toContain('aleph: statement');
});

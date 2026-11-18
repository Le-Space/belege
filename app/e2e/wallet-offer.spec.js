// A withdrawal from an exchange to an address that is no own wallet yet: the
// payment's detail offers it as one. A click opens Integrationen → Eigene
// Wallets with the chain and the address filled in; nothing is added before
// the person presses "hinzufügen". Once it is an own wallet, the offer is
// gone. Real bridge in test mode; the account id, hash and amount are made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge, stopBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const day = new Date().toISOString().slice(0, 10);
const ACCOUNT = 'wolkenfabrik.near';
const HASH = '7'.repeat(44);

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-wallet-offer-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	await stopBridge(bridge);
	if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('a withdrawal to an unknown address offers it as an own wallet, filled in', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Wallet-Vorschlag');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await pairBridge(page, { code, out: () => bridgeOut });

	await page.evaluate(
		async ({ day, ACCOUNT, HASH }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: day,
				counterparty: 'Kraken NEAR Auszahlung',
				purpose: 'Auszahlung',
				amountCents: -12_34,
				source: 'kraken',
				movement: 'transfer',
				asset: 'NEAR',
				chainTxRef: HASH,
				chainMethod: 'NEAR',
				chainAddress: ACCOUNT
			});
		},
		{ day, ACCOUNT, HASH }
	);

	const openPayment = async () => {
		await page.getByTestId('tab-zahlungen').click();
		await page.getByTestId('transaction').filter({ hasText: 'Kraken NEAR Auszahlung' }).click();
		const address = page.getByTestId('tx-detail-chain-address');
		if (!(await address.isVisible()))
			await page.getByText('Details', { exact: true }).first().click();
		await expect(address).toContainText(ACCOUNT);
	};
	await openPayment();
	await expect(page.getByTestId('tx-detail-wallet-offer')).toContainText(
		'noch keine eigene Wallet'
	);
	const add = page.getByTestId('tx-detail-wallet-offer-add');
	await expect(add).toHaveText('Als eigene Wallet anlegen (NEAR)');
	await add.click();

	// The form, filled in – and the address not in the URL.
	await expect(page).toHaveURL(/\/integrationen\/wallets\/?$/);
	const card = page.getByTestId('wallets-card');
	await expect(card.getByTestId('wallet-chain')).toHaveValue('near');
	await expect(card.getByTestId('wallet-address-input')).toHaveValue(ACCOUNT);
	await expect(card.getByTestId('wallet-address')).toHaveCount(0);
	await card.getByTestId('wallet-add-button').click();
	await expect(card.getByTestId('wallet-address')).toContainText(ACCOUNT);

	// An own wallet now: no offer any more.
	await openPayment();
	await expect(page.getByTestId('tx-detail-wallet-offer')).toHaveCount(0);
});

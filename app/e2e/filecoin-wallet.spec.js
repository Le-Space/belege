// A Filecoin wallet end to end: a fake Filfox on 127.0.0.1, the real bridge
// in test mode with a fixed FIL rate, and the app. Add an own Filecoin
// address with the fake as its own endpoint → synchronise → its account, a
// receipt, a withdrawal to the exchange and its fee. A Kraken deposit with
// the same message CID is then the other side of an own transfer, and its
// detail names Filecoin. Addresses, CIDs and amounts are made up
// (@belege/bridge/testing/filfox).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	fakeFilecoinAddress,
	fakeMessageCid,
	startFakeFilfox
} from '@belege/bridge/testing/filfox';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const OURS = fakeFilecoinAddress('e2e own wallet');
const KRAKEN = fakeFilecoinAddress('e2e exchange deposit address');
const FRIEND = fakeFilecoinAddress('e2e customer');
const IN = fakeMessageCid('e2e payment in');
const OUT = fakeMessageCid('e2e withdrawal to kraken');
const NOW = Math.floor(Date.now() / 1000);
const atto = (/** @type {number} */ fil) => (BigInt(fil) * 10n ** 18n).toString();

/** @type {Awaited<ReturnType<typeof startFakeFilfox>>} */ let filfox;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	filfox = await startFakeFilfox({
		addresses: {
			[OURS]: {
				balance: atto(5),
				transfers: [
					{
						height: 10,
						timestamp: NOW - 2 * 86400,
						message: IN,
						from: FRIEND,
						to: OURS,
						value: atto(25),
						type: 'receive'
					},
					{
						height: 20,
						timestamp: NOW - 86400,
						message: OUT,
						from: OURS,
						to: KRAKEN,
						value: `-${atto(20)}`,
						type: 'send'
					},
					{
						height: 20,
						timestamp: NOW - 86400,
						message: OUT,
						from: OURS,
						to: 'f02966277',
						value: '-5000000000000000',
						type: 'miner-fee'
					}
				]
			}
		}
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-fil-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ FIL: '2' }) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await filfox?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a Filecoin wallet is read, and its withdrawal pairs with the Kraken deposit', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Filecoin');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	await openIntegration(page, 'wallets');
	const card = page.getByTestId('wallets-card');
	const open = card.getByTestId('wallet-add-open');
	if (await open.isVisible()) await open.click();
	await card.getByTestId('wallet-chain').selectOption('filecoin');
	await expect(card.getByTestId('wallet-address-input')).toHaveAttribute('placeholder', 'f1…');
	await card.getByTestId('wallet-address-input').fill('f1nichtgueltig');
	await card.getByTestId('wallet-add-button').click();
	await expect(card.getByTestId('wallet-add-error')).toBeVisible();
	await card.getByTestId('wallet-address-input').fill(OURS);
	await card.getByTestId('wallet-endpoint-api').fill(filfox.url);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: OURS.slice(-6) });
	await wallet.getByTestId('wallet-sync').click();
	// Received, sent to the exchange, and the fee.
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 3 · Aktualisiert: 0 · Übersprungen: 0'
	);
	await expect(wallet.getByTestId('wallet-account')).toContainText(
		`Wallet FIL ···${OURS.slice(-6)}`
	);
	await expect(wallet.getByTestId('wallet-explorer')).toHaveAttribute(
		'href',
		`https://filfox.info/en/address/${OURS}`
	);
	expect(bridgeOut).not.toContain(OURS);

	// The exchange's side: a deposit naming the same message CID.
	await page.evaluate(
		async ({ OUT }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
				counterparty: 'Kraken FIL Einzahlung',
				purpose: 'Einzahlung',
				amountCents: 40_00,
				source: 'kraken',
				movement: 'transfer',
				asset: 'FIL',
				quantity: '200000000000',
				decimals: 10,
				txRef: 'R-E2E-DEP',
				chainTxRef: OUT,
				chainMethod: 'Filecoin'
			});
			await e2e.runMatching();
		},
		{ OUT }
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await page.getByTestId('tab-zahlungen').click();
	// Paired as an own transfer, it needs no receipt: not under "Nur ohne Beleg".
	await page.getByRole('button', { name: /^Alle/ }).click();
	await page.getByTestId('transaction').filter({ hasText: 'Kraken FIL Einzahlung' }).click();
	if (!(await page.getByTestId('tx-detail-chain-ref').isVisible())) {
		await page.getByText('Details', { exact: true }).first().click();
	}
	await expect(page.getByTestId('tx-detail-chain')).toContainText('Filecoin');
	await expect(page.locator('body')).toContainText('Umbuchung');
});

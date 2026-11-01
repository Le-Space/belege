// FIL for USDFC on SushiSwap, end to end (issue #301): a fake Filfox on
// 127.0.0.1 with one swap – FIL sent to Sushi's router, USDFC received from a
// pool in the same message –, the real bridge in test mode with fixed rates,
// and the app. The wallet gets an account per asset, both legs are a Tausch
// through SushiSwap and need no receipt. The wallet, the pool, the CID and
// the amounts are made up; the contracts are the listed ones.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { fakeMessageCid, startFakeFilfox, toFilecoinAddress } from '@belege/bridge/testing/filfox';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const WALLET_0X = `0x${'7a'.repeat(20)}`;
const WALLET = toFilecoinAddress(WALLET_0X);
const POOL = toFilecoinAddress(`0x${'7b'.repeat(20)}`);
const SUSHI = toFilecoinAddress('0xac4c6e212a361c968f1725b4d055b47e63f80b75');
const USDFC = toFilecoinAddress('0x80b98d3aa09ffff255c3ba4a241111ff1262f045');
const SWAP = fakeMessageCid('e2e FIL for USDFC');
const NOW = Math.floor(Date.now() / 1000);
const atto = (/** @type {number} */ n) => (BigInt(Math.round(n * 1e4)) * 10n ** 14n).toString();

/** @type {Awaited<ReturnType<typeof startFakeFilfox>>} */ let filfox;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	const at = { height: 10, timestamp: NOW - 86400, message: SWAP };
	filfox = await startFakeFilfox({
		addresses: {
			[WALLET]: {
				balance: atto(69.4815),
				transfers: [
					{ ...at, from: WALLET, to: SUSHI, value: `-${atto(10)}`, type: 'send' },
					{ ...at, from: WALLET, to: 'f02966277', value: '-5000000000000000', type: 'miner-fee' }
				],
				tokenTransfers: [
					{
						...at,
						from: POOL,
						to: WALLET,
						token: USDFC,
						value: atto(10.4211),
						symbol: 'USDFC',
						decimals: 18
					}
				]
			}
		},
		messages: { [SWAP]: { to: SUSHI } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-fil-swap-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ FIL: '2', USDFC: '0.9' })
		},
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

test('FIL for USDFC on SushiSwap: an account per asset, a Tausch, no receipt needed', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Filecoin Swap');
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
	await expect(card.getByTestId('wallet-address-input')).toHaveAttribute(
		'placeholder',
		'f1… · f410f… · 0x…'
	);
	await card.getByTestId('wallet-address-input').fill(WALLET_0X);
	await card.getByTestId('wallet-endpoint-api').fill(filfox.url);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: WALLET.slice(-6) });
	await wallet.getByTestId('wallet-sync').click();
	// The FIL leg, its fee, the USDFC leg.
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 3 · Aktualisiert: 0 · Übersprungen: 0'
	);
	await expect(wallet.getByTestId('wallet-account')).toHaveCount(2);
	await expect(
		wallet.getByTestId('wallet-account').filter({ hasText: 'Wallet USDFC' })
	).toContainText('10,4211 USDFC');
	expect(bridgeOut).not.toContain(WALLET);

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByRole('button', { name: /^Alle/ }).click();
	// Both legs and the gas, which names the swap it paid for.
	const rows = page.getByTestId('transaction').filter({ hasText: 'SushiSwap' });
	await expect(rows).toHaveCount(3);
	const legs = rows.filter({
		has: page.getByTestId('coverage-badge').filter({ hasText: /^Tausch$/ })
	});
	await expect(legs).toHaveCount(2);
	await expect(legs.first()).toContainText('Tausch: 10 FIL → 10,4211 USDFC über SushiSwap');
});

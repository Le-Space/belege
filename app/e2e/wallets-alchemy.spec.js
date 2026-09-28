// An own Ethereum wallet read through Alchemy, end to end: a fake Alchemy on
// 127.0.0.1, the real bridge in test mode with a made-up Alchemy key
// (BELEGE_BRIDGE_TEST_ALCHEMY_KEY, never the keychain) and fixed rates, and
// the app.
//
// Passkey → pair → Integrationen: the card says the bridge reads EVM
// wallets through Alchemy (and, in the technical view, how) → add an
// Ethereum wallet → it names Alchemy as its source → synchronise, twice →
// accounts and balances. The key never reaches the page or the bridge's
// output. All addresses, hashes, keys and amounts are made up
// (@belege/bridge/testing/alchemy).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { EVM, fakeEvmAddress } from '@belege/bridge/testing/chains';
import {
	FAKE_ALCHEMY_KEY,
	evmChain,
	fakeTx,
	startFakeAlchemy
} from '@belege/bridge/testing/alchemy';

// A DEX swap (issue #115): 30 000 of a token not in the list given to the
// MetaMask router's spender, 0.143 ETH back from it as an internal transfer.
const METAMASK_ROUTER = '0x881d40237659c251811cec9c364ef91dc08d300c';
const METAMASK_SPENDER = '0x74de5d4fcbf63e00296fd95d33236b9794016631';
const XYZ_CONTRACT = fakeEvmAddress('a token not in the list');
const swapTx = fakeTx({
	seed: 'a-swap',
	block: 700,
	from: EVM.wallet,
	to: METAMASK_ROUTER,
	gasUsed: 180000n,
	logs: [
		{
			logIndex: 2,
			contract: XYZ_CONTRACT,
			from: EVM.wallet,
			to: METAMASK_SPENDER,
			value: 30000n * 10n ** 18n,
			symbol: 'XYZ',
			decimals: 18
		}
	],
	internal: [
		{ trace: '1', index: '2', from: METAMASK_SPENDER, to: EVM.wallet, value: 143000000000000000n }
	]
});
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const tail = (/** @type {string} */ a) => a.slice(-6);

/** @type {Awaited<ReturnType<typeof startFakeAlchemy>>} */ let alchemy;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	alchemy = await startFakeAlchemy({ txs: [...evmChain(), swapTx] });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-alchemy-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_ALCHEMY_KEY: FAKE_ALCHEMY_KEY,
			BELEGE_BRIDGE_TEST_ALCHEMY_URL: alchemy.url,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({
				ETH: '2000',
				USDC: '0.9',
				// The token not in the list, by its contract (#115).
				[XYZ_CONTRACT.toLowerCase()]: '0.0001'
			})
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await alchemy?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('with an Alchemy key the card says so, and an Ethereum wallet is read there', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Integrationen' }).click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	await openIntegration(page, 'wallets');
	const card = page.getByTestId('wallets-card');
	const source = card.getByTestId('wallets-source');
	await expect(source).toHaveAttribute('data-source', 'alchemy');
	await expect(source).toContainText('über Alchemy');
	await expect(source).toContainText('nur auf diesem Mac');
	await expect(source.getByTestId('wallets-setup-alchemy')).toHaveCount(0);
	// The technical level, with the switch.
	await page.getByTestId('technical-toggle').first().click();
	const technical = source.getByTestId('wallets-source-technical');
	await expect(technical).toContainText('alchemy_getAssetTransfers');
	await expect(technical).toContainText('Arbitrum und Optimism');
	await page.getByTestId('technical-toggle').first().click();

	await card.getByTestId('wallet-chain').selectOption('ethereum');
	// With Alchemy, the endpoint field is an own endpoint, not Blockscout.
	await expect(card.getByTestId('wallet-uses')).not.toContainText('Blockscout');
	await expect(card.getByTestId('wallet-endpoint-api')).toHaveAttribute('placeholder', 'https://…');
	await expect(card.getByTestId('wallet-uses-alchemy')).toContainText('ersetzt Alchemy');
	await card.getByTestId('wallet-address-input').fill(EVM.wallet);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: EVM.wallet });
	await expect(wallet.getByTestId('wallet-source')).toHaveText('Datenquelle: Alchemy');

	await wallet.getByTestId('wallet-sync').click();
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		/Neu: [1-9]\d* · Aktualisiert: 0 · Übersprungen: 0/
	);
	const first = await wallet.getByTestId('wallet-result').textContent();
	const count = Number(/Neu: (\d+)/.exec(String(first))?.[1]);
	const accounts = wallet.getByTestId('wallet-account');
	// ETH, USDC, and XYZ: not in the list, but the wallet sent it in a swap (#115).
	await expect(accounts).toHaveCount(3);
	await expect(accounts.nth(2)).toContainText('XYZ');
	await expect(accounts.nth(0)).toContainText(`Wallet ETH (Ethereum) ···${tail(EVM.wallet)}`);
	await expect(accounts.nth(0)).toContainText('0,31 ETH');
	await expect(accounts.nth(1)).toContainText('450 USDC');

	// A second sync adds nothing.
	await wallet.getByTestId('wallet-sync').click();
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		`Neu: 0 · Aktualisiert: 0 · Übersprungen: ${count}`
	);

	// A name, a ledger account and a cost centre: on every asset account at once.
	await wallet.getByTestId('wallet-edit').click();
	const form = wallet.getByTestId('wallet-edit-form');
	await form.getByTestId('wallet-edit-name').fill('Projekt Nord');
	await form.getByTestId('wallet-edit-ledger').fill('1210');
	await form.getByTestId('wallet-edit-cost').fill('P 1');
	await form.getByTestId('wallet-edit-save').click();
	await expect(form.getByTestId('wallet-edit-error')).toContainText('Kostenstelle');
	await form.getByTestId('wallet-edit-cost').fill('P100');
	await form.getByTestId('wallet-edit-save').click();
	await expect(form).toHaveCount(0);
	await expect(wallet.getByTestId('wallet-name')).toHaveText('Projekt Nord');
	await expect(wallet.getByTestId('wallet-booking')).toContainText('Konto 1210');
	await expect(wallet.getByTestId('wallet-booking')).toContainText('Kostenstelle P100');
	await expect(accounts.nth(0)).toContainText('Projekt Nord · ETH (Ethereum)');
	await expect(accounts.nth(1)).toContainText('Projekt Nord · USDC (Ethereum)');

	// The swap: the ETH that came back is a Tausch naming both sides and the
	// router; no receipt is asked for.
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const swapText =
		'Tausch: 30.000 XYZ (nicht gelistet) → 0,143 ETH über MetaMask Swap (Router) · Gas 0,00018 ETH';
	const swapRow = page
		.getByTestId('transaction')
		.filter({ hasText: swapText, hasNotText: 'Netzwerkgebühr' })
		.filter({ hasText: /286,00\sEUR/ });
	await expect(swapRow).toHaveCount(1);
	// The token's side is booked too, in its own account, as the other leg.
	const tokenRow = page
		.getByTestId('transaction')
		.filter({ hasText: swapText, hasNotText: 'Netzwerkgebühr' })
		.filter({ hasText: /-3,00\sEUR/ });
	await expect(tokenRow.getByTestId('coverage-badge')).toHaveText('Tausch');
	// Its gas: a fee of its own that names the swap.
	await expect(
		page.getByTestId('transaction').filter({ hasText: `Netzwerkgebühr für ${swapText}` })
	).toHaveCount(1);
	await expect(swapRow.getByTestId('coverage-badge')).toHaveText('Tausch');
	await expect(swapRow.getByTestId('payee')).toHaveText('MetaMask Swap (Spender)');
	await swapRow.click();
	await expect(page.getByTestId('tx-detail-classification')).toContainText('Block-Explorer');
	await page.getByTestId('tx-detail-close').click();
	await page.getByRole('link', { name: 'Integrationen' }).click();

	// The key went to the fake Alchemy, in the path of its requests, and nowhere else.
	expect(alchemy.paths.length).toBeGreaterThan(0);
	expect(alchemy.paths.every((p) => p === `/eth-mainnet/v2/${FAKE_ALCHEMY_KEY}`)).toBe(true);
	expect(await page.content()).not.toContain(FAKE_ALCHEMY_KEY);
	expect(bridgeOut).not.toContain(FAKE_ALCHEMY_KEY);
	expect(bridgeOut.includes(EVM.wallet)).toBe(false);
});

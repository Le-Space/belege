// The monthly Akash usage statement (#305, step 2), end to end: a fake Akash
// node (two transactions whose fees the wallet paid, one deployment with what
// it paid its providers) and a fake indexer on 127.0.0.1, the real bridge in
// test mode with fixed rates, and the app. Sync the wallet, make the month's
// statement on its card – it covers both fees –, and the export books them as
// one collective line; the ACT account adds up. Every address, hash, dseq
// and amount is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	akashDeployment,
	cosmosTx,
	fakeCosmosAddress,
	startFakeAkashConsole,
	startFakeCosmos
} from '@belege/bridge/testing/chains';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const W = fakeCosmosAddress('e2e akash deployer', 'akash');
const PROVIDER = fakeCosmosAddress('e2e akash provider', 'akash');

/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
/** @type {Awaited<ReturnType<typeof startFakeAkashConsole>>} */ let indexer;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	// Heights 1000 and 1060 are 2026-09-01 00:00 and 01:00 UTC (fake-chains blockTime).
	const fee = (/** @type {string} */ seed, /** @type {number} */ height) =>
		cosmosTx({
			seed,
			height,
			prefix: 'akash',
			fee: { payer: W, amount: '5000uakt' },
			transfers: []
		});
	node = await startFakeCosmos({
		network: 'akashnet-2',
		txs: [fee('e2e create', 1000), fee('e2e lease', 1060)],
		balances: {
			[W]: [
				{ denom: 'uakt', amount: '1000000' },
				{ denom: 'uact', amount: '1000000' }
			]
		},
		deployments: [
			akashDeployment({ owner: W, dseq: '4242', created: 1000, settled: 1060, uact: '2500000' }),
			akashDeployment({ owner: PROVIDER, dseq: '9', created: 1000, settled: 1060, uact: '7' })
		]
	});
	indexer = await startFakeAkashConsole({ txs: [] });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-akash-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ AKT: '2', USD: '0.9' })
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await node?.close();
	await indexer?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('an Akash month: the statement covers its fees, the export books them as one line', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Akash');
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
	await card.getByTestId('wallet-chain').selectOption('akash');
	await card.getByTestId('wallet-address-input').fill(W);
	await card.getByTestId('wallet-endpoint-rpc').fill(node.url);
	await card.getByTestId('wallet-endpoint-rest').fill(node.url);
	await card.getByTestId('wallet-endpoint-indexer').fill(indexer.url);
	await card.getByTestId('wallet-add-button').click();
	const wallet = card.getByTestId('wallet').filter({ hasText: W });
	// The wallet's ledger account, for the export.
	await wallet.getByTestId('wallet-edit').click();
	await wallet.getByTestId('wallet-edit-ledger').fill('1365');
	await wallet.getByTestId('wallet-edit-save').click();
	await wallet.getByTestId('wallet-sync').click();
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 2 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// The statement of September: both fees, the deployment's 2.5 ACT.
	const statement = wallet.getByTestId('akash-statement');
	await statement.getByTestId('akash-statement-month').selectOption('2026-09');
	await statement.getByTestId('akash-statement-make').click();
	await expect(statement.getByTestId('akash-statement-note')).toHaveText(
		/Eigenbeleg EB-2026-\d{3} für 2026-09 erstellt: 2 Netzwerkgebühren verknüpft, Verbrauch 2,5 ACT\./
	);
	await expect(statement.getByTestId('akash-statement-exists')).toBeVisible();

	// The ACT account: 1 ACT held, 2.5 used, so 3.5 minted.
	await wallet.getByTestId('akash-act-open').click();
	const summary = wallet.getByTestId('akash-act-summary');
	await expect(summary).toContainText('Aufgeladen 3,5 ACT');
	await expect(summary).toContainText('verbraucht 2,5 ACT');
	await expect(summary).toContainText('übrig 1 ACT auf der Wallet und 0 ACT im Escrow');
	await expect(wallet.getByTestId('akash-act-month').filter({ hasText: '2026-09' })).toBeVisible();
	expect(bridgeOut).not.toContain(W);

	// The export: the fees' accounts confirmed, then one collective line.
	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption('2026-09');
	await page.getByTestId('export-auto-confirm').click();
	await expect(page.getByTestId('export-collect-fees')).toBeChecked();
	await expect(page.getByTestId('export-summary')).toContainText(
		'2 Buchungen · 1 im Buchungsstapel'
	);
	await page.getByTestId('export-collect-fees').uncheck();
	await expect(page.getByTestId('export-summary')).toContainText(
		'2 Buchungen · 2 im Buchungsstapel'
	);
});

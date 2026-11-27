// The monthly Akash usage statement (#305, step 2), end to end: a fake Akash
// node (two transactions whose fees the wallet paid, one deployment with what
// it paid its providers) and a fake indexer on 127.0.0.1, the real bridge in
// test mode with fixed rates, and the app. Sync the wallet, make the month's
// statement on its card – it covers both fees –, and the export books them as
// one collective line; the ACT account adds up. The ZIP's account statement
// shows the two fees as one collective line with its annex (#1044), and
// Belegfeld 1 of the collective booking – and of each fee, collected or not –
// names the receipt that line names. Every address, hash, dseq and amount is
// made up.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';

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
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const W = fakeCosmosAddress('e2e akash deployer', 'akash');
const PROVIDER = fakeCosmosAddress('e2e akash provider', 'akash');

/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
/** @type {Awaited<ReturnType<typeof startFakeAkashConsole>>} */ let indexer;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

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
	bridge = await startBridge({
		name: 'akash',
		env: { BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ AKT: '2', USD: '0.9' }) }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await node?.close();
	await indexer?.close();
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
	await pairBridge(page, bridge);

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
	// The wallet's ledger account, for the export: in the row's ⋯ menu (#1019).
	await wallet.getByTestId('wallet-menu').click();
	await wallet.getByTestId('wallet-edit').click();
	await wallet.getByTestId('wallet-edit-ledger').fill('1365');
	await wallet.getByTestId('wallet-edit-save').click();
	await wallet.getByTestId('wallet-sync').click();
	await expect(wallet.getByTestId('wallet-result')).toHaveText(
		'Neu: 2 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// The statement of September, in the tab "Nachweise": both fees, the deployment's 2.5 ACT.
	await card.getByTestId('wallets-tab-statements').click();
	const statements = card.getByTestId('wallet-statement').filter({ hasText: W });
	const statement = statements.getByTestId('akash-statement');
	await statement.getByTestId('akash-statement-month').selectOption('2026-09');
	await statement.getByTestId('akash-statement-make').click();
	await expect(statement.getByTestId('akash-statement-note')).toHaveText(
		/Eigenbeleg EB-2026-\d{3} für 2026-09 erstellt: 2 Netzwerkgebühren verknüpft, Verbrauch 2,5 ACT\./
	);
	await expect(statement.getByTestId('akash-statement-exists')).toBeVisible();

	// The ACT account: 1 ACT held, 2.5 used, so 3.5 minted.
	await statements.getByTestId('akash-act-open').click();
	const summary = statements.getByTestId('akash-act-summary');
	await expect(summary).toContainText('Aufgeladen 3,5 ACT');
	await expect(summary).toContainText('verbraucht 2,5 ACT');
	await expect(summary).toContainText('übrig 1 ACT auf der Wallet und 0 ACT im Escrow');
	await expect(
		statements.getByTestId('akash-act-month').filter({ hasText: '2026-09' })
	).toBeVisible();
	expect(bridge.out()).not.toContain(W);

	// The export: the fees' accounts confirmed, then one collective line.
	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption('2026-09');
	await page.getByTestId('export-auto-confirm').click();
	await expect(page.getByTestId('export-collect-fees')).toBeChecked();
	await expect(page.getByTestId('export-summary')).toContainText(
		'2 Buchungen · 1 im Buchungsstapel'
	);
	const collected = await exported(page);
	expect(collected.bookings).toHaveLength(1);
	const [belegfeld] = collected.bookings[0];
	expect(belegfeld).toMatch(/^2026-09-\d{3}$/);
	// The statement: one collective line naming that receipt, each fee in the annex.
	expect(collected.statement).toContain('Auszug-Nr. KA-2026-09-1365');
	expect(collected.statement).toContain(
		`Netzwerkgebühren · 2 Transaktionen -0,01 -0,02 ${belegfeld}`
	);
	expect(collected.statement).toContain('Sammelposten NG-2026-09-AKT');
	expect(collected.statement).toContain('Anhang: Netzwerkgebühren');
	expect(collected.statement.match(/Tx [0-9A-F]{64}/g)).toHaveLength(2);

	await page.getByTestId('export-collect-fees').uncheck();
	await expect(page.getByTestId('export-summary')).toContainText(
		'2 Buchungen · 2 im Buchungsstapel'
	);
	// A booking per fee: the same Belegfeld 1, the statement as before.
	const single = await exported(page);
	expect(single.bookings.map(([b]) => b)).toEqual([belegfeld, belegfeld]);
	expect(single.statement).toContain(`Netzwerkgebühren · 2 Transaktionen -0,01 -0,02 ${belegfeld}`);
});

/**
 * Downloads the month's ZIP: Belegfeld 1 and Buchungstext of each booking in
 * the Buchungsstapel, and the text of the wallet's account statement.
 *
 * @param {import('@playwright/test').Page} page
 */
async function exported(page) {
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
	const csv = new TextDecoder('windows-1252').decode(zip['DATEV/EXTF_Buchungsstapel_2026-09.csv']);
	const bookings = csv
		.split('\r\n')
		.slice(2)
		.filter(Boolean)
		.map((line) => line.split(';'))
		.map((f) => [f[10].replace(/"/g, ''), f[13].replace(/"/g, '')]);
	const name = Object.keys(zip).find((f) => f.startsWith('Kontoauszuege/KA-2026-09-1365'));
	expect(name).toBeTruthy();
	const { text } = await extractText(
		await getDocumentProxy(zip[/** @type {string} */ (name)].slice()),
		{ mergePages: true }
	);
	return { bookings, statement: text.replace(/\s+/g, ' ') };
}

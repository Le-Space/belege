// Own wallets end to end: a fake Nyx node (CometBFT RPC + REST) on
// 127.0.0.1, the real bridge in test mode with fixed rates, and the app.
//
// Passkey → pair → Integrationen → add two own Nym wallets with the fake
// node as their own endpoint → synchronise both → the accounts with their
// balances and the address in the explorer → Zahlungen: the transfer
// between the two wallets is an own transfer on both sides, every booking
// links to its transaction in the explorer. All addresses, hashes and
// amounts are made up (@belege/bridge/testing/chains).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	cosmosTx,
	fakeCosmosAddress,
	fakeHash,
	NYX,
	startFakeCosmos
} from '@belege/bridge/testing/chains';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

const A = NYX.wallet;
const B = fakeCosmosAddress('second own wallet');
// A wallet on a node that forgot its older blocks and whose status says 0.
const C = fakeCosmosAddress('wallet on a pruned node');
const tail = (/** @type {string} */ a) => a.slice(-6);

// Today, a minute and two after midnight UTC, whenever this runs: one day, so
// one month, inside every default view ("two days ago and yesterday" split
// across months on the 1st and 2nd). Fixed once, as a real block's time is: a
// second sync must see the same time.
const MIDNIGHT = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const time = (/** @type {number} */ height) =>
	new Date(MIDNIGHT + (height === 1000 ? 1 : 2) * 60_000).toISOString();

function history() {
	return [
		// An exchange sends 250 NYM to wallet A (the exchange pays the fee).
		cosmosTx({
			seed: 'e2e-in',
			height: 1000,
			memo: 'E2E Auszahlung',
			fee: { payer: NYX.exchange, amount: '4000unym' },
			transfers: [{ sender: NYX.exchange, recipient: A, amount: '250000000unym' }]
		}),
		// A sends 100 NYM to B, our second wallet, and pays 0.005 NYM.
		cosmosTx({
			seed: 'e2e-own',
			height: 2000,
			memo: 'E2E Umbuchung',
			fee: { payer: A, amount: '5000unym' },
			transfers: [{ sender: A, recipient: B, amount: '100000000unym' }]
		})
	];
}

/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let prunedNode;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	node = await startFakeCosmos({
		txs: history(),
		time,
		balances: {
			[A]: [{ denom: 'unym', amount: '149995000' }],
			[B]: [{ denom: 'unym', amount: '100000000' }]
		}
	});
	prunedNode = await startFakeCosmos({
		txs: [
			cosmosTx({
				seed: 'e2e-forgotten',
				height: 500,
				fee: { payer: NYX.exchange, amount: '4000unym' },
				transfers: [{ sender: NYX.exchange, recipient: C, amount: '40000000unym' }]
			})
		],
		time,
		balances: { [C]: [{ denom: 'unym', amount: '40000000' }] },
		earliestHeight: 1500,
		statusSaysZero: true
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-wallets-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins: [APP_ORIGIN] },
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ NYM: '0.05' }) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await node?.close();
	await prunedNode?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('add two own Nym wallets, sync, see balances, explorer links and the own transfer', async ({
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
	await expect(card).toBeVisible();
	// No Alchemy key in this bridge: EVM wallets come from Blockscout, and
	// the card says how to lift its rate limit.
	const source = card.getByTestId('wallets-source');
	await expect(source).toHaveAttribute('data-source', 'blockscout');
	await expect(source).toContainText('ohne Schlüssel bei Blockscout');
	await expect(source).toContainText('zu viele Anfragen');
	await expect(source.getByTestId('wallets-setup-alchemy')).toHaveText('pnpm setup:alchemy');
	// The technical level only with the switch.
	await expect(source.getByTestId('wallets-source-technical')).toHaveCount(0);
	// Before adding: which node and explorer will be used.
	await card.getByTestId('wallet-chain').selectOption('nyx');
	const uses = card.getByTestId('wallet-uses');
	await expect(uses.getByTestId('wallet-endpoint-rpc')).toHaveAttribute(
		'placeholder',
		'https://rpc.nymtech.net'
	);
	await expect(uses).toContainText('https://rpc.nyx.nodes.guru');
	await expect(uses).toContainText('Nym Explorer (Nodes Guru)');

	// A wrong address is refused in the browser already.
	await card.getByTestId('wallet-address-input').fill('0x1234');
	await card.getByTestId('wallet-add-button').click();
	await expect(card.getByTestId('wallet-add-error')).toContainText('keine Adresse auf Nym (Nyx)');

	/** @param {string} address @param {string} [url] */
	async function addAndSync(address, url = node.url) {
		// Once a wallet exists, the form opens on request.
		const open = card.getByTestId('wallet-add-open');
		if (await open.isVisible()) await open.click();
		await card.getByTestId('wallet-chain').selectOption('nyx');
		await card.getByTestId('wallet-address-input').fill(address);
		await card.getByTestId('wallet-endpoint-rpc').fill(url);
		await card.getByTestId('wallet-endpoint-rest').fill(url);
		await card.getByTestId('wallet-add-button').click();
		const wallet = card.getByTestId('wallet').filter({ hasText: address });
		await expect(wallet.getByTestId('wallet-endpoints')).toContainText(`${url} (eigener)`);
		await wallet.getByTestId('wallet-sync').click();
		return wallet;
	}

	const walletA = await addAndSync(A);
	// Received from the exchange, sent to B, and the fee.
	await expect(walletA.getByTestId('wallet-result')).toHaveText(
		'Neu: 3 · Aktualisiert: 0 · Übersprungen: 0'
	);
	await expect(walletA.getByTestId('wallet-account')).toContainText(`Wallet NYM ···${tail(A)}`);
	await expect(walletA.getByTestId('wallet-account')).toContainText('149,995 NYM');
	await expect(walletA.getByTestId('wallet-explorer')).toHaveAttribute(
		'href',
		`https://nym.explorers.guru/account/${A}`
	);

	const walletB = await addAndSync(B);
	await expect(walletB.getByTestId('wallet-result')).toHaveText(
		'Neu: 1 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// Adding comes before the list: with many wallets it is still at hand.
	expect(
		await card.evaluate(
			(c, [a, b]) => {
				const x = c.querySelector(`[data-testid="${a}"]`);
				const y = c.querySelector(`[data-testid="${b}"]`);
				return Boolean(x && y && x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
			},
			['wallet-add-open', 'wallets']
		)
	).toBe(true);
	await expect(walletB.getByTestId('wallet-account')).toContainText('100 NYM');

	// A second sync of A adds nothing.
	await walletA.getByTestId('wallet-sync').click();
	await expect(walletA.getByTestId('wallet-result')).toHaveText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 3'
	);

	// Where the bookings add up to the balance, nothing is said.
	await expect(walletA.getByTestId('wallet-balance-gap')).toHaveCount(0);
	await expect(walletB.getByTestId('wallet-balance-gap')).toHaveCount(0);
	await expect(walletA.getByTestId('wallet-pruned')).toHaveCount(0);

	// A pruned node that claims to know everything: found out, and the
	// balance shows what is missing.
	const walletC = await addAndSync(C, prunedNode.url);
	await expect(walletC.getByTestId('wallet-result')).toHaveText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 0'
	);
	await expect(walletC.getByTestId('wallet-pruned')).toContainText('kennt die Chain erst ab');
	await expect(walletC.getByTestId('wallet-balance-gap')).toHaveText(
		/^Gebucht 0\sNYM, Bestand 40\sNYM: Es fehlen Transaktionen/
	);

	// The hint is on Home too (#152), and leads back to the wallets.
	await page.getByTestId('tab-home').click();
	const needs = page.getByTestId('home-integration-needs');
	await expect(needs).toContainText('Eigene Wallets');
	await needs.getByTestId('integrations-need').filter({ hasText: 'Eigene Wallets' }).click();
	await expect(page).toHaveURL(/\/integrationen\/wallets$/);

	// Zahlungen: every booking links to its transaction.
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await expect(rows).toHaveCount(4);
	const detail = page.getByTestId('tx-detail');

	// A → B: an own transfer, by the shared hash, on both sides.
	await page.getByTestId('account-filter').selectOption({ label: `Wallet NYM ···${tail(A)}` });
	const sent = rows.filter({ hasText: 'Gesendet' });
	await expect(sent.getByTestId('coverage-badge')).toHaveText('Eigene Umbuchung');
	await sent.click();
	await expect(detail.getByTestId('tx-detail-quantity')).toHaveText('-100 NYM');
	await expect(detail.getByTestId('tx-detail-amount')).toHaveText(/-5,00\sEUR/);
	// The other address once, in "An" – not again in Details (issue #254).
	await expect(detail.getByTestId('tx-detail-address')).toHaveCount(0);
	// Who sent and who received: both own wallets, by name, the way it went.
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText(`Wallet NYM ···${tail(B)}`);
	await expect(detail.getByTestId('tx-party-from')).toContainText(`Wallet NYM ···${tail(A)}`);
	await expect(detail.getByTestId('tx-party-from-own')).toHaveText('eigene Wallet');
	await expect(detail.getByTestId('tx-party-to')).toContainText(`Wallet NYM ···${tail(B)}`);
	await expect(detail.getByTestId('tx-party-to-own')).toHaveText('eigene Wallet');
	// Both sides' address, short on the page and in full on the clipboard: the
	// button, or the address itself; "Kopiert" says so (issues #114, #254).
	const short = (/** @type {string} */ a) => `${a.slice(0, 8)}…${a.slice(-6)}`;
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: APP_ORIGIN
	});
	const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
	const fromAddress = detail.getByTestId('tx-party-from-address');
	const toAddress = detail.getByTestId('tx-party-to-address');
	await expect(fromAddress.getByTestId('tx-party-from-address-value')).toHaveText(short(A));
	await expect(toAddress.getByTestId('tx-party-to-address-value')).toHaveText(short(B));
	await page.evaluate(() => navigator.clipboard.writeText(''));
	await fromAddress.getByTestId('tx-party-from-address-button').click();
	await expect.poll(readClipboard).toBe(A);
	await expect(fromAddress.getByTestId('tx-party-from-address-status')).toHaveText('Kopiert');
	await toAddress.getByTestId('tx-party-to-address-value').click();
	await expect.poll(readClipboard).toBe(B);
	await expect(toAddress.getByTestId('tx-party-to-address-status')).toHaveText('Kopiert');
	// The confirmation goes again after a moment.
	await expect(fromAddress.getByTestId('tx-party-from-address-status')).toHaveText('', {
		timeout: 5_000
	});
	// The transaction hash, once, under Details.
	if (!(await detail.getByTestId('tx-details').isVisible())) {
		await detail.getByTestId('tx-details-toggle').click();
	}
	await detail.getByTestId('tx-detail-ref-copy-button').click();
	await expect.poll(readClipboard).toBe(fakeHash('e2e-own'));
	await expect(detail.getByTestId('tx-detail-ref-copy-status')).toHaveText('Kopiert');
	await expect(sent.getByTestId('parties')).toHaveText(
		`Von Wallet NYM ···${tail(A)} → An Wallet NYM ···${tail(B)}`
	);
	await expect(detail.getByTestId('tx-detail-purpose')).toContainText('Memo: E2E Umbuchung');
	await expect(detail.getByTestId('tx-explorer')).toHaveAttribute(
		'href',
		`https://nym.explorers.guru/transaction/${fakeHash('e2e-own')}`
	);
	// The same link as a QR code, to open it on a phone.
	await detail.getByTestId('tx-explorer-qr-toggle').click();
	await expect(detail.getByTestId('tx-explorer-qr').locator('svg')).toBeVisible();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText(
		`Eigene Umbuchung: Die Gegenbuchung steht auf Wallet NYM ···${tail(B)}`
	);
	// Belongs together: the other side and the fee, one click each; the row is marked.
	await expect(sent.getByTestId('related-mark')).toBeVisible();
	const chips = detail.getByTestId('tx-related-chip');
	await expect(chips.filter({ hasText: 'Umbuchung' })).toContainText(`Wallet NYM ···${tail(B)}`);
	await expect(chips.filter({ hasText: 'Gebühr dazu' })).toHaveCount(1);
	await chips.filter({ hasText: 'Umbuchung' }).click();
	// The other side: B received from A.
	await expect(
		detail.getByTestId('tx-party-from-address').getByTestId('tx-party-from-address-value')
	).toHaveText(short(A));
	await expect(
		detail.getByTestId('tx-related-chip').filter({ hasText: 'Umbuchung' })
	).toContainText(`Wallet NYM ···${tail(A)}`);
	await detail.getByTestId('tx-detail-close').click();

	// The network fee needs no receipt; the exchange's deposit still asks for one.
	await rows.filter({ hasText: 'Netzwerkgebühr' }).click();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText(
		'Netzwerkgebühr der Blockchain'
	);
	await detail.getByTestId('tx-detail-close').click();
	const received = rows.filter({ hasText: 'Memo: E2E Auszahlung' });
	await expect(received.getByTestId('coverage-badge')).toHaveCount(0);

	// The other side, on B.
	await page.getByTestId('account-filter').selectOption({ label: `Wallet NYM ···${tail(B)}` });
	await expect(rows).toHaveCount(1);
	await expect(rows.getByTestId('coverage-badge')).toHaveText('Eigene Umbuchung');

	// The bridge logged counts, never an address.
	expect(bridgeOut).toMatch(/nyx: 2 transaction\(s\)/);
	expect(bridgeOut.includes(A) || bridgeOut.includes(B)).toBe(false);
});

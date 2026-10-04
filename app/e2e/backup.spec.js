// The backup on Aleph (issue #77), end to end: a fake Aleph on 127.0.0.1 (its
// IPFS host and its API), the real bridge in test mode with a made-up backup
// key, and the app. "Jetzt sichern" packs and seals the books in the browser
// and uploads them from the browser to the fake's IPFS host. The bridge signs
// the STORE message until its account allows this browser's own key
// (`pnpm setup:aleph -- --authorize`, run here as the command runs it); from
// then on the browser signs, for the bridge's account. Kept, and nothing
// readable on the way. Every key, address and amount is made up
// (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, memoryKeychain, saveConfig } from '@belege/bridge';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import { runAlephGrants } from '../../bridge/src/setup-aleph.js';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege e2e backup key').digest('hex');
const MARKER = 'Backupspur-Kieselweg';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	// The fake answers the balance of the account the key pays from; the bridge
	// names it, so it is found by asking the bridge's status below.
	aleph = await startFakeAleph({ accounts: {} });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-backup-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			alephBackup: { configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_ALEPH_URL: aleph.url,
			BELEGE_BRIDGE_TEST_ALEPH_BACKUP_KEY: KEY
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

test('"Jetzt sichern": sealed in the browser, uploaded from it, kept by the bridge’s key, then by the browser’s own', async ({
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

	// Something in the books to back up: a payment with a marker in it.
	await page.evaluate(async (marker) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: marker,
			purpose: 'Backup-Probe',
			amountCents: -1234
		});
	}, MARKER);

	await openIntegration(page, 'backup');
	const card = page.getByTestId('backup-card');
	// The account that pays is the bridge's; this browser has a key of its own,
	// not allowed yet, so the bridge signs and the page shows the command.
	await expect(card.getByTestId('backup-address')).toContainText(alephAccountOf(KEY));
	await expect(card.getByTestId('backup-key-address')).toContainText(/0x[0-9a-fA-F]{40}/);
	const browserKey = /** @type {string} */ (
		await card.getByTestId('backup-key-address-value').textContent()
	).trim();
	await expect(card.getByTestId('backup-not-granted')).toContainText(
		'bis dahin unterschreibt die Bridge'
	);
	await expect(card.getByTestId('backup-grant-command')).toContainText(
		`pnpm setup:aleph -- --authorize ${browserKey} --channel BELEGE-BACKUP`
	);
	await expect(card.getByTestId('backup-no-credits')).toBeVisible();
	// Without credits Aleph keeps nothing (a STORE is paid in credits since
	// storage bridge 0.17.0), and the app says how many it takes.
	await card.getByTestId('backup-now').click();
	await expect(card.getByTestId('backup-error')).toContainText(
		/Aleph hat die Sicherung nicht behalten: Auf dem Konto der Bridge sind 0 Credits, für einen Tag braucht diese Sicherung \d+/,
		{ timeout: 30_000 }
	);
	await expect(card.getByTestId('backup-row')).toHaveCount(0);
	// Credits on the account, and the same button keeps it.
	aleph.fund(alephAccountOf(KEY), 1_000_000);
	await card.getByTestId('backup-now').click();
	await expect(card.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 30_000
	});
	await expect(card.getByTestId('backup-error')).toHaveCount(0);
	await expect(card.getByTestId('backup-row')).toHaveCount(1);
	// What went in, per database: the one payment, and no receipt file yet.
	const made = card.getByTestId('backup-made');
	await expect(
		made.locator('[data-testid="backup-contents-row"][data-collection="transactions"] td')
	).toHaveText('1');
	await expect(made.getByTestId('backup-contents-row')).toHaveCount(8);
	await expect(made.getByTestId('backup-contents-files')).toHaveText('0');
	// The history keeps it, folded.
	await card.getByTestId('backup-row-details').locator('summary').click();
	await expect(
		card.getByTestId('backup-row-details').getByTestId('backup-contents-row')
	).toHaveCount(8);

	// The browser uploaded it (the bridge only signed), sealed: nothing readable.
	// Two uploads: the one Aleph did not keep, and the one it did.
	expect(aleph.added.size).toBe(2);
	const [cid, bytes] = /** @type {[string, Uint8Array]} */ ([...aleph.added].at(-1));
	expect(Buffer.from(bytes.subarray(0, 8)).toString()).toBe('belegeB1');
	expect(Buffer.from(bytes).toString('latin1')).not.toContain(MARKER);
	await expect(card.getByTestId('backup-cid')).toContainText(cid);
	const store = aleph.stores.at(-1);
	expect(store?.cid).toBe(cid);
	expect(store?.status).toBe('processed');
	expect(store?.channel).toBe('BELEGE-BACKUP');
	expect(bridgeOut).toContain('backup: kept on Aleph, processed');
	expect(bridgeOut).not.toContain(cid);
	expect(bridgeOut).not.toContain(KEY);

	// The account allows this browser's key, with the command the page showed.
	/** @type {string[]} */ const printed = [];
	expect(
		await runAlephGrants({
			io: { print: (line) => printed.push(line) },
			keychain: memoryKeychain(KEY, 'aleph-backup'),
			action: 'authorize',
			address: browserKey,
			channel: 'BELEGE-BACKUP',
			apiHost: aleph.url,
			settle: { timeout: 5_000, interval: 50 }
		})
	).toBe(true);
	await card.getByTestId('backup-check').click();
	await expect(card.getByTestId('backup-granted')).toBeVisible();

	// From now on the browser signs, for the bridge's account; the bridge only watches.
	await card.getByTestId('backup-now').click();
	await expect(card.getByTestId('backup-row')).toHaveCount(2, { timeout: 30_000 });
	await expect(card.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt');
	const own = aleph.stores.at(-1);
	expect(own).toMatchObject({
		sender: browserKey,
		owner: alephAccountOf(KEY),
		channel: 'BELEGE-BACKUP',
		payment: 'credit',
		status: 'processed'
	});
	expect(bridgeOut.match(/backup: kept on Aleph/g)).toHaveLength(1);

	// The overview says so.
	await page.getByTestId('integration-back').click();
	await expect(page.locator('[data-testid="integration-row"][data-id="backup"]')).toContainText(
		'gesichert'
	);
});

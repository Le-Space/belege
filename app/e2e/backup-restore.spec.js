// Restoring a backup (issue #77), end to end, the way it is needed: a browser
// that has lost everything. A fake Aleph on 127.0.0.1 (IPFS host, gateway and
// API), the real bridge in test mode with a made-up backup key, and the app:
// a payment goes into the books, "Jetzt sichern" backs them up, then this
// browser forgets everything – books, settings, the pairing – and the same
// passkey opens empty books. The bridge, paired again, lists the backup of its
// Aleph account; "Wiederherstellen" fetches it from the gateway and puts it
// back; after the reload the payment is there. Every key, address and amount
// is made up (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator, forgetThisDevice } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege e2e restore key').digest('hex');
const MARKER = 'Wiederherstellungsprobe-Ahornweg';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('node:child_process').ChildProcess | null} */ let bridge = null;
/** @type {string} */ let dir;
/** @type {string} */ let configPath;
let bridgeOut = '';

/** The bridge, with a fresh pairing code every start (`--pair`). */
async function startBridge() {
	bridgeOut = '';
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--pair', '--config', configPath], {
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
}

async function stopBridge() {
	const running = bridge;
	bridge = null;
	if (!running || running.exitCode !== null) return;
	await new Promise((resolve) => {
		running.once('exit', resolve);
		running.kill('SIGTERM');
	});
}

/** @param {import('@playwright/test').Page} page */
async function pair(page) {
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
}

/** @param {import('@playwright/test').Page} page */
const transactions = (page) =>
	page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return ((await e2e.transactions()) ?? []).map((/** @type {any} */ t) => t.counterparty);
	});

test.beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {} });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-restore-'));
	configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			alephBackup: { configured: true }
		},
		configPath
	);
	await startBridge();
});

test.afterAll(async () => {
	await stopBridge();
	await aleph?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a browser that lost everything gets its books back from the backup', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const did = await page.getByTestId('own-did').getAttribute('data-did');
	await pair(page);

	await page.evaluate(async (marker) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: marker,
			purpose: 'Probe',
			amountCents: -4711
		});
	}, MARKER);
	await openIntegration(page, 'backup');
	await page.getByTestId('backup-card').getByTestId('backup-now').click();
	await expect(page.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 30_000
	});

	// Everything this browser had is gone; the passkey is not.
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', String(did));
	expect(await transactions(page)).toEqual([]);

	// The pairing went with the books: pair again, and the bridge lists the backup.
	await stopBridge();
	await startBridge();
	await pair(page);
	await openIntegration(page, 'backup');
	const card = page.getByTestId('restore-card');
	await expect(card.getByTestId('restore-row')).toHaveCount(1);

	// A typed CID that is none is refused before anything is fetched.
	await card.getByTestId('restore-cid').fill('keine-cid');
	await card.getByTestId('restore-typed').click();
	await expect(card.getByTestId('restore-error')).toContainText('keine CID');

	await card.getByTestId('restore-pick').click();
	await expect(card.getByTestId('restore-confirm')).toContainText('zusammengeführt');
	await card.getByTestId('restore-yes').click();
	await expect(card.getByTestId('restore-done')).toContainText('Wiederhergestellt', {
		timeout: 30_000
	});
	await expect(card.getByTestId('restore-done')).toContainText('Zahlungen');

	// The page reloads by itself; the passkey opens the books, and the payment is back.
	await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', String(did));
	await expect.poll(() => transactions(page)).toEqual([MARKER]);
	expect(bridgeOut).toContain('backup: 1 backup(s) listed');
});

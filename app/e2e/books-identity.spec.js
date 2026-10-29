// The books' own identity (#496), end to end: books as they were made before
// it – written by the passkey, under OrbitDB's default access controller (an
// E2E-only switch, node.js `__belegeBeforeBooksIdentity`) – with a payment and
// a backup. The new code unlocks them: the payment is there, the databases are
// others (the books' own), the DID shown is still the passkey's, and the next
// backup starts a new chain with a full one. Then this browser forgets
// everything, and the backup from before the move comes back and moves in on
// the next unlock. A fake Aleph and the real bridge in test mode, as in
// backup-restore.spec.js; every key, address and amount is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator, forgetThisDevice } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege e2e restore key').digest('hex');
const MARKER = 'Vor-dem-Umzug-Ahornweg';
const LATER = 'Nach-dem-Umzug-Erlenweg';

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
	// The bridge's account pays for keeping the backup (credits, since storage bridge 0.17.0).
	aleph = await startFakeAleph({
		accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000, rows: [] } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-books-identity-'));
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

/** @param {import('@playwright/test').Page} page */
const facts = (page) =>
	page.evaluate(() => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return {
			did: /** @type {string} */ (e2e.did()),
			booksDid: /** @type {string} */ (e2e.booksDid()),
			addresses: /** @type {Record<string, string>} */ (e2e.addresses())
		};
	});

/** @param {import('@playwright/test').Page} page @param {string} counterparty */
const book = (page, counterparty) =>
	page.evaluate(
		(counterparty) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: new Date().toISOString().slice(0, 10),
				counterparty,
				purpose: 'Probe',
				amountCents: -4711
			}),
		counterparty
	);

test('books the passkey wrote move to their own identity, and their backup still comes back', async ({
	page
}) => {
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	// Before #496, for this page only: a reload is the new code.
	await page.evaluate(() => {
		/** @type {any} */ (globalThis).__belegeBeforeBooksIdentity = true;
	});
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await pair(page);

	// Books as before: the passkey is their writer.
	const before = await facts(page);
	expect(before.booksDid).toBe(before.did);
	await book(page, MARKER);
	await openIntegration(page, 'backup');
	const backups = page.getByTestId('backup-card');
	await backups.getByTestId('backup-now').click();
	await expect(page.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 30_000
	});
	const old = /** @type {any} */ (aleph.stores.at(-1));
	expect(old.ref).toBeUndefined();

	// The new code: the next unlock moves the books to their own identity.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', before.did);
	const after = await facts(page);
	expect(after.did).toBe(before.did);
	expect(after.booksDid).not.toBe(before.did);
	expect(after.booksDid).toMatch(/^did:key:/);
	for (const name of Object.keys(before.addresses)) {
		expect(after.addresses[name]).not.toBe(before.addresses[name]);
	}
	await expect.poll(() => transactions(page)).toEqual([MARKER]);
	// The books write as themselves.
	await book(page, LATER);
	await expect.poll(async () => (await transactions(page)).sort()).toEqual([LATER, MARKER].sort());

	// Other databases: the chain from before does not go on, the next backup is a full one.
	await openIntegration(page, 'backup');
	await backups.getByTestId('backup-now').click();
	await expect(page.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 30_000
	});
	const fresh = /** @type {any} */ (aleph.stores.at(-1));
	expect(fresh.ref).toBeUndefined();
	expect(fresh.cid).not.toBe(old.cid);

	// Everything this browser had is gone; the backup from before the move comes back.
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', before.did);
	expect(await transactions(page)).toEqual([]);
	await stopBridge();
	await openIntegration(page, 'backup');
	const card = page.getByTestId('backup-card');
	// The account: typed, unless the books' index on Aleph already named it.
	await expect(
		card.getByTestId('backup-no-owner').or(card.getByTestId('backup-address'))
	).toBeVisible({ timeout: 30_000 });
	if (await card.getByTestId('backup-no-owner').isVisible()) {
		await card.getByTestId('backup-owner').fill(alephAccountOf(KEY));
		await card.getByTestId('backup-owner-save').click();
	}
	await expect(card.getByTestId('backup-chain-group')).toHaveCount(2, { timeout: 30_000 });
	await card
		.getByTestId('backup-chain-group')
		.filter({ hasText: old.cid })
		.getByTestId('backup-restore')
		.click();
	await card.getByTestId('restore-yes').click();
	await expect(card.getByTestId('restore-done')).toContainText('Wiederhergestellt', {
		timeout: 30_000
	});
	await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', before.did);
	// Moved in on this unlock: in the books' own databases, and they write.
	await expect.poll(() => transactions(page)).toEqual([MARKER]);
	expect((await facts(page)).addresses).toEqual(after.addresses);
	await book(page, LATER);
	await expect.poll(async () => (await transactions(page)).sort()).toEqual([LATER, MARKER].sort());
});

// One passkey, no recovery words, and an empty device (#1049). Books on a
// single passkey, a payment, "Jetzt sichern" through the bridge; the backup
// card then asks once whether to keep the vault on (a fake) Aleph. Yes: an
// empty second browser with the same passkey – a credential copied into its
// own virtual authenticator, answering PRF as a synced passkey does – gets
// the same books from "Mit vorhandenem Passkey wiederherstellen", and the
// backup card lists the backup without an address typed; the payment comes
// back. No: nothing is published, the question is not asked again, the keys
// page still offers it, and the empty device asks for the address as before.
// Every key, address and amount is made up (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator } from './webauthn.js';
import { answerPrfAlike } from './devices.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { openSettings } from './settings.js';
import { pairBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege e2e single passkey key').digest('hex');
const MARKER = 'Einzelschluessel-Probe-Kastanienweg';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('node:child_process').ChildProcess | null} */ let bridge = null;
/** @type {string} */ let dir;
/** @type {string} */ let configPath;
let bridgeOut = '';

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

test.beforeEach(async () => {
	aleph = await startFakeAleph({
		accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000, rows: [] } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-single-'));
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

test.afterEach(async () => {
	await stopBridge();
	await aleph?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * A browser of its own: a virtual authenticator, the fake Aleph, and the PRF
 * answer of the one synced passkey.
 *
 * @param {import('@playwright/test').Browser} browser
 */
async function device(browser) {
	const context = await browser.newContext();
	await answerPrfAlike(context);
	await context.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	const page = await context.newPage();
	const cdp = await addVirtualAuthenticator(page);
	return { context, page, cdp };
}

/** @param {import('@playwright/test').Page} page */
const transactions = (page) =>
	page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return ((await e2e.transactions()) ?? []).map((/** @type {any} */ t) => t.counterparty);
	});

/**
 * Books on one passkey, paired with the bridge, a payment, and one backup.
 *
 * @param {Awaited<ReturnType<typeof device>>} first
 */
async function booksWithOneBackup(first) {
	const { page } = first;
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Einzelschlüssel');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const did = String(await page.getByTestId('own-did').getAttribute('data-did'));
	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await pairBridge(page, { code, out: () => bridgeOut });
	await page.evaluate(async (marker) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: marker,
			purpose: 'Probe',
			amountCents: -1234
		});
	}, MARKER);
	await openIntegration(page, 'backup');
	const card = page.getByTestId('backup-card');
	// Nothing backed up yet: nothing asked yet.
	await expect(card.getByTestId('backup-now')).toBeVisible();
	await expect(card.getByTestId('vault-offer')).toHaveCount(0);
	await card.getByTestId('backup-now').click();
	await expect(page.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
		timeout: 30_000
	});
	// Only the backup: no index yet.
	expect(aleph.kept.size).toBe(0);
	return { did, card };
}

/**
 * The same passkey in a second, empty browser.
 *
 * @param {Awaited<ReturnType<typeof device>>} first
 * @param {Awaited<ReturnType<typeof device>>} second
 */
async function samePasskeyIn(first, second) {
	const { credentials } = await first.cdp.send('WebAuthn.getCredentials', {
		authenticatorId: first.cdp.authenticatorId
	});
	expect(credentials).toHaveLength(1);
	await second.cdp.send('WebAuthn.addCredential', {
		authenticatorId: second.cdp.authenticatorId,
		credential: credentials[0]
	});
	await second.page.goto('/');
	await acceptConsent(second.page);
}

test('one passkey, the vault kept on Aleph: an empty device gets books and backups without typing', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const first = await device(browser);
	const second = await device(browser);
	try {
		const { did, card } = await booksWithOneBackup(first);

		// Asked once, after the backup – with a single passkey.
		await expect(card.getByTestId('vault-offer')).toBeVisible();
		await card.getByTestId('vault-offer-yes').click();
		await expect(card.getByTestId('vault-offer-kept')).toBeVisible({ timeout: 30_000 });
		await expect(card.getByTestId('vault-offer')).toHaveCount(0);
		// Index P of the passkey and index M of the books; nothing named.
		expect(aleph.kept.size).toBe(2);
		const published = JSON.stringify([...aleph.kept.values()]);
		expect(published).not.toContain('Einzelschlüssel');
		expect(published).not.toContain(MARKER);
		expect(published.toLowerCase()).not.toContain(alephAccountOf(KEY).toLowerCase());
		// The keys page no longer offers it.
		await openSettings(first.page, 'schluessel');
		await expect(first.page.getByTestId('keys-card')).toBeVisible();
		await expect(first.page.getByTestId('keys-single')).toBeVisible();
		await expect(first.page.getByTestId('keys-not-published')).toHaveCount(0);

		// The bridge is not needed on the empty device.
		await stopBridge();
		await samePasskeyIn(first, second);
		const page = second.page;
		await page.getByTestId('passkey-restore').click();
		// The vault was found: no question about new, empty books.
		await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did, {
			timeout: 60_000
		});
		await expect(page.getByTestId('new-books-dialog')).toHaveCount(0);
		expect(await transactions(page)).toEqual([]);

		// The account came with the vault: the backup is listed, nothing typed.
		await openIntegration(page, 'backup');
		const restore = page.getByTestId('backup-card');
		await restore.getByTestId('backup-restore-open').click({ timeout: 30_000 });
		await expect(restore.getByTestId('backup-chain-group')).toHaveCount(1, { timeout: 30_000 });
		await expect(restore.getByTestId('backup-no-owner')).toHaveCount(0);
		await expect(restore.getByTestId('backup-owner')).toHaveCount(0);
		await restore.getByTestId('backup-restore').click();
		await restore.getByTestId('restore-yes').click();
		await expect(restore.getByTestId('restore-done')).toContainText('Wiederhergestellt', {
			timeout: 30_000
		});
		await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
		await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await expect.poll(() => transactions(page)).toEqual([MARKER]);
	} finally {
		await first.context.close();
		await second.context.close();
	}
});

test('one passkey, the offer declined: nothing published, not asked again, the address as before', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const first = await device(browser);
	const second = await device(browser);
	try {
		const { did, card } = await booksWithOneBackup(first);
		await expect(card.getByTestId('vault-offer')).toBeVisible();
		await card.getByTestId('vault-offer-no').click();
		await expect(card.getByTestId('vault-offer')).toHaveCount(0);
		expect(aleph.kept.size).toBe(0);

		// A second backup does not ask again, and publishes nothing.
		await first.page.evaluate(() =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: new Date().toISOString().slice(0, 10),
				counterparty: 'Nachtrag ohne Tresor',
				purpose: 'Probe',
				amountCents: -1
			})
		);
		await openIntegration(first.page, 'backup');
		const again = first.page.getByTestId('backup-card');
		await again.getByTestId('backup-now').click();
		await expect(first.page.getByTestId('backup-made')).toBeVisible({ timeout: 30_000 });
		await expect(again.getByTestId('vault-offer')).toHaveCount(0);
		expect(aleph.kept.size).toBe(0);

		// The keys page still offers it, with one passkey.
		await openSettings(first.page, 'schluessel');
		await expect(first.page.getByTestId('keys-publish-now')).toBeVisible();

		// The empty device: no vault found, new books asked for, and the address typed.
		await stopBridge();
		await samePasskeyIn(first, second);
		const page = second.page;
		await page.getByTestId('passkey-restore').click();
		await expect(page.getByTestId('new-books-dialog')).toBeVisible({ timeout: 60_000 });
		await page.getByTestId('new-books-open').click();
		await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await openIntegration(page, 'backup');
		const restore = page.getByTestId('backup-card');
		await expect(restore.getByTestId('backup-owner')).toBeVisible();
		await restore.getByTestId('backup-owner').fill(alephAccountOf(KEY).toLowerCase());
		await restore.getByTestId('backup-owner-save').click();
		await restore.getByTestId('backup-restore-open').click({ timeout: 30_000 });
		await expect(restore.getByTestId('backup-chain-group')).toHaveCount(1, { timeout: 30_000 });
	} finally {
		await first.context.close();
		await second.context.close();
	}
});

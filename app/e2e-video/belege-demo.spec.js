// The Belege demo, recorded: a passkey, sample bookings from a fake bank,
// receipts from a fake mailbox read by a fake model, one sealed backup kept
// by a fake Aleph – then this browser forgets everything, the passkey brings
// the identity back, the paying account's address finds the backup, and the
// books are back under the same CID. Every key, address, name and amount is
// made up (@belege/bridge/testing); nothing leaves this machine.
//
// Scene 1 of the Devcon 8 / IPFS Planet application video. The captions are
// baked into the recording (captions.js); the pauses are for the viewer.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	SECRETS,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator, forgetThisDevice } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { openIntegration } from '../e2e/integrations.js';
import { installCaptions, say } from './captions.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege demo video key').digest('hex');
const COMPANY = 'Le Space UG';

// As in e2e/matching.spec.js: bookings that the sample mailbox's receipts match.
const BASE = new Date(Date.now() - 2 * 864e5);
const booked = BASE.toISOString().slice(0, 10);
function bankData() {
	const data = sampleData();
	/** @param {number} id @param {string} betrag @param {string} name @param {string} zweck @param {string} [art] */
	const u = (id, betrag, name, zweck, art = 'Basislastschrift') => ({
		id,
		konto_id: 1,
		datum: booked,
		valuta: booked,
		betrag,
		empfaenger_name: name,
		empfaenger_konto: '',
		zweck,
		zweck_raw: zweck,
		art,
		endtoendid: ''
	});
	data.transactions = [
		u(
			301,
			'-119,00',
			RECEIPTS.wolkenfabrik.vendor,
			`SVWZ+Rechnung ${RECEIPTS.wolkenfabrik.invoice} SecureGo plus`
		),
		u(302, '-52,59', RECEIPTS.stromwerk.vendor, 'SVWZ+Abschlag Vertrag 123'),
		u(303, '-39,99', RECEIPTS.mobilfunk.vendor, `SVWZ+Rechnung ${RECEIPTS.mobilfunk.invoice}`),
		u(304, '-22,42', 'Kaffeerösterei Nordlicht GmbH', 'SVWZ+Kartenzahlung'),
		u(
			305,
			'-500,00',
			'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
			'SVWZ+Umbuchung Revolut',
			'Überweisungsauftrag'
		),
		u(306, '-9,90', '', 'Abschluss per Quartalsende', 'Abschluss')
	];
	return data;
}

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('node:child_process').ChildProcess | null} */ let bridge = null;
/** @type {string} */ let dir;
let bridgeOut = '';

async function stopBridge() {
	const running = bridge;
	bridge = null;
	if (!running || running.exitCode !== null) return;
	await new Promise((resolve) => {
		running.once('exit', resolve);
		running.kill('SIGTERM');
	});
}

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: bankData() });
	imap = await startFakeImap({ storage: sampleMailbox({ base: BASE, privateReceipt: true }) });
	llm = await startFakeLlm();
	aleph = await startFakeAleph({
		accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000, rows: [] } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-demo-video-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			hibiscus: {
				host: hibiscus.host,
				port: hibiscus.port,
				certSha256: hibiscus.fingerprint,
				ibanSuffixes: ['4711']
			},
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none',
				accountingAddress: ACCOUNTING
			},
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				redactTerms: [SECRETS.customerName],
				redaction: 'on',
				configured: true
			},
			alephBackup: { configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
			BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY,
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
	await stopBridge();
	await aleph?.close();
	await llm?.close();
	await imap?.close();
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('scene 1: books, backup, a browser that forgets, and the books back', async ({
	page,
	context
}) => {
	/** @param {string} name */
	const tab = (name) =>
		page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name, exact: true });
	const beat = (/** @type {number} */ ms = 2500) => page.waitForTimeout(ms);

	await installCaptions(context);
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await say(
		page,
		'Le Space Belege: bookkeeping that lives in the browser. Everything here is sample data.',
		6300
	);
	await say(page, 'First visit: what stays in this browser, and what would go out.', 5400);
	await acceptConsent(page);

	await say(page, 'One passkey is the identity, and the key to the books.', 3600);
	await page.getByTestId('passkey-label').fill('Demo Studio');
	await beat(800);
	await page.getByRole('button', { name: 'Create passkey' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const did = String(await page.getByTestId('own-did').getAttribute('data-did'));
	await say(page, 'No account, no server: the DID comes from the passkey.', 5400);

	// The bridge: what a browser cannot do.
	await tab('Integrations').click();
	await say(
		page,
		'The bridge on 127.0.0.1 does what a browser cannot: bank, mailbox, a model.',
		4500
	);
	await page.getByTestId('pairing-code').fill(pairingCode());
	await beat(800);
	await page.getByRole('button', { name: /^pair$/i }).click();
	await expect(page.getByTestId('bridge-status')).toContainText(/paired/i);
	await beat(1500);
	await page.getByTestId('settings-link').click();
	await page.getByTestId('company-names').fill(COMPANY);
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// Bookings.
	await openIntegration(page, 'bank');
	await say(
		page,
		'Bookings from the bank: here a fake bank with sample data, through the bridge.',
		4500
	);
	await page.getByRole('button', { name: /sync/i }).first().click();
	await expect(page.getByTestId('sync-result')).toBeVisible();
	await beat(1500);
	await tab('Payments').click();
	await expect(page.getByTestId('transaction').first()).toBeVisible();
	await page.getByTestId('filter-all').click();
	await say(page, 'Six bookings, in the books, in this browser only.', 5400);

	// Receipts.
	await tab('Receipts').click();
	await say(page, 'Receipts from the mailbox. The model reads them with names blacked out.', 4500);
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toBeVisible();
	await page.locator('[data-testid="receipt-month-pick"][data-month="all"]').click();
	await expect(page.getByTestId('extract-all')).toHaveCount(0, { timeout: 120_000 });
	await say(page, 'Matched: each receipt to its booking.', 6300);
	await tab('Home').click();
	await expect(page.getByTestId('coverage-percent')).toBeVisible();
	await page.getByTestId('coverage-percent').scrollIntoViewIfNeeded();
	await say(page, 'Coverage and open questions, at a glance.', 5400);

	// Backup.
	await openIntegration(page, 'backup');
	await say(
		page,
		'Backup: one sealed file, kept on Aleph. The browser signs; the account pays.',
		3000
	);
	await page.getByTestId('backup-card').getByTestId('backup-now').click();
	await expect(page.getByTestId('backup-made')).toContainText('kept by Aleph', { timeout: 60_000 });
	const cid = (await page.getByTestId('backup-cid').innerText()).trim();
	await page.getByTestId('backup-cid').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await say(page, `Kept on Aleph under its CID: ${cid}`, 7200);

	// Forget.
	await say(page, 'Now this browser forgets everything. The passkey does not.', 5400);
	await forgetThisDevice(page);
	await page.goto('/');
	await say(page, 'A browser that has lost everything.', 4500);
	await acceptConsent(page);
	await say(page, 'The passkey brings the identity back.', 2700);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
	await say(page, 'Same DID as before. The books are empty.', 5400);

	// Restore, with the bridge gone.
	await stopBridge();
	await openIntegration(page, 'backup');
	const card = page.getByTestId('restore-card');
	await expect(card.getByTestId('restore-none')).toBeVisible();
	await card.getByTestId('restore-none').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await say(page, 'No bridge any more. The paying account’s address is all it takes.', 4500);
	await card.getByTestId('restore-owner').fill(alephAccountOf(KEY));
	await beat(800);
	await card.getByTestId('restore-owner-list').click();
	await expect(card.getByTestId('restore-row')).toHaveCount(1);
	await expect(card.getByTestId('restore-row')).toContainText(cid);
	await card.getByTestId('restore-row').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await say(page, 'Aleph lists the backup, and the CID is the one from before.', 6300);
	await card.getByTestId('restore-pick').click();
	await expect(card.getByTestId('restore-confirm')).toBeVisible();
	await beat(1200);
	await card.getByTestId('restore-yes').click();
	await expect(card.getByTestId('restore-done')).toBeVisible({ timeout: 60_000 });
	await say(page, 'Restored. The page reloads; the passkey opens the books.', 2500);

	await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 60_000 });
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
	await tab('Payments').click();
	await expect(page.getByTestId('transaction').first()).toBeVisible({ timeout: 60_000 });
	await page.getByTestId('filter-all').click();
	await say(page, 'The bookings are back: same identity, same books, same CID.', 8100);
	await tab('Receipts').click();
	await say(page, 'Receipts too. Nothing here ever had a server.', 8100);
});

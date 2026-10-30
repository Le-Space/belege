// Backup and back, recorded: a passkey makes the books, a bridge on this
// computer fetches six bookings from a bank (a fake one with sample data),
// one sealed backup goes to Aleph (a fake, too) – then this browser forgets
// everything, the passkey brings the identity back, the paying account's
// address finds the backup, and the bookings are back. Every key, address,
// name and amount is made up (@belege/bridge/testing); nothing leaves this
// machine.
//
// A clip (about a minute) for the Belege channel and scene 1 of the Devcon 8
// film. Narrated from LINES by kit/scene.js, in English or, with
// DEMO_LANG=de, in German (the app follows the locale).
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
import { addVirtualAuthenticator, forgetThisDevice } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { openIntegration } from '../e2e/integrations.js';
import { startScene } from './kit/scene.js';

const LANG = process.env.DEMO_LANG === 'de' ? 'de' : 'en';

const EN = {
	intro:
		'Le Space Belege keeps your books only on your own devices. No server holds them. So where is the backup?',
	passkey: 'A passkey makes the books and seals them.',
	bridge:
		'A bridge on this computer does what the app alone cannot: it talks to the bank. Here, a fake bank with sample data.',
	bookings: 'Six bookings, in the books, on this device only.',
	backup:
		'Backup: one sealed file, kept on Aleph. Your device seals and signs; the account pays. Nothing on the way is readable.',
	kept: 'Kept, under its content address. Aleph holds a file it cannot open.',
	forget: 'Now the worst case. This device forgets everything it had. The passkey does not.',
	empty:
		'A device that has lost everything. The passkey brings the identity back: the same DID, and empty books.',
	address:
		'The bridge is gone, and it is not needed. The paying account’s address is all it takes: Aleph lists the backup.',
	restore: 'Restore. The page reloads, and the passkey opens the books.',
	back: 'The bookings are back. Same identity, same books, same file.',
	outro: 'Backup and back: one sealed file on Aleph, and no one but you can open it.'
};

const DE = {
	intro:
		'Le Space Belege hält deine Geschäftsbücher nur auf deinen eigenen Geräten. Kein Server hat sie. Wo ist dann das Backup?',
	passkey: 'Ein Passkey legt die Bücher an und versiegelt sie.',
	bridge:
		'Eine Bridge auf diesem Rechner tut, was die App allein nicht kann: Sie spricht mit der Bank. Hier eine erfundene Bank mit Beispieldaten.',
	bookings: 'Sechs Buchungen, in den Geschäftsbüchern, nur auf diesem Gerät.',
	backup:
		'Backup: eine versiegelte Datei, aufbewahrt auf Aleph. Dein Gerät versiegelt und signiert, das Konto bezahlt. Unterwegs ist nichts lesbar.',
	kept: 'Aufbewahrt, unter ihrer Inhaltsadresse. Aleph hält eine Datei, die es nicht öffnen kann.',
	forget:
		'Jetzt der schlimmste Fall. Dieses Gerät vergisst alles, was es hatte. Der Passkey nicht.',
	empty:
		'Ein Gerät, das alles verloren hat. Der Passkey bringt die Identität zurück: dieselbe DID, und leere Geschäftsbücher.',
	address:
		'Die Bridge ist weg, und sie wird nicht gebraucht. Die Adresse des zahlenden Kontos genügt: Aleph listet das Backup.',
	restore: 'Wiederherstellen. Die Seite lädt neu, und der Passkey öffnet die Bücher.',
	back: 'Die Buchungen sind zurück. Dieselbe Identität, dieselben Geschäftsbücher, dieselbe Datei.',
	outro:
		'Backup und zurück: eine versiegelte Datei auf Aleph, und niemand außer dir kann sie öffnen.'
};

const LINES = LANG === 'de' ? DE : EN;
// The controls the scene finds by their labels.
const LABEL =
	LANG === 'de'
		? {
				create: 'Passkey anlegen',
				pair: 'Koppeln',
				paired: 'gekoppelt',
				sync: 'Jetzt synchronisieren',
				kept: 'von Aleph aufbewahrt'
			}
		: {
				create: 'Create passkey',
				pair: 'Pair',
				paired: 'paired',
				sync: /sync/i,
				kept: 'kept by Aleph'
			};

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege demo backup key').digest('hex');

// Six bookings from the sample bank, two days old.
const booked = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
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
		u(301, '-119,00', 'Wolkenfabrik GmbH', 'SVWZ+Rechnung WF-2026-0917'),
		u(302, '-52,59', 'Stromwerk Nord AG', 'SVWZ+Abschlag Vertrag 123'),
		u(303, '-39,99', 'Mobilfunk Süd GmbH', 'SVWZ+Rechnung MF-44871'),
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
	aleph = await startFakeAleph({
		accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000, rows: [] } }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-video-backup-'));
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
			alephBackup: { configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
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
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('backup and back: a browser that forgets gets its books back from Aleph', async ({
	page,
	context
}, testInfo) => {
	const scene = await startScene(page, context, LINES, { lang: LANG });
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await expect(page.getByTestId('consent-modal')).toBeVisible();
	scene.markStart();
	await scene.say(LINES.intro);
	await acceptConsent(page);

	// The passkey.
	await scene.type(page.getByTestId('passkey-label'), 'Laptop');
	await scene.click(page.getByRole('button', { name: LABEL.create }));
	await expect(page.getByTestId('own-did')).toBeVisible();
	const did = String(await page.getByTestId('own-did').getAttribute('data-did'));
	await scene.say(LINES.passkey);

	// The bridge, and the bank through it.
	await scene.click(page.getByTestId('tab-integrationen'));
	await scene.say(LINES.bridge, { after: 0 });
	await scene.type(page.getByTestId('pairing-code'), pairingCode());
	await scene.click(page.getByRole('button', { name: LABEL.pair, exact: true }));
	await expect(page.getByTestId('bridge-status')).toContainText(LABEL.paired);
	await scene.beat(800);
	await openIntegration(page, 'bank');
	await scene.click(page.getByRole('button', { name: LABEL.sync }).first());
	await expect(page.getByTestId('sync-result')).toBeVisible({ timeout: 60_000 });
	await scene.beat(800);
	await scene.click(page.getByTestId('tab-zahlungen'));
	await expect(page.getByTestId('transaction').first()).toBeVisible();
	await scene.click(page.getByTestId('filter-all'));
	await scene.say(LINES.bookings);

	// The backup.
	await openIntegration(page, 'backup');
	await scene.say(LINES.backup, { after: 0 });
	await scene.click(page.getByTestId('backup-card').getByTestId('backup-now'));
	await expect(page.getByTestId('backup-made')).toContainText(LABEL.kept, { timeout: 60_000 });
	await page.getByTestId('backup-made').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await scene.say(LINES.kept);

	// Forget.
	await scene.say(LINES.forget, { after: 0 });
	await forgetThisDevice(page);
	await page.goto('/');
	await expect(page.getByTestId('consent-modal')).toBeVisible();
	await scene.beat(600);
	await acceptConsent(page);
	await scene.say(LINES.empty, { after: 0 });
	await scene.click(page.getByTestId('passkey-restore'));
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
	await scene.beat(1500);

	// Restore, with the bridge gone: the account's address finds the backup.
	await stopBridge();
	await openIntegration(page, 'backup');
	const card = page.getByTestId('backup-card');
	await expect(card.getByTestId('backup-no-owner')).toBeVisible();
	await scene.say(LINES.address, { after: 0 });
	await scene.type(card.getByTestId('backup-owner'), alephAccountOf(KEY), { delay: 12 });
	await scene.click(card.getByTestId('backup-owner-save'));
	await expect(card.getByTestId('backup-chain-group')).toHaveCount(1, { timeout: 30_000 });
	await card
		.getByTestId('backup-chain-group')
		.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await scene.beat(1500);
	await scene.click(card.getByTestId('backup-restore'));
	await expect(card.getByTestId('restore-confirm')).toBeVisible();
	await scene.say(LINES.restore, { after: 0 });
	await scene.click(card.getByTestId('restore-yes'));
	await expect(card.getByTestId('restore-done')).toBeVisible({ timeout: 60_000 });

	// The page reloads by itself; the passkey opens the books.
	await expect(page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 60_000 });
	await scene.click(page.getByTestId('passkey-unlock'));
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', did);
	await scene.click(page.getByTestId('tab-zahlungen'));
	await expect(page.getByTestId('transaction').first()).toBeVisible({ timeout: 60_000 });
	await scene.click(page.getByTestId('filter-all'));
	await scene.say(LINES.back);
	await scene.say(LINES.outro);
	await scene.finish(testInfo);
});

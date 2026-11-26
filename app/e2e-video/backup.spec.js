// Backup, and back on another device, recorded (#1047): on one stage, two
// laptops. Laptop A makes the books with a passkey, keeps the books' vault on
// Aleph with recovery words, fetches six bookings from a bank through its
// bridge (a fake bank with sample data) and backs them up on Aleph (a fake,
// too). Laptop B is empty – no books, no bridge, nothing typed – and has only
// the same passkey, as a synced passkey is. "Restore with existing passkey"
// and two touches: the passkey's index leads to the vault, the vault's root to
// the books' index, the index to the account the backups are kept for
// (backup/vault-index.js, keeper.js `findBackups`), and the backup brings the
// bookings back. Every key, address, name and amount is made up
// (@belege/bridge/testing); nothing leaves this machine.
//
// A clip (about a minute and a half) for the Belege channel and scene 1 of the
// Devcon 8 film. Narrated from LINES by the kit's stage, in English or, with
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
import { startStage } from '@le-space/video-kit/stage';
import { recordCeremonies, takeCeremonies } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { openIntegration } from '../e2e/integrations.js';
import { BRAND, NIGHT, voice } from './belege.js';

const LANG = process.env.DEMO_LANG === 'de' ? 'de' : 'en';

const EN = {
	intro:
		'Le Space Belege keeps your books only on your own devices. No server holds them. So how do they get onto another laptop?',
	passkey: 'On this laptop, a passkey makes the books and seals them.',
	words:
		'Belege offers recovery words. With them, the books’ vault is kept on Aleph: sealed, and only a passkey of the books or the words open it.',
	bridge: 'A bridge on this laptop talks to the bank. Here, a fake bank with sample data.',
	bookings: 'Six bookings, in the books, on this laptop only.',
	backup:
		'Backup: one sealed file, kept on Aleph. The laptop seals and signs; the account pays. Nothing on the way is readable.',
	kept: 'Kept. Aleph holds a file it cannot open.',
	other:
		'Now another laptop. Nothing on it: no books, no bridge, no address to type. Only the same passkey, synced as passkeys are.',
	restore: 'Restore with existing passkey, and two touches.',
	found:
		'The passkey finds the vault on Aleph, the vault opens the books, and the books name the account their backups are kept for. The same identity, and the backup is listed.',
	pick: 'Restore. The page reloads, and the passkey opens the books.',
	back: 'The bookings are back, on the other laptop. Same identity, same keys.',
	needs:
		'All it takes: the same passkey, or a second one with its own slot; the vault kept on Aleph; and the network on. If every passkey is lost, the recovery words open the books.',
	outro: 'Backup, and back on another device: with the passkey alone.'
};

const DE = {
	intro:
		'Le Space Belege hält deine Geschäftsbücher nur auf deinen eigenen Geräten. Kein Server hat sie. Wie kommen sie dann auf einen anderen Laptop?',
	passkey: 'Auf diesem Laptop legt ein Passkey die Bücher an und versiegelt sie.',
	words:
		'Belege bietet Wiederherstellungswörter an. Mit ihnen liegt der Tresor der Geschäftsbücher auf Aleph: versiegelt, und nur ein Passkey der Bücher oder die Wörter öffnen ihn.',
	bridge:
		'Eine Bridge auf diesem Laptop spricht mit der Bank. Hier eine erfundene Bank mit Beispieldaten.',
	bookings: 'Sechs Buchungen, in den Geschäftsbüchern, nur auf diesem Laptop.',
	backup:
		'Backup: eine versiegelte Datei, aufbewahrt auf Aleph. Der Laptop versiegelt und signiert, das Konto bezahlt. Unterwegs ist nichts lesbar.',
	kept: 'Aufbewahrt. Aleph hält eine Datei, die es nicht öffnen kann.',
	other:
		'Jetzt ein anderer Laptop. Nichts darauf: keine Bücher, keine Bridge, keine Adresse zum Eintippen. Nur derselbe Passkey, synchronisiert, wie Passkeys es sind.',
	restore: 'Mit vorhandenem Passkey wiederherstellen, und zweimal berühren.',
	found:
		'Der Passkey findet den Tresor auf Aleph, der Tresor öffnet die Bücher, und die Bücher nennen das Konto, für das ihre Backups aufbewahrt werden. Dieselbe Identität, und das Backup steht in der Liste.',
	pick: 'Wiederherstellen. Die Seite lädt neu, und der Passkey öffnet die Bücher.',
	back: 'Die Buchungen sind zurück, auf dem anderen Laptop. Dieselbe Identität, dieselben Schlüssel.',
	needs:
		'Mehr braucht es nicht: denselben Passkey oder einen zweiten mit eigenem Fach, den Tresor auf Aleph und das Netzwerk an. Ist jeder Passkey verloren, öffnen die Wiederherstellungswörter die Bücher.',
	outro: 'Backup, und zurück auf einem anderen Gerät: mit dem Passkey allein.'
};

const LINES = LANG === 'de' ? DE : EN;
// The stage's texts, and the controls the scene finds by their labels.
const W =
	LANG === 'de'
		? {
				a: 'Laptop',
				b: 'Anderer Laptop',
				create: 'Passkey anlegen',
				pair: 'Koppeln',
				paired: 'gekoppelt',
				sync: 'Jetzt synchronisieren',
				kept: 'von Aleph aufbewahrt',
				chapters: [
					'Ein Laptop: Bücher und Backup',
					'Ein anderer Laptop, nur der Passkey',
					'Die Buchungen sind zurück'
				]
			}
		: {
				a: 'Laptop',
				b: 'Another laptop',
				create: 'Create passkey',
				pair: 'Pair',
				paired: 'paired',
				sync: /sync/i,
				kept: 'kept by Aleph',
				chapters: [
					'One laptop: books and backup',
					'Another laptop, the passkey alone',
					'The bookings are back'
				]
			};

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const KEY = createHash('sha256').update('belege demo backup key').digest('hex');
// Made up: the answer the one synced passkey gives on both laptops.
const PRF = Array.from({ length: 32 }, (_, i) => (i * 41 + 7) % 256);

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
		u(301, '-119,00', 'Wolkenfabrik Hosting GmbH', 'SVWZ+Rechnung WF-2026-0917'),
		u(302, '-52,59', 'Stromwerk Test AG', 'SVWZ+Abschlag Vertrag 123'),
		u(303, '-39,99', 'Mobilfunk Süd GmbH', 'SVWZ+Rechnung MF-44871'),
		u(304, '-22,42', 'Kaffeerösterei Nordlicht GmbH', 'SVWZ+Kartenzahlung'),
		u(305, '-500,00', 'Musterfirma UG', 'SVWZ+Umbuchung Konto B', 'Überweisungsauftrag'),
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

/**
 * A laptop of the stage: a virtual authenticator, Aleph as the fake, and the
 * synced passkey's PRF answer – as e2e/devices.js gives it with `syncedPrf`,
 * but without device sync: the books reach laptop B only through the backup.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 */
async function laptop(context, page) {
	await context.addInitScript(
		({ prf, alephUrl }) => {
			localStorage.setItem('belege.e2e.alephUrl', alephUrl);
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			// No "Weiter" between the passkey prompts (#429), as addVirtualAuthenticator does.
			/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
			const container = navigator.credentials;
			for (const name of /** @type {const} */ (['create', 'get'])) {
				const ask = container[name].bind(container);
				container[name] = async (/** @type {any} */ options) => {
					const credential = /** @type {any} */ (await ask(options));
					if (!credential || !options?.publicKey?.extensions?.prf) return credential;
					const results = credential.getClientExtensionResults.bind(credential);
					const first = Uint8Array.from(prf).buffer;
					credential.getClientExtensionResults = () => {
						const r = results();
						return { ...r, prf: { ...r.prf, enabled: true, results: { first } } };
					};
					return credential;
				};
			}
		},
		{ prf: PRF, alephUrl: aleph.url }
	);
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
	page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
	return { context, page, cdp, authenticatorId };
}

test('backup, and back on another device with the passkey alone', async ({ browser }, testInfo) => {
	test.setTimeout(900_000);
	const context = { locale: LANG === 'de' ? 'de-DE' : 'en-GB' };
	const stage = await startStage(browser, testInfo, LINES, {
		voice,
		lang: LANG,
		night: NIGHT,
		accent: BRAND.palette.accent,
		font: BRAND.font,
		devices: {
			a: { label: W.a, x: 40, y: 130, width: 900, height: 820, zoom: 1, context },
			b: { label: W.b, x: 980, y: 130, width: 900, height: 820, zoom: 1, context }
		}
	});
	const a = await laptop(stage.devices.a.context, stage.devices.a.page);
	const b = await laptop(stage.devices.b.context, stage.devices.b.page);
	// Laptop B is another machine: laptop A's bridge on 127.0.0.1 is out of its reach.
	await b.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (r) => r.abort('connectionrefused'));
	await recordCeremonies(b.page);
	/** @param {number} n */
	const chapter = (n) => stage.chapter(W.chapters[n - 1], { n });

	try {
		await a.page.goto('/');
		await b.page.goto('/');
		await expect(a.page.getByTestId('consent-modal')).toBeVisible();
		await expect(b.page.getByTestId('consent-modal')).toBeVisible();

		// The film.
		stage.markStart();
		await stage.focus('a');
		await stage.say(LINES.intro);
		await chapter(1);
		await acceptConsent(a.page);

		// The passkey.
		await stage.type(a.page, a.page.getByTestId('passkey-label'), W.a);
		await stage.click(a.page, a.page.getByRole('button', { name: W.create }));
		await expect(a.page.getByTestId('own-did')).toBeVisible();
		const did = String(await a.page.getByTestId('own-did').getAttribute('data-did'));
		await stage.say(LINES.passkey);

		// Recovery words, and with them the vault on Aleph.
		await expect(a.page.getByTestId('words-offer')).toBeVisible();
		await stage.sayWhile(LINES.words, async () => {
			await stage.click(a.page, a.page.getByTestId('words-offer-go'));
			const keys = a.page.getByTestId('keys-card');
			await stage.click(a.page, keys.getByTestId('words-start'));
			const shown = keys.getByTestId('words-word');
			await expect(shown).toHaveCount(24);
			const words = await shown.allTextContents();
			await stage.click(a.page, keys.getByTestId('words-written'));
			await stage.click(a.page, keys.getByTestId('words-next'));
			const inputs = keys.getByTestId('words-ask-input');
			await expect(inputs).toHaveCount(3);
			await expect(keys.getByTestId('words-publish')).toBeChecked();
			const positions = await inputs.evaluateAll((els) =>
				els.map((e) => Number(e.getAttribute('data-position')))
			);
			for (let i = 0; i < 3; i++)
				await stage.type(a.page, inputs.nth(i), words[positions[i] - 1], { delay: 40 });
			await stage.click(a.page, keys.getByTestId('words-confirm'));
			await expect(keys.getByTestId('words-done')).toBeVisible({ timeout: 30_000 });
			await keys.getByTestId('words-done').scrollIntoViewIfNeeded();
		});

		// The bridge, and the bank through it.
		await stage.click(a.page, a.page.getByTestId('tab-integrationen'));
		await stage.say(LINES.bridge, { after: 0 });
		await stage.type(a.page, a.page.getByTestId('pairing-code'), pairingCode());
		await stage.click(a.page, a.page.getByRole('button', { name: W.pair, exact: true }));
		await expect(a.page.getByTestId('bridge-status')).toContainText(W.paired);
		await stage.beat(800);
		await openIntegration(a.page, 'bank');
		await stage.click(a.page, a.page.getByRole('button', { name: W.sync }).first());
		await stage.cutWhile(() =>
			expect(a.page.getByTestId('sync-result')).toBeVisible({ timeout: 60_000 })
		);
		await stage.beat(800);
		await stage.click(a.page, a.page.getByTestId('tab-zahlungen'));
		await expect(a.page.getByTestId('transaction').first()).toBeVisible();
		await stage.click(a.page, a.page.getByTestId('filter-all'));
		await expect(a.page.getByTestId('transaction')).toHaveCount(6);
		await stage.say(LINES.bookings);

		// The backup; the books' index on Aleph then names the paying account.
		const indexBefore = JSON.stringify([...aleph.kept.values()]);
		await openIntegration(a.page, 'backup');
		await stage.say(LINES.backup, { after: 0 });
		await stage.click(a.page, a.page.getByTestId('backup-card').getByTestId('backup-now'));
		await stage.cutWhile(() =>
			expect(a.page.getByTestId('backup-made')).toContainText(W.kept, { timeout: 60_000 })
		);
		await a.page
			.getByTestId('backup-made')
			.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await stage.say(LINES.kept);
		await expect
			.poll(() => JSON.stringify([...aleph.kept.values()]), { timeout: 30_000 })
			.not.toBe(indexBefore);
		// … sealed: the account is in no index in the clear.
		expect(JSON.stringify([...aleph.kept.values()]).toLowerCase()).not.toContain(
			alephAccountOf(KEY).toLowerCase()
		);

		// Laptop B: nothing but the same passkey. The bridge is gone, too.
		await stopBridge();
		const { credentials } = await a.cdp.send('WebAuthn.getCredentials', {
			authenticatorId: a.authenticatorId
		});
		expect(credentials).toHaveLength(1);
		await b.cdp.send('WebAuthn.addCredential', {
			authenticatorId: b.authenticatorId,
			credential: credentials[0]
		});
		await stage.focus('b');
		await chapter(2);
		await stage.say(LINES.other);
		await acceptConsent(b.page);
		await takeCeremonies(b.page);
		await stage.say(LINES.restore, { after: 0 });
		await stage.click(b.page, b.page.getByTestId('passkey-restore'));
		await stage.cutWhile(() =>
			expect(b.page.getByTestId('own-did')).toHaveAttribute('data-did', did, { timeout: 60_000 })
		);
		// Two touches, as the line says.
		expect((await takeCeremonies(b.page)).filter((c) => c.ok)).toHaveLength(2);

		// The backup, listed for the account the books' index names.
		await openIntegration(b.page, 'backup');
		const card = b.page.getByTestId('backup-card');
		await stage.cutWhile(() =>
			expect(card.getByTestId('backup-chain-group')).toHaveCount(1, { timeout: 30_000 })
		);
		await expect(card.getByTestId('backup-owner')).toHaveCount(0);
		await card
			.getByTestId('backup-chain-group')
			.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await stage.say(LINES.found);
		await stage.click(b.page, card.getByTestId('backup-restore'));
		await expect(card.getByTestId('restore-confirm')).toBeVisible();
		await stage.say(LINES.pick, { after: 0 });
		await stage.click(b.page, card.getByTestId('restore-yes'));
		await stage.cutWhile(() =>
			expect(card.getByTestId('restore-done')).toBeVisible({ timeout: 60_000 })
		);

		// The page reloads by itself; the passkey opens the books.
		await expect(b.page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 60_000 });
		await stage.click(b.page, b.page.getByTestId('passkey-unlock'));
		await expect(b.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await chapter(3);
		await stage.click(b.page, b.page.getByTestId('tab-zahlungen'));
		await expect(b.page.getByTestId('transaction').first()).toBeVisible({ timeout: 60_000 });
		await stage.click(b.page, b.page.getByTestId('filter-all'));
		await expect(b.page.getByTestId('transaction')).toHaveCount(6);
		await stage.focus('a', 'b');
		await stage.say(LINES.back);
		await stage.say(LINES.needs);
		await stage.say(LINES.outro);
	} finally {
		await stage.finish({ name: `backup.${LANG}` });
	}
});

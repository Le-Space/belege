// Appointments from invitations (#213, step 4c), end to end: a fake mail
// server with an invitation to the accounting address, its calendar part
// read by the real bridge in test mode, the appointment on Reisen, and a
// trip made from it with its place, occasion and times. The organiser, the
// attendees and the links never reach the app. Everything is made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	INVITATION,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const BASE = new Date(Date.now() - 2 * 864e5);

/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	imap = await startFakeImap({ storage: sampleMailbox({ base: BASE, invitation: true }) });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-appointments-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none',
				accountingAddress: ACCOUNTING
			}
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	if (bridge && bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await imap?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('an invitation’s appointment becomes a trip, with nobody’s name in the books', async ({
	page
}) => {
	const tab = (/** @type {string} */ name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	await tab('Belege').click();
	await page.getByTestId('mail-read-after').uncheck();
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toContainText('Termine aus Einladungen: 1');
	// A second fetch keeps the one it has.
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).not.toContainText('Termine aus Einladungen');

	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('11');
	const appointment = page.getByTestId('reisen-appointment');
	await expect(appointment).toHaveCount(1);
	await expect(appointment).toContainText('Fachtagung Beispiel 2026');
	await expect(appointment).toContainText('Kongresshaus Musterstadt, Saal 2');
	await expect(appointment).toContainText('05.11.2026 09:30 – 05.11.2026 17:15');
	const content = await page.content();
	for (const secret of [INVITATION.organizer, INVITATION.attendee, 'geheimtoken']) {
		expect(content.includes(secret), secret).toBe(false);
	}

	await appointment.getByTestId('reisen-appointment-trip').click();
	await expect(page.getByTestId('reise-destination')).toHaveValue(
		'Kongresshaus Musterstadt, Saal 2'
	);
	await expect(page.getByTestId('reise-reason')).toHaveValue('Fachtagung Beispiel 2026');
	await expect(page.getByTestId('reise-start')).toHaveValue('2026-11-05T09:30');
	await expect(page.getByTestId('reise-end')).toHaveValue('2026-11-05T17:15');
	await expect(page.getByTestId('reise-appointment')).toContainText('Fachtagung Beispiel 2026');
	// Its occasion already taken: nothing to take again.
	await expect(page.getByTestId('reise-appointment-take')).toHaveCount(0);

	// On Reisen the appointment is on a trip now, not offered any more.
	await page.getByRole('link', { name: '← Alle Reisen' }).click();
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('11');
	await expect(page.getByTestId('reisen-trip')).toHaveCount(1);
	await expect(page.getByTestId('reisen-appointment')).toHaveCount(0);
});

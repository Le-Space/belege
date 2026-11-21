// Appointments from invitations (#213, step 4c), end to end: a fake mail
// server with an invitation to the accounting address, its calendar part
// read by the real bridge in test mode, the appointment on Reisen, and a
// trip made from it with its place, occasion and times. The organiser, the
// attendees and the links never reach the app. Everything is made up.
import { test, expect } from '@playwright/test';

import { defaultConfig } from '@belege/bridge';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	INVITATION,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const BASE = new Date(Date.now() - 2 * 864e5);

/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	imap = await startFakeImap({ storage: sampleMailbox({ base: BASE, invitation: true }) });
	bridge = await startBridge({
		name: 'appointments',
		config: {
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none',
				accountingAddress: ACCOUNTING
			}
		},
		env: { BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await imap?.close();
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

	await tab('Integrationen').click();
	await pairBridge(page, bridge);

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

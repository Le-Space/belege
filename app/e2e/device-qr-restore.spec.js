// A phone that has never opened Belege joins the laptop's books by QR in the
// own Wi-Fi, with no Aleph at all (#957): no vault index and no backup there.
// The laptop makes the books in "Ohne Relay, per QR"; the phone has only the
// synced passkey, restores with it in the same mode, is told that Aleph was
// not asked, opens the passkey's books, and gets the booking by QR. Every
// request and WebSocket of both browsers is recorded: nothing leaves this
// machine – no Aleph, no relay, no STUN server.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('a new phone restores the passkey by QR, without Aleph, and gets the books', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const laptop = await device(browser, { mode: 'qr', syncedPrf: true });
	const phone = await device(browser, { mode: 'qr', syncedPrf: true });
	/** @type {string[]} */
	const outside = [];
	// This machine's own servers (the page, the test bridge) do not count.
	const local = (/** @type {string} */ url) =>
		/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
	for (const d of [laptop, phone]) {
		d.context.on('request', (r) => {
			if (!local(r.url())) outside.push(r.url());
		});
		d.page.on('websocket', (ws) => outside.push(`websocket ${ws.url()}`));
	}
	try {
		// The laptop: a passkey and a booking.
		await laptop.page.goto('/');
		await acceptConsent(laptop.page);
		await laptop.page.getByTestId('passkey-label').fill('E2E Neues Telefon');
		await laptop.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(laptop.page.getByTestId('own-did')).toBeVisible();
		const did = String(await laptop.page.getByTestId('own-did').getAttribute('data-did'));
		await tab(laptop.page, 'Zahlungen');
		await laptop.page.getByTestId('add-test-transaction').click();
		await expect(laptop.page.getByTestId('transaction')).toHaveCount(1);

		// The phone: nothing stored, only the synced passkey.
		const { credentials } = await laptop.cdp.send('WebAuthn.getCredentials', {
			authenticatorId: laptop.authenticatorId
		});
		await phone.cdp.send('WebAuthn.addCredential', {
			authenticatorId: phone.authenticatorId,
			credential: credentials[0]
		});
		await phone.page.goto('/');
		await acceptConsent(phone.page);
		await phone.page.getByTestId('passkey-restore').click();
		// Aleph was not asked, and the question says why.
		await expect(phone.page.getByTestId('new-books-dialog')).toBeVisible();
		await expect(phone.page.getByTestId('new-books-why')).toContainText(
			'nur im eigenen Netz mit deinen Geräten'
		);
		await phone.page.getByTestId('new-books-open').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(0);

		// The laptop shows an invite, the phone scans it, the laptop takes the answer.
		await openIntegration(laptop.page, 'geraete');
		await laptop.page.getByTestId('devices-qr-invite').click();
		const invite = laptop.page.getByTestId('devices-qr-code');
		await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
		const offer = String(await invite.getAttribute('data-code'));
		await phone.page.getByTestId('local-only').click();
		await phone.page.getByTestId('network-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, offer);
		const answer = phone.page.getByTestId('network-qr-code');
		await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 30_000 });
		const reply = String(await answer.getAttribute('data-code'));
		await laptop.page.getByTestId('devices-qr-paste').fill(reply);
		await laptop.page.getByTestId('devices-qr-use').click();
		await expect(laptop.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
			timeout: 60_000
		});
		await phone.page.keyboard.press('Escape');

		// The books arrive on the phone, and its own booking on the laptop.
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });
		await phone.page.getByTestId('add-test-transaction').click();
		await tab(laptop.page, 'Zahlungen');
		await expect(laptop.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });

		// Nobody else was asked: no Aleph, no relay, no WebSocket at all.
		expect(outside).toEqual([]);
	} finally {
		await laptop.context.close();
		await phone.context.close();
	}
});

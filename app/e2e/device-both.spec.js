// "Beides" (issue #148, step 2d): public relays, the own bridge's relay and
// QR at once – but a device the books do not know yet only over the own
// network. Here there is no bridge relay: the phone types the Mac's id and is
// turned away, then the two exchange codes, connect and sync. After a reload
// the QR connection is gone, and the phone, now known, meets the Mac again
// over the (test) public relay.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('a new device only by QR; once known, over the public relay too', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser, { mode: 'both' });
	const phone = await device(browser, { mode: 'both' });
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Geräte Beides');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await tab(mac.page, 'Zahlungen');
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
		await samePasskey(mac, phone, did);

		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-both')).toBeVisible();
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();

		// The phone types the Mac's id: over a public relay a new device is turned away.
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-add-input').fill(macId);
		await phone.page.getByTestId('devices-add').click();
		await expect(phone.page.getByRole('alert')).toContainText(
			'per QR-Code oder über den Relay deiner Bridge'
		);
		await expect(phone.page.getByTestId('devices-item')).toHaveCount(0);

		// By QR, in the room: connected, proved, added on both sides.
		await mac.page.getByTestId('devices-qr-invite').click();
		const invite = mac.page.getByTestId('devices-qr-code');
		await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
		await phone.page
			.getByTestId('devices-qr-paste')
			.fill(String(await invite.getAttribute('data-code')));
		await phone.page.getByTestId('devices-qr-use').click();
		const answer = phone.page.getByTestId('devices-qr-code');
		await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 30_000 });
		await mac.page
			.getByTestId('devices-qr-paste')
			.fill(String(await answer.getAttribute('data-code')));
		await mac.page.getByTestId('devices-qr-use').click();
		await expect(mac.page.getByTestId('devices-qr-connected')).toBeVisible({ timeout: 60_000 });
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toHaveText(/^verbunden/, { timeout: 60_000 });

		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });

		// A reload ends the QR connection; the phone, known now, meets the Mac over the public relay.
		await phone.page.reload();
		await phone.page.getByTestId('passkey-unlock').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		await openIntegration(phone.page, 'geraete');
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toHaveText(/^verbunden/, { timeout: 90_000 });
		await tab(phone.page, 'Zahlungen');
		await phone.page.getByTestId('add-test-transaction').click();
		await expect(phone.page.getByTestId('transaction')).toHaveCount(2);
		await tab(mac.page, 'Zahlungen');
		await expect(mac.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

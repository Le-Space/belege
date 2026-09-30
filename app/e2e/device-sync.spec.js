// Two devices of one passkey keep the same books (issue #123): two browser
// contexts stand for a Mac and a phone. The passkey is copied from one
// virtual authenticator to the other, as a synced passkey is. Its PRF secret
// does not come along: Chromium's virtual authenticator keeps the hmac-secret
// keys (random at creation) only in its own registration, the DevTools
// `WebAuthn.Credential` has no field for them, and `addCredential` injects a
// credential without them, so a copied credential (even one removed and added
// back to the same authenticator) answers with no PRF result. Both devices
// therefore get the same PRF answer through the E2E-only hook
// (passkey-identity.js). Both switch device
// sync on, meet through the local test relay (e2e/relay.js) once one has
// scanned the other's QR code, and then a booking written on either shows on
// the other. Last, one removes the other.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';
import { RELAY_IDENTIFY_LOG } from './relay.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('a booking written on one device shows on the other, both ways', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	const phone = await device(browser);
	try {
		// The Mac: a new passkey, and the books open online.
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Geräte');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = await mac.page.getByTestId('own-did').getAttribute('data-did');
		// A booking the Mac has before the phone ever connects: the late joiner's case.
		await tab(mac.page, 'Zahlungen');
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);

		// The same passkey on the phone, as a synced passkey is.
		await samePasskey(mac, phone, String(did));

		// Both online; the Mac's id typed on the phone.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{
				timeout: 30_000
			}
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
		// The Mac shows its id as a QR code; the phone scans it.
		await mac.page.getByTestId('devices-qr-toggle').click();
		await expect(mac.page.getByTestId('devices-qr').locator('svg')).toBeVisible();
		const code = String(await mac.page.getByTestId('devices-qr').getAttribute('data-code'));
		expect(code).toBe(`belege-device:${macId}`);
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-scan').click();
		await expect(phone.page.getByTestId('devices-scan-view')).toBeVisible();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, code);
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toContainText('verbunden', { timeout: 60_000 });
		// The header says the network is on, and that an own device is connected.
		const badge = phone.page.getByTestId('local-only');
		await expect(badge).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
		await expect(badge).toContainText('Im Netz: eigene Geräte');
		await expect(badge).toHaveAttribute('title', /Eigene Geräte: 1 verbunden/);
		// "Alles pausieren" in the badge's menu: at once, and the Mac is no longer connected …
		await badge.click();
		await phone.page.getByTestId('network-pause').click();
		await expect(badge).toHaveAttribute('data-state', 'paused');
		await expect(badge).toHaveText('Netzwerk pausiert');
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toHaveText('nicht verbunden', { timeout: 30_000 });
		// … and "Fortsetzen" connects it again, in this session.
		await badge.click();
		await phone.page.getByTestId('network-resume').click();
		await expect(badge).toHaveAttribute('data-state', 'connected', { timeout: 60_000 });
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toHaveText(/^verbunden/, { timeout: 60_000 });
		// The phone's own record replicated to the Mac, which now knows it too.
		await expect(mac.page.getByTestId('devices-item')).toHaveCount(1, { timeout: 60_000 });

		// What the Mac had before shows on the phone …
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });
		await expect(phone.page.getByTestId('transaction')).toContainText('Testpartner GmbH');

		// … a booking on the phone shows on the Mac …
		await phone.page.getByTestId('add-test-transaction').click();
		await expect(phone.page.getByTestId('transaction')).toHaveCount(2);
		await tab(mac.page, 'Zahlungen');
		await expect(mac.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });

		// What the relay learned from identify while all that went through it (#209):
		// it knows the Mac, and that it speaks identify and the relay's protocols –
		// not which databases there are, not which app this is, not even that it
		// syncs anything. It was not offered the device proof either.
		const told = readFileSync(RELAY_IDENTIFY_LOG, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line))
			.filter((entry) => entry.peer === macId);
		expect(told.length).toBeGreaterThan(0);
		const protocols = [...new Set(told.flatMap((entry) => entry.protocols))];
		expect(protocols).toContain('/ipfs/id/1.0.0');
		expect(
			protocols.filter((p) => !p.startsWith('/ipfs/id/') && !p.startsWith('/libp2p/circuit/relay/'))
		).toEqual([]);
		expect(told.filter((entry) => entry.offered)).toEqual([]);
		// Nor which browser on which system this is.
		const agents = [...new Set(told.map((entry) => entry.agent).filter(Boolean))];
		expect(agents).toEqual(['js-libp2p']);

		// … and one more on the Mac, now that both are connected, on the phone.
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(phone.page.getByTestId('transaction')).toHaveCount(3, { timeout: 90_000 });

		// The Mac removes the phone: the Mac lets go of it, and the phone, once
		// the removal has reached it, switches its sync off.
		await openIntegration(mac.page, 'geraete');
		await mac.page.getByTestId('devices-remove').click();
		await mac.page.getByTestId('devices-remove-confirm').click();
		await expect(mac.page.getByTestId('devices-item')).toHaveCount(0);
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-removed')).toBeVisible({ timeout: 60_000 });
		expect(await phone.page.evaluate(() => localStorage.getItem('belege.device-sync'))).toBeNull();
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

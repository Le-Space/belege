// Two devices meet without any relay (issue #148, "Ohne Relay, per QR"): the
// Mac shows an invite, the phone scans it and shows its answer, the Mac takes
// that back (pasted here, as the fallback beside the camera) – and they are
// connected directly, the phone proved the passkey, and the books sync. In
// this mode nothing asks Aleph, no WebSocket opens (no relay) and no STUN
// server is asked: checked on every request and WebSocket of both contexts.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('two devices connect by QR, without a relay, and sync', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser, { mode: 'qr' });
	const phone = await device(browser, { mode: 'qr' });
	/** @type {string[]} */
	const outside = [];
	// This machine's own servers (the page, the test bridge) do not count.
	const local = (/** @type {string} */ url) =>
		/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
	for (const d of [mac, phone]) {
		d.context.on('request', (r) => {
			if (!local(r.url())) outside.push(r.url());
		});
		d.page.on('websocket', (ws) => outside.push(`websocket ${ws.url()}`));
	}
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Geräte QR');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await tab(mac.page, 'Zahlungen');
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
		await samePasskey(mac, phone, did);

		// The header menu says which way devices meet.
		await mac.page.getByTestId('local-only').click();
		await expect(mac.page.getByTestId('network-mode-qr')).toBeChecked();
		await mac.page.keyboard.press('Escape');

		// The Mac: an invite.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-qr-mode')).toBeVisible();
		await mac.page.getByTestId('devices-qr-invite').click();
		const invite = mac.page.getByTestId('devices-qr-code');
		await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
		await expect(invite.locator('svg')).toBeVisible();
		const offer = String(await invite.getAttribute('data-code'));

		// The phone scans it and shows its answer.
		await openIntegration(phone.page, 'geraete');
		await phone.page.getByTestId('devices-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, offer);
		const answer = phone.page.getByTestId('devices-qr-code');
		await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 30_000 });
		const reply = String(await answer.getAttribute('data-code'));

		// The Mac takes the answer: connected, the phone proved the passkey, and it is added.
		await mac.page.getByTestId('devices-qr-paste').fill(reply);
		await mac.page.getByTestId('devices-qr-use').click();
		await expect(mac.page.getByTestId('devices-qr-connected')).toBeVisible({ timeout: 60_000 });
		await expect(mac.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
			timeout: 30_000
		});
		// The phone added the Mac too, once the Mac proved the passkey to it.
		await expect(phone.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
			timeout: 60_000
		});

		// The books sync, both ways.
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });
		await phone.page.getByTestId('add-test-transaction').click();
		await tab(mac.page, 'Zahlungen');
		await expect(mac.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });

		// Nobody else was asked: no Aleph, no relay, no WebSocket at all (not even the local test relay).
		expect(outside).toEqual([]);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

// "Ohne Relay, per QR" by link (sync/qr-link-url.js): the Mac's invite is a
// whole URL, so a phone's camera opens Belege at it. The phone loads it, the
// invite leaves the address at once, the passkey opens the books, and the
// network menu opens with the answer – which the Mac takes as before.
import { test, expect } from '@playwright/test';
import { acceptConsent } from './consent.js';
import { device, samePasskey } from './devices.js';
import { openIntegration } from './integrations.js';

test('a phone opens the invite link, unlocks, and its menu answers it', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser, { mode: 'qr' });
	const phone = await device(browser, { mode: 'qr' });
	/** @type {string[]} the addresses the page asked for: the invite never among them */
	const asked = [];
	phone.context.on('request', (r) => asked.push(r.url()));
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Geräte Link');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await samePasskey(mac, phone, did);

		// The Mac's invite: a link to this page, the code in the fragment.
		await openIntegration(mac.page, 'geraete');
		await mac.page.getByTestId('devices-qr-invite').click();
		const invite = mac.page.getByTestId('devices-qr-code');
		await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
		const offer = String(await invite.getAttribute('data-code'));
		const link = String(await invite.getAttribute('data-link'));
		const origin = new URL(mac.page.url()).origin;
		expect(link).toBe(`${origin}/#qr=${encodeURIComponent(offer)}`);

		// The phone's camera opens it, as a page of its own: the invite leaves the
		// address at once, and the passkey opens the books.
		await phone.page.goto('/robots.txt');
		await phone.page.goto(link);
		await expect.poll(() => new URL(phone.page.url()).hash).toBe('');
		await phone.page.getByTestId('passkey-unlock').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', did);
		// Unlocked: the menu opens on its own and answers, saying the invite came by link.
		const answer = phone.page.getByTestId('network-qr-code');
		await expect(answer).toHaveAttribute('data-phase', 'answer', { timeout: 30_000 });
		await expect(phone.page.getByTestId('network-qr-by-link')).toBeVisible();
		const reply = String(await answer.getAttribute('data-code'));
		// The answer is a bare code (the Mac is open already), and the invite was never sent anywhere.
		expect(reply).not.toContain('://');
		expect(asked.some((u) => u.includes(offer.slice(0, 24)) || u.includes('#qr='))).toBe(false);

		// The Mac takes the answer: both connected, the passkey proved.
		await mac.page.getByTestId('devices-qr-paste').fill(reply);
		await mac.page.getByTestId('devices-qr-use').click();
		await expect(mac.page.getByTestId('devices-qr-connected')).toBeVisible({ timeout: 60_000 });
		await expect(mac.page.getByTestId('devices-item-state')).toHaveText('verbunden · direkt', {
			timeout: 30_000
		});
		// The tab forgot the invite: a reload does not answer it again.
		await expect
			.poll(() => phone.page.evaluate(() => sessionStorage.getItem('belege.qr.invite')))
			.toBeNull();
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

test('a link on a device that meets by relay: the menu offers the switch, nothing changes by itself', async ({
	browser
}) => {
	test.setTimeout(180_000);
	const phone = await device(browser);
	try {
		await phone.page.goto('/');
		await acceptConsent(phone.page);
		await phone.page.getByTestId('passkey-label').fill('E2E Link Umstellen');
		await phone.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(phone.page.getByTestId('own-did')).toBeVisible();
		// An invite by link while this device meets by the public relays: the menu
		// says so and offers the switch – nothing changes on its own.
		await phone.page.evaluate(() => {
			sessionStorage.setItem(
				'belege.qr.invite',
				JSON.stringify({ code: 'not-a-real-invite', at: Date.now() })
			);
		});
		await phone.page.goto('/');
		await phone.page.getByTestId('passkey-unlock').click();
		const box = phone.page.getByTestId('network-qr-link');
		await expect(box).toBeVisible({ timeout: 30_000 });
		await expect(phone.page.getByTestId('network-mode-qr')).not.toBeChecked();
		await expect(box.getByTestId('network-qr-link-switch')).toBeVisible();
		// "Verwerfen" forgets it.
		await box.getByTestId('network-qr-link-dismiss').click();
		await expect(box).toHaveCount(0);
		expect(await phone.page.evaluate(() => sessionStorage.getItem('belege.qr.invite'))).toBeNull();
	} finally {
		await phone.context.close();
	}
});

// Three devices, three passkeys, one vault, in the own network by QR, with no
// Aleph (#962): the laptop makes the books; a phone and an office laptop, each
// with a passkey of its own and nothing stored, scan the laptop's invite and
// show their answer; the laptop asks "Zulassen?" and hands each the vault;
// their books open and their own nodes connect over the same exchange. The
// bookings reach all three, the vault's record reaches all three (three
// passkeys under Einstellungen → Schlüssel), and no browser sends a request
// beyond this machine – no Aleph, no relay, no STUN. A refusal hands over
// nothing. Made-up bookings.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openDevicesAdvanced, openIntegration } from './integrations.js';
import { openSettings } from './settings.js';
import { device } from './devices.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();
/** Made up: each passkey's own PRF answer. @param {number} n */
const prfOf = (n) => Array.from({ length: 32 }, (_, i) => (i * 29 + n * 53) % 256);

/** @param {import('@playwright/test').Browser} browser @param {number} n */
const ownDevice = (browser, n) => device(browser, { mode: 'qr', prf: prfOf(n) });

/** @param {Awaited<ReturnType<typeof device>>[]} devices */
function recordOutside(devices) {
	/** @type {string[]} */
	const outside = [];
	// This machine's own servers (the page, the test bridge) do not count.
	const local = (/** @type {string} */ url) =>
		/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
	for (const d of devices) {
		d.context.on('request', (r) => {
			if (!local(r.url())) outside.push(r.url());
		});
		d.page.on('websocket', (ws) => outside.push(`websocket ${ws.url()}`));
	}
	return outside;
}

/**
 * A new device with its own passkey asks the laptop; the laptop answers.
 *
 * @param {Awaited<ReturnType<typeof device>>} laptop
 * @param {Awaited<ReturnType<typeof device>>} fresh
 * @param {string} label
 * @param {boolean} allow
 */
async function join(laptop, fresh, label, allow = true) {
	await fresh.page.goto('/');
	await acceptConsent(fresh.page);
	await fresh.page.getByTestId('own-join-open').locator('summary').click();
	await fresh.page.getByTestId('own-join-label').fill(label);
	await fresh.page.getByTestId('own-join-start').click();

	await openIntegration(laptop.page, 'geraete');
	// With a device known, the invite is under "Erweitert".
	await openDevicesAdvanced(laptop.page);
	await laptop.page.getByTestId('devices-qr-invite').click();
	const invite = laptop.page.getByTestId('devices-qr-code');
	await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
	await fresh.page
		.getByTestId('own-join-paste')
		.fill(String(await invite.getAttribute('data-code')));
	await fresh.page.getByTestId('own-join-use').click();

	const answer = fresh.page.getByTestId('own-join-code');
	await expect(answer).toBeVisible({ timeout: 30_000 });
	await laptop.page
		.getByTestId('devices-qr-paste')
		.fill(String(await answer.getAttribute('data-code')));
	await laptop.page.getByTestId('devices-qr-use').click();

	const dialog = laptop.page.getByTestId('handover-dialog');
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	// Both screens name both devices alike.
	const here = String(await fresh.page.getByTestId('own-join-compare').textContent());
	for (const id of String(await laptop.page.getByTestId('handover-compare').textContent()).match(
		/…\S{6}/g
	) ?? []) {
		expect(here).toContain(id);
	}
	await laptop.page.getByTestId(allow ? 'handover-allow' : 'handover-deny').click();
	await expect(dialog).toBeHidden();
}

test('three devices with three passkeys share one vault by QR, without Aleph', async ({
	browser
}) => {
	test.setTimeout(360_000);
	const laptop = await ownDevice(browser, 1);
	const phone = await ownDevice(browser, 2);
	const office = await ownDevice(browser, 3);
	const outside = recordOutside([laptop, phone, office]);
	try {
		// The laptop: a passkey, and a booking.
		await laptop.page.goto('/');
		await acceptConsent(laptop.page);
		await laptop.page.getByTestId('passkey-label').fill('E2E Laptop');
		await laptop.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(laptop.page.getByTestId('own-did')).toBeVisible();
		await tab(laptop.page, 'Zahlungen');
		await laptop.page.getByTestId('add-test-transaction').click();
		await expect(laptop.page.getByTestId('transaction')).toHaveCount(1);

		// The phone, with its own passkey: the vault, its books, the booking.
		await join(laptop, phone, 'E2E Telefon');
		await expect(phone.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });

		// The office laptop, with a third passkey.
		await join(laptop, office, 'E2E Büro-Laptop');
		await expect(office.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await tab(office.page, 'Zahlungen');
		await expect(office.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });

		// Three passkeys, and three DIDs: they are not one synced passkey.
		const dids = await Promise.all(
			[laptop, phone, office].map((d) => d.page.getByTestId('own-did').getAttribute('data-did'))
		);
		expect(new Set(dids).size).toBe(3);

		// A booking on the phone reaches both laptops.
		await phone.page.getByTestId('add-test-transaction').click();
		await tab(laptop.page, 'Zahlungen');
		await expect(laptop.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });
		await tab(office.page, 'Zahlungen');
		await expect(office.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });

		// The vault's record reached every device: three passkeys on each.
		for (const d of [laptop, phone, office]) {
			await openSettings(d.page, 'schluessel');
			await expect(d.page.getByTestId('keys-slot')).toHaveCount(3, { timeout: 90_000 });
		}

		// Nobody else was asked: no Aleph, no relay, no WebSocket at all.
		expect(outside).toEqual([]);
	} finally {
		for (const d of [laptop, phone, office]) await d.context.close();
	}
});

test('"Ablehnen" hands over nothing', async ({ browser }) => {
	test.setTimeout(180_000);
	const laptop = await ownDevice(browser, 4);
	const stranger = await ownDevice(browser, 5);
	try {
		await laptop.page.goto('/');
		await acceptConsent(laptop.page);
		await laptop.page.getByTestId('passkey-label').fill('E2E Laptop');
		await laptop.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(laptop.page.getByTestId('own-did')).toBeVisible();

		await join(laptop, stranger, 'E2E Fremd', false);
		await expect(stranger.page.getByTestId('own-join-error')).toBeVisible({ timeout: 30_000 });
		await expect(stranger.page.getByTestId('own-did')).toHaveCount(0);
		// No vault and no passkey kept: the screen still offers to make one.
		expect(
			await stranger.page.evaluate(() => ({
				vaults: localStorage.getItem('belege.vaults.v1'),
				credential: localStorage.getItem('belege.webauthnCredential')
			}))
		).toEqual({ vaults: null, credential: null });
	} finally {
		await laptop.context.close();
		await stranger.context.close();
	}
});

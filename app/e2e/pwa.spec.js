// Installable and offline (issue #141): the manifest and its icons are
// served, the service worker takes the page, and with the network gone a
// reload still shows the app – the books unlock from this browser alone.
// The browser's install offer is simulated (Chromium fires it only for a
// real, engaged visit): "Nicht jetzt" is remembered.
import { test, expect } from '@playwright/test';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('manifest, service worker, offline reload, install offer', async ({ page, context }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);

	// The manifest, as the browser reads it, and every icon in it.
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	const manifest = await (await page.request.get(String(href))).json();
	expect(manifest).toMatchObject({ short_name: 'Belege', display: 'standalone', start_url: '/' });
	expect(manifest.icons.map((/** @type {any} */ i) => i.purpose)).toEqual([
		'any',
		'any',
		'maskable'
	]);
	for (const icon of manifest.icons) {
		const r = await page.request.get(icon.src);
		expect(r.status(), icon.src).toBe(200);
		expect(r.headers()['content-type']).toContain('image/png');
	}

	// The service worker is active and has cached the shell.
	await expect
		.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
		.toBe('activated');
	expect(
		await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('belege-')))
	).toBe(true);

	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const did = await page.getByTestId('own-did').getAttribute('data-did');

	// Offline: the page comes from the service worker, the books from this browser.
	await context.setOffline(true);
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', String(did));
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await expect(page.getByRole('heading', { name: 'Zahlungen' }).first()).toBeVisible();
	await context.setOffline(false);

	// The install offer, as Chromium would make it.
	await page.evaluate(() => {
		const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
			prompt: () => {
				/** @type {any} */ (window).__prompted = true;
			},
			userChoice: Promise.resolve({ outcome: 'dismissed' })
		});
		window.dispatchEvent(offer);
	});
	const offer = page.getByTestId('pwa-install');
	await expect(offer).toContainText('als App installieren');
	await offer.getByTestId('pwa-install-later').click();
	await expect(offer).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('belege.pwa-install-dismissed'))).toBe('1');
});

// Two devices of one passkey keep the same books (issue #123): two browser
// contexts stand for a Mac and a phone. The passkey is copied from one
// virtual authenticator to the other, as a synced passkey is; its PRF secret
// is not carried by the virtual authenticator, so both get the same PRF
// answer through the E2E-only hook (passkey-identity.js). Both switch device
// sync on, meet through the local test relay (e2e/relay.js) once one has typed
// the other's id, and then a booking written on either shows on the other.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';

const AUTHENTICATOR = {
	protocol: 'ctap2',
	ctap2Version: 'ctap2_1',
	transport: 'internal',
	hasResidentKey: true,
	hasUserVerification: true,
	isUserVerified: true,
	hasLargeBlob: true,
	hasPrf: true,
	automaticPresenceSimulation: true
};
// Made up: the answer one synced passkey gives on both devices.
const PRF = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

/** @param {import('@playwright/test').Browser} browser */
async function device(browser) {
	const context = await browser.newContext();
	await context.addInitScript((prf) => {
		/** @type {any} */ (globalThis).__belegeTestPrf = prf;
		localStorage.setItem('belege.device-sync', 'on');
	}, PRF);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: AUTHENTICATOR
	});
	return { context, page, cdp, authenticatorId };
}

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
		const { credentials } = await mac.cdp.send('WebAuthn.getCredentials', {
			authenticatorId: mac.authenticatorId
		});
		await phone.cdp.send('WebAuthn.addCredential', {
			authenticatorId: phone.authenticatorId,
			credential: credentials[0]
		});
		// A phone that has unlocked with it before: its stored credential (public
		// parts only) is there. Restoring from scratch asks the provider for the
		// PRF itself, which the copied virtual credential cannot answer.
		const stored = await mac.page.evaluate(() => {
			/** @type {Record<string, string>} */
			const kept = {};
			for (let i = 0; i < localStorage.length; i++) {
				const k = String(localStorage.key(i));
				if (k === 'belege.webauthnCredential' || k.startsWith('webauthn-identity-proof:')) {
					kept[k] = String(localStorage.getItem(k));
				}
			}
			return kept;
		});
		await phone.page.goto('/robots.txt');
		await phone.page.evaluate((kept) => {
			for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
		}, stored);
		await phone.page.goto('/');
		await acceptConsent(phone.page);
		await phone.page.getByTestId('passkey-unlock').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', String(did));

		// Both online; the Mac's id typed on the phone.
		await tab(mac.page, 'Integrationen');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{
				timeout: 30_000
			}
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
		await tab(phone.page, 'Integrationen');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-add-input').fill(macId);
		await phone.page.getByTestId('devices-add').click();
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toContainText('verbunden', { timeout: 60_000 });
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

		// … and one more on the Mac, now that both are connected, on the phone.
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(phone.page.getByTestId('transaction')).toHaveCount(3, { timeout: 90_000 });
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

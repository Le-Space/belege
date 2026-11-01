// "Eigene Geräte" switched on in the consent screen does what the menu's own
// switch does (#327): where the node went offline at unlock, the menu says
// the devices are on from the next unlock and offers the reload – not "aus"
// and "Einschalten …" again, as if the switch had done nothing.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('own devices switched on in the consent screen: the menu says what is missing', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// Unlocked with own devices off: the node stayed offline.
	const menu = page.getByTestId('network-menu');
	await page.getByTestId('local-only').click();
	await expect(menu.getByTestId('network-devices-setup')).toBeVisible();
	await expect(menu.getByTestId('network-reload')).toHaveCount(0);

	// "Einschalten …" → the consent screen → the switch on → "Verstanden".
	await menu.getByTestId('network-devices-setup').click();
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('consent-devices').locator('label').click();
	await expect(dialog.getByTestId('consent-devices')).toHaveAttribute('data-state', 'on');
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();

	await page.getByTestId('local-only').click();
	await expect(menu.getByTestId('network-devices-state')).toHaveText(
		'ein – ab dem nächsten Entsperren'
	);
	await expect(menu.getByTestId('network-devices-setup')).toHaveCount(0);
	await expect(menu.getByTestId('network-reload')).toContainText('Jetzt neu laden und entsperren');

	// Switched off again before the reload: off, and no reload needed.
	await menu.getByTestId('network-devices-off').click();
	await expect(menu.getByTestId('network-reload')).toHaveCount(0);
	await expect(menu.getByTestId('network-devices-setup')).toBeVisible();
	expect(await page.evaluate(() => localStorage.getItem('belege.device-sync'))).toBeNull();

	// On again, then reloaded and unlocked: the node goes online, nothing is missing.
	await menu.getByTestId('network-devices-setup').click();
	// The consent screen shows the switch as the menu left it: off.
	await expect(dialog.getByTestId('consent-devices')).toHaveAttribute('data-state', 'off');
	await dialog.getByTestId('consent-devices').locator('label').click();
	await expect(dialog.getByTestId('consent-devices')).toHaveAttribute('data-state', 'on');
	await dialog.getByTestId('consent-proceed').click();
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByTestId('local-only').click();
	await expect(menu.getByTestId('network-devices-setup')).toHaveCount(0);
	await expect(menu.getByTestId('network-reload')).toHaveCount(0);
});

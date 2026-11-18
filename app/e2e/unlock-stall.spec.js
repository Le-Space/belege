// An unlock that waits for the browser's storage (#803): the progress line
// names the part, and after the threshold the screen says what helps – close
// other windows of Belege, then restart the browser – and never to clear site
// data. With a second tab of Belege open it says so first. The storage that
// never opens and the short threshold are hooks of the E2E build only.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a storage that does not open: the part is named, and what helps', async ({ page }) => {
	await page.addInitScript(() => {
		/** @type {any} */ (globalThis).__belegeStallStorage = true;
		/** @type {any} */ (globalThis).__belegeStallAfterMs = 1500;
	});
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Hänger');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();

	await expect(page.getByTestId('passkey-step')).toHaveText('Speicher im Browser öffnen …');
	const stalled = page.getByTestId('passkey-stalled');
	await expect(stalled).toBeVisible({ timeout: 15_000 });
	await expect(stalled).toHaveAttribute('data-part', 'storage');
	await expect(stalled).toContainText('Das dauert ungewöhnlich lange.');
	await expect(stalled).toContainText('beende den Browser ganz');
	await expect(stalled).toContainText('Lösche keine Website-Daten.');
	// No other window of Belege is open: none is claimed.
	await expect(page.getByTestId('passkey-stalled-window')).toHaveCount(0);

	// The diagnosis names the part.
	await page.getByTestId('support-link').click();
	await expect(page.getByTestId('support-diagnosis')).toContainText('step network/storage');
});

test('with Belege open in a second tab, the hint says so', async ({ page, context }) => {
	const second = await context.newPage();
	await second.goto('/');
	await expect(
		second.getByTestId('consent-modal').or(second.getByTestId('passkey-label')).first()
	).toBeVisible();

	await page.addInitScript(() => {
		/** @type {any} */ (globalThis).__belegeStallStorage = true;
		/** @type {any} */ (globalThis).__belegeStallAfterMs = 1500;
	});
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Hänger zwei Tabs');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('passkey-stalled-window')).toContainText(
		'in einem anderen Tab oder Fenster',
		{ timeout: 15_000 }
	);
});

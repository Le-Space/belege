// Between the prompts of "Passkey anlegen", the page says what the next touch
// is for, and the touch waits for "Weiter" (#429). The picker shows the name
// typed, not an opaque id. Every other spec skips the steps
// (addVirtualAuthenticator); this one switches that off.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator, recordCeremonies, takeCeremonies } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** @param {import('@playwright/test').Page} page */
async function withSteps(page) {
	await addVirtualAuthenticator(page);
	await page.addInitScript(() => {
		/** @type {any} */ (window).__belegeSkipPasskeySteps = false;
	});
	await recordCeremonies(page);
	await page.goto('/');
	await acceptConsent(page);
}

test('creating a passkey says what each further touch is for', async ({ page }) => {
	await withSteps(page);
	await page.getByTestId('passkey-label').fill('Beispiel Studio');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();

	const dialog = page.getByTestId('passkey-step-dialog');
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId('passkey-step-count')).toHaveText('Passkey-Abfrage 2 von 2');
	await expect(dialog.getByRole('heading')).toHaveText('Jetzt der Schlüssel für deine Bücher');
	// The passkey is made, the next prompt waits for the click.
	const first = await takeCeremonies(page);
	expect(first.map((c) => [c.kind, c.name])).toEqual([['create', 'Beispiel Studio']]);

	// The PRF read is the last: no identity signature since the books sign as themselves (#496).
	await page.getByTestId('passkey-step-continue').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect(dialog).toBeHidden();
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf, c.allow])).toEqual([
		['get', true, 1]
	]);
});

test('cancelling between the prompts opens nothing, and the stored passkey carries on', async ({
	page
}) => {
	await withSteps(page);
	await page.getByTestId('passkey-label').fill('Beispiel Studio');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('passkey-step-count')).toHaveText('Passkey-Abfrage 2 von 2');

	await page.getByTestId('passkey-step-cancel').click();
	await expect(page.getByTestId('passkey-error')).toContainText('Abgebrochen');
	await expect(page.getByTestId('own-did')).toHaveCount(0);
	expect((await takeCeremonies(page)).map((c) => c.kind)).toEqual(['create']);

	// The credential is kept: unlocking it is one click, no steps.
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect(page.getByTestId('passkey-step-dialog')).toBeHidden();
});

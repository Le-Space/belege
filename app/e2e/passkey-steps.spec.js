// Between the prompts of "Passkey anlegen", the page says what the next touch
// is for, and the touch waits for "Weiter" (#429). The picker shows the name
// typed, not an opaque id. Every other spec skips the steps
// (addVirtualAuthenticator); this one switches that off.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator, recordCeremonies, takeCeremonies } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openSettings } from './settings.js';

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

// #555: the key actions under Einstellungen → Schlüssel ask the authenticator
// more than once from one click. Each further prompt waits for "Weiter" here
// too, with the passkey it is for named.
test('adding a passkey and renewing the vault give each further prompt its own click', async ({
	page
}) => {
	await withSteps(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await page.getByTestId('passkey-step-continue').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await takeCeremonies(page);

	await openSettings(page, 'schluessel');
	const keys = page.getByTestId('keys-card');
	const dialog = page.getByTestId('passkey-step-dialog');
	for (const [label, count] of /** @type {const} */ ([
		['YubiKey', 2],
		['Telefon', 3]
	])) {
		await keys.getByTestId('keys-add-label').fill(label);
		await keys.getByTestId('keys-publish').uncheck();
		await keys.getByTestId('keys-add').click();
		await expect(page.getByTestId('passkey-step-count')).toHaveText('Passkey-Abfrage 2 von 2');
		await expect(dialog.getByRole('heading')).toHaveText(
			'Jetzt öffnet der neue Passkey die Bücher'
		);
		// Made; the PRF read waits for the click.
		expect((await takeCeremonies(page)).map((c) => [c.kind, c.name])).toEqual([['create', label]]);
		await page.getByTestId('passkey-step-continue').click();
		await expect(keys.getByTestId('keys-slot')).toHaveCount(count, { timeout: 30_000 });
		await expect(dialog).toBeHidden();
		expect((await takeCeremonies(page)).map((c) => [c.kind, c.prf, c.allow])).toEqual([
			['get', true, 1]
		]);
	}

	// YubiKey out, the vault renewed: Laptop answers from the click, Telefon after "Weiter".
	await keys
		.getByTestId('keys-slot')
		.filter({ hasText: 'YubiKey' })
		.getByTestId('keys-remove')
		.click();
	await keys.getByTestId('keys-remove-renew').click();
	await expect(page.getByTestId('passkey-step-count')).toHaveText('Passkey-Abfrage 2 von 2');
	await expect(dialog.getByRole('heading')).toHaveText('Jetzt der Passkey „Telefon“');
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.allow])).toEqual([['get', 1]]);
	await page.getByTestId('passkey-step-continue').click();
	await expect(keys.getByTestId('keys-done')).toContainText('erneuert', { timeout: 30_000 });
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	expect((await takeCeremonies(page)).map((c) => [c.kind, c.allow])).toEqual([['get', 1]]);
});

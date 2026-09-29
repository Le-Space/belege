// A smoke run in English (issue #192): consent, a new passkey, a booking, and
// every page – none shows German. The rest of the suite reads German.
//
// German on the page is found by what only German has: an umlaut, ß or „.
// German on purpose (the Eigenbeleg, SKR 03, DATEV) carries none of them in
// English; a word that does is listed with its reason.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test.use({ locale: 'en-GB' });

/** Words that stay German in English, with why. None so far. */
/** @type {string[]} */
const KEPT = [];

/** @param {import('@playwright/test').Page} page */
async function germanOn(page) {
	const text = await page.locator('body').innerText();
	return text
		.split('\n')
		.filter((line) => /[äöüÄÖÜß„]/.test(line))
		.filter((line) => !KEPT.some((word) => line.includes(word)));
}

test('English: consent, passkey, a booking and every page, without German', async ({ page }) => {
	test.setTimeout(120_000);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	expect(await germanOn(page)).toEqual([]);
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E English');
	await page.getByRole('button', { name: 'Create passkey' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const pages = ['Home', 'Payments', 'Receipts', 'Export', 'Integrations'];
	/** @type {Record<string, string[]>} */
	const found = {};
	for (const name of pages) {
		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name, exact: true })
			.click();
		await page.waitForLoadState('networkidle');
		if (name === 'Payments') {
			await page.getByTestId('add-test-transaction').click();
			await expect(page.getByTestId('transaction')).toHaveCount(1);
		}
		const german = await germanOn(page);
		if (german.length) found[name] = german;
	}
	await page.goto('/einstellungen');
	await page.waitForLoadState('networkidle');
	const settings = await germanOn(page);
	if (settings.length) found.Settings = settings;
	expect(found).toEqual({});

	// The check itself sees German: switched, the same page is full of it.
	await page.getByTestId('language-de').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	expect((await germanOn(page)).length).toBeGreaterThan(0);
});

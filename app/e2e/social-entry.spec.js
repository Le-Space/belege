// The English entry for link previews (#343): /en/ opens the app in English
// in a fresh browser, and keeps a language chosen before.
import { test, expect } from '@playwright/test';

test('/en/ opens the app in English, unless a language was chosen', async ({ browser }) => {
	const fresh = await browser.newContext({ locale: 'de-DE' });
	const page = await fresh.newPage();
	await page.goto('/en/');
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('consent-modal')).toContainText('Before you start');
	await fresh.close();

	const chosen = await browser.newContext({ locale: 'de-DE' });
	await chosen.addInitScript(() => localStorage.setItem('belege.locale', 'de'));
	const again = await chosen.newPage();
	await again.goto('/en/');
	await expect(again).toHaveURL(/\/$/);
	await expect(again.getByTestId('consent-modal')).toContainText('Bevor du anfängst');
	await chosen.close();
});

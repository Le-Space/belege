// The language (issue #192): an English browser starts in English, and the
// consent screen – which covers the header on the first visit – switches it
// there already. The choice is kept for the next visit.
import { test, expect } from '@playwright/test';

test.use({ locale: 'en-GB' });

test('the consent screen switches the language, and the choice is kept', async ({ page }) => {
	await page.goto('/');
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog.getByRole('heading', { name: 'Before you start' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await dialog.getByTestId('consent-language-de').click();
	await expect(dialog.getByRole('heading', { name: 'Bevor du anfängst' })).toBeVisible();
	await expect(dialog.getByTestId('consent-proceed')).toHaveText('Verstanden');
	await expect(dialog.getByTestId('consent-language-de')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();

	// Kept, although the browser still says English.
	await page.reload();
	await expect(page.getByTestId('consent-modal')).toBeHidden();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.getByTestId('language-de')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('language-en').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByTestId('language-en')).toHaveAttribute('aria-pressed', 'true');
});

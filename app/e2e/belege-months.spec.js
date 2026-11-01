// Belege one month at a time (#313): opens on the newest month, another month
// on a click, a search finds receipts of every month, a receipt opened by
// link shows its own month, the chosen month stays over a tab change,
// "Alle Monate" shows the year, and on a phone a select. Every receipt is
// made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('one month at a time, a search over all, a link to its own month', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const ids = await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		/** @type {Record<string, string>} */
		const out = {};
		for (const [day, vendor] of [
			['2025-01-10', 'Januar Beispiel GmbH'],
			['2025-01-20', 'Zweiter Januar GmbH'],
			['2025-02-05', 'Februar Beispiel AG'],
			['2025-03-15', 'Maerz Beispiel KG']
		]) {
			const r = await e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 1000,
				currency: 'EUR',
				documentDate: day
			});
			out[vendor] = r.id;
		}
		return out;
	});

	const nav = page.getByRole('navigation');
	const rows = page.getByTestId('receipt');
	const pick = (/** @type {string} */ m) =>
		page.locator(`[data-testid="receipt-month-pick"][data-month="${m}"]`);
	await nav.getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');

	// The newest month only; the list of months with their counts.
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText('Maerz Beispiel KG');
	await expect(pick('2025-03')).toHaveAttribute('aria-current', 'true');
	await expect(pick('2025-01')).toContainText('2');
	await expect(pick('all')).toContainText('4');

	// Another month.
	await pick('2025-01').click();
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: 'Maerz' })).toHaveCount(0);

	// A search spans every month, and says so.
	await page.getByTestId('receipt-search').fill('Beispiel');
	await expect(page.getByTestId('receipt-search-all')).toContainText('3');
	await expect(rows).toHaveCount(3);
	await page.getByTestId('receipt-search').fill('');
	await expect(rows).toHaveCount(2);

	// The chosen month stays when the tab is left and opened again.
	await nav.getByRole('link', { name: 'Zahlungen' }).click();
	await nav.getByRole('link', { name: 'Belege' }).click();
	await expect(pick('2025-01')).toHaveAttribute('aria-current', 'true');
	await expect(rows).toHaveCount(2);

	// A link to a receipt opens its own month with it selected.
	await page.goto(`/belege?receipt=${ids['Februar Beispiel AG']}`);
	await page.getByTestId('passkey-unlock').click();
	await page.getByTestId('year-switch').selectOption('2025');
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText('Februar Beispiel AG');
	await expect(page.getByTestId('receipt-detail')).toContainText('Februar Beispiel AG');

	// The whole year on request.
	await pick('all').click();
	await expect(rows).toHaveCount(4);
});

test('on a phone: the months as a select', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		for (const [day, vendor] of [
			['2025-01-10', 'Januar Beispiel GmbH'],
			['2025-03-15', 'Maerz Beispiel KG']
		]) {
			await e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 1000,
				currency: 'EUR',
				documentDate: day
			});
		}
	});
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const select = page.getByTestId('receipt-month-select');
	await expect(select).toBeVisible();
	await expect(page.getByTestId('receipt')).toContainText('Maerz Beispiel KG');
	await select.selectOption('2025-01');
	await expect(page.getByTestId('receipt')).toContainText('Januar Beispiel GmbH');
	await expect(page.getByTestId('receipt')).toHaveCount(1);
});

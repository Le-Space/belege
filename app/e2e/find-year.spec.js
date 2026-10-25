// "Beleg finden" with no suggestion opens on the payment's own year, not on
// every receipt ever kept: a receipt from 2019 is no answer for a payment in
// 2025. When that year has none, the list says how many other years have.
// Every name, number and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('finding a receipt starts with the payment year', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const bank = await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0042',
			ibanLast4: '0042',
			name: 'Geschäftskonto Test',
			currency: 'EUR'
		});
		await e2e.addTransaction({
			accountId: bank.id,
			source: 'hibiscus',
			currency: 'EUR',
			bookedOn: '2025-02-11',
			amountCents: -1000,
			counterparty: 'Funkbeispiel Prepaid',
			purpose: 'Aufladung Prepaid-Konto',
			bookingType: 'Basislastschrift'
		});
		for (const [day, vendor, cents] of [
			['2019-10-05', 'Funkbeispiel Uruguay', 2390],
			['2025-03-02', 'Druckerei Beispiel KG', 5500]
		]) {
			await e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: /** @type {number} */ (cents),
				currency: 'EUR',
				documentDate: day
			});
		}
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	await page.getByTestId('transaction').filter({ hasText: 'Funkbeispiel Prepaid' }).click();
	const detail = page.getByTestId('tx-detail');
	const choices = detail.getByTestId('tx-choice');

	// No suggestion: the year 2025 is open, the receipt from 2019 is not in it.
	await expect(detail.getByTestId('tx-find-tab-jahr')).toHaveAttribute('aria-pressed', 'true');
	await expect(choices).toHaveCount(1);
	await expect(choices).toContainText('Druckerei Beispiel KG');

	// Searching for the provider: none from 2025, and it says where the other one is.
	await detail.getByTestId('tx-find-query').fill('funkbeispiel');
	await expect(choices).toHaveCount(0);
	await expect(detail.getByTestId('tx-find-none')).toContainText(
		'Aus 2025 keiner. 1 aus anderen Jahren'
	);

	// "Alle Belege" still has it.
	await detail.getByTestId('tx-find-tab-alle').click();
	await expect(choices).toHaveCount(1);
	await expect(choices).toContainText('Funkbeispiel Uruguay');
});

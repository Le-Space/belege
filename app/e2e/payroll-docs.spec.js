// A payroll document (#233, part 2): one uploaded payroll journal is the
// receipt for the wages of its month – its kind and period proposed from its
// name, the month's wage payments ticked, linked with a click. Made-up names
// and amounts.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a payroll journal linked to the wages of its month', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Lohn');
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
		for (const [day, purpose] of [
			['2025-12-30', 'Minijob 12/2025'],
			['2025-11-28', 'Minijob 11/2025']
		]) {
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: day,
				amountCents: -53_354,
				counterparty: 'Max Beispiel',
				purpose,
				bookingType: 'Überweisung'
			});
		}
		await e2e.addReceipt({
			source: 'upload',
			status: 'ausgelesen',
			currency: 'EUR',
			fileName: 'Lohnjournal 12-2025.pdf',
			vendor: 'Lohnbüro Beispiel',
			documentDate: '2025-12-31'
		});
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	await page.getByTestId('receipt').filter({ hasText: 'Lohnbüro Beispiel' }).click();
	const detail = page.getByTestId('receipt-detail');
	await detail.getByTestId('payroll-doc-open').click();
	// Proposed from the file's name: a payroll journal of December; December's wage ticked.
	await expect(detail.getByTestId('payroll-doc-kind')).toHaveValue('payroll');
	await expect(detail.getByTestId('payroll-doc-period')).toHaveValue('2025-12');
	const choice = detail.getByTestId('payroll-doc-choice');
	await expect(choice).toHaveCount(1);
	await expect(choice).toContainText('30.12.2025');
	await expect(choice.locator('input')).toBeChecked();
	await detail.getByTestId('payroll-doc-link').click();

	await expect(detail.getByTestId('payroll-doc')).toContainText(
		'Lohnabrechnung / Lohnjournal 12/2025'
	);
	await expect(detail.getByTestId('payroll-doc-payment')).toHaveCount(1);
	await expect(detail.getByTestId('payroll-doc-payment')).toContainText('Max Beispiel');
});

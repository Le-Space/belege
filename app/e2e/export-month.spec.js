// The month chosen on Export is kept (#314): to Zahlungen by the tab and
// back, by a check's "öffnen" and the browser's back, and over a reload – in
// the address as ?month=. Every booking is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('the export month stays when leaving the tab and coming back', async ({ page }) => {
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
		for (const [day, name] of [
			['2025-01-20', 'Telefonanbieter Beispiel GmbH'],
			['2025-03-12', 'Wolkendienst Beispiel Ltd']
		]) {
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: day,
				amountCents: -4000,
				counterparty: name,
				purpose: 'Rechnung',
				bookingType: 'Lastschrift'
			});
		}
	});

	const nav = page.getByRole('navigation');
	const select = page.getByTestId('export-month-select');
	await nav.getByRole('link', { name: 'Export' }).click();
	await expect(select).toHaveValue('2025-03');
	await select.selectOption('2025-01');
	await expect(page).toHaveURL(/\/export\?month=2025-01$/);

	// To Zahlungen by the tab and back.
	await nav.getByRole('link', { name: 'Zahlungen' }).click();
	await nav.getByRole('link', { name: 'Export' }).click();
	await expect(select).toHaveValue('2025-01');
	await expect(page).toHaveURL(/\/export\?month=2025-01$/);

	// A check's "öffnen" and the browser's back.
	await page.getByTestId('export-check-open').first().click();
	await expect(page).toHaveURL(/\/zahlungen/);
	await page.goBack();
	await expect(select).toHaveValue('2025-01');

	// A reload keeps it, from the address.
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await expect(select).toHaveValue('2025-01');
});

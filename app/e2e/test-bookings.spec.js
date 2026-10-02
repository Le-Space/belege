// "Testbuchung anlegen" (development and E2E builds only) can put made-up
// payments into real books. They are marked, said so on Zahlungen, kept out
// of the export, and removed with one click.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('test bookings are said so, and removed with one click', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// One from the button, one as older builds wrote it (no mark), and a real one.
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('add-test-transaction').click();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: 'Testpartner GmbH',
			purpose: 'Testbuchung',
			amountCents: -1999
		});
		await e2e.addTransaction({
			bookedOn: new Date().toISOString().slice(0, 10),
			counterparty: 'Stromwerk Test AG',
			purpose: 'Abschlag',
			amountCents: -4500,
			source: 'camt',
			accountId: 'acc-1'
		});
	});
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const banner = page.getByTestId('test-bookings-banner');
	await expect(banner).toContainText('2 Testbuchung(en) in den Büchern.');
	await expect(page.getByTestId('transaction')).toHaveCount(3);

	await banner.getByTestId('test-bookings-remove').click();
	await expect(banner).toHaveCount(0);
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText('Stromwerk Test AG');
});

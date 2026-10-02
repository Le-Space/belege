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
	// Stored (it books onto the Testkonto first) before the page reloads below.
	await expect(page.getByTestId('test-bookings-banner')).toContainText('1 Testbuchung(en)');
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

	// The export leaves them out unless asked for.
	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await expect(page.getByTestId('export-tests')).toContainText('Testbuchungen mitexportieren (2)');
	await expect(page.getByTestId('export-include-tests')).not.toBeChecked();
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();

	await banner.getByTestId('test-bookings-remove').click();
	await expect(banner).toHaveCount(0);
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText('Stromwerk Test AG');
});

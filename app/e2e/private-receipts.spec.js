// "Privat, nicht geschäftlich" (#293), end to end: a receipt from the private
// mailbox is set aside as private with its reason; it is shown as "Privat",
// is no longer among the month's receipts without a payment in the export,
// and can be taken back in. Every vendor and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a private receipt is set aside with its reason, out of the export, and taken back in', async ({
	page
}) => {
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
		// A month to export: a payment of its own, with no receipt here.
		await e2e.addTransaction({
			accountId: bank.id,
			source: 'hibiscus',
			currency: 'EUR',
			bookedOn: '2025-01-20',
			amountCents: -4000,
			counterparty: 'Telefonanbieter Beispiel GmbH',
			purpose: 'Rechnung TB-2025-0101',
			bookingType: 'Lastschrift'
		});
		const common = { status: 'ausgelesen', source: 'upload', currency: 'EUR' };
		await e2e.addReceipt({
			...common,
			fileName: 'hotel.pdf',
			vendor: 'Hotel Beispiel',
			invoiceNumber: 'HB-12',
			amountCents: 24_000,
			documentDate: '2025-01-10'
		});
		await e2e.addReceipt({
			...common,
			fileName: 'wolke.pdf',
			vendor: 'Wolkendienst Beispiel Ltd',
			invoiceNumber: 'WD-77',
			amountCents: 1_990,
			documentDate: '2025-01-28'
		});
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const hotel = page.getByTestId('receipt').filter({ hasText: 'Hotel Beispiel' });
	const detail = page.getByTestId('receipt-detail');
	await hotel.click();
	await detail.getByTestId('receipt-set-aside-private').click();
	await detail.getByTestId('receipt-private-note').fill('private Reise');
	await detail.getByTestId('receipt-private-confirm').click();
	await expect(detail.getByTestId('receipt-set-aside-note')).toContainText(
		'Privat, nicht geschäftlich: private Reise'
	);
	await expect(hotel.getByTestId('receipt-status')).toHaveText('Privat');
	// Neither booked privately: an outlay is for business costs.
	await expect(detail.getByTestId('outlay-open')).toHaveCount(0);

	// The export: only the business receipt waits for a payment.
	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption('2025-01');
	const unlinked = page.locator('[data-testid="export-check"][data-check="unlinked"]');
	await expect(unlinked.getByTestId('export-check-text')).toContainText(
		'1 Belege dieses Monats sind keiner Zahlung zugeordnet'
	);
	await expect(unlinked).toContainText('Wolkendienst Beispiel Ltd');
	await expect(unlinked).not.toContainText('Hotel Beispiel');

	// Taken back in: no longer private, to be decided again.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await hotel.click();
	await detail.getByTestId('receipt-restore').click();
	await expect(hotel.getByTestId('receipt-status')).not.toHaveText('Privat');
	await expect(detail.getByTestId('receipt-set-aside-private')).toBeVisible();
});

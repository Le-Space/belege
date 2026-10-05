// Private outlays (#293), end to end: a receipt paid privately is booked from
// its detail on the account "Auslagen Geschäftsführung" and is covered by it;
// a ruble receipt – no ECB rate since 2022 – takes a rate by hand with where
// it comes from; undone, the receipt is offered again. Every vendor, amount
// and place is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('receipts paid privately become outlays, in euros and in rubles by a rate by hand', async ({
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
		const common = { source: 'upload', status: 'ausgelesen' };
		await e2e.addReceipt({
			...common,
			fileName: 'bahn.pdf',
			vendor: 'Bahn Beispiel AG',
			invoiceNumber: 'TK-77',
			amountCents: 8_990,
			currency: 'EUR',
			documentDate: '2025-03-04'
		});
		await e2e.addReceipt({
			...common,
			fileName: 'coworking.pdf',
			vendor: 'Coworking Beispiel',
			amountCents: 1_699_000,
			currency: 'RUB',
			documentDate: '2025-03-03'
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const receipt = (/** @type {string} */ name) =>
		page.getByTestId('receipt').filter({ hasText: name });
	const detail = page.getByTestId('receipt-detail');

	// In euros, in cash.
	await receipt('Bahn Beispiel AG').click();
	await detail.getByTestId('outlay-open').click();
	await detail.getByTestId('outlay-how').selectOption('cash');
	await expect(detail.getByTestId('outlay-euros')).toContainText('89,90');
	await detail.getByTestId('outlay-book').click();
	await expect(detail.getByTestId('outlay-booked')).toContainText(
		'Privat ausgelegt am 04.03.2025 (bar)'
	);
	await expect(detail.getByTestId('outlay-booked')).toContainText('Auslagen Geschäftsführung');
	await expect(detail.getByTestId('outlay-open')).toHaveCount(0);

	// In rubles: no ECB rate, a rate by hand and where it comes from.
	await receipt('Coworking Beispiel').click();
	await detail.getByTestId('outlay-open').click();
	await expect(detail.getByTestId('outlay-no-ecb')).toContainText('keinen EZB-Kurs');
	await expect(detail.getByTestId('outlay-book')).toBeDisabled();
	await detail.getByTestId('outlay-rate').fill('0,0105');
	await detail.getByTestId('outlay-rate-note').fill('Wechselbeleg vom 01.03.');
	await expect(detail.getByTestId('outlay-euros')).toContainText('178,40');
	await detail.getByTestId('outlay-book').click();
	await expect(detail.getByTestId('outlay-booked-rate')).toContainText(
		'16990.00 RUB zu 0.0105 EUR (Kurs von Hand) · Wechselbeleg vom 01.03.'
	);

	// Zahlungen: the outlay account with both bookings, each covered by its receipt.
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	await page.getByTestId('account-filter').selectOption({ label: 'Auslagen Geschäftsführung' });
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await expect(rows).toHaveCount(2);
	for (const row of await rows.all()) {
		await expect(row.getByTestId('coverage-badge')).toHaveText('Beleg');
	}
	await expect(rows.filter({ hasText: 'Coworking Beispiel' })).toContainText('-178,40');

	// Undone: the receipt is offered again.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await receipt('Bahn Beispiel AG').click();
	await detail.getByTestId('outlay-undo').click();
	await expect(detail.getByTestId('outlay-open')).toBeVisible();
});

// "Beleg finden" with no suggestion opens on the receipts from around the
// payment (30 days before and after), not on its whole year or every receipt
// ever kept: one from months away is no answer for a direct debit. A search
// text looks through every receipt, all years, and also through those already
// assigned to another payment – which say so and are moved only on a click.
// Every name, number and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('finding a receipt starts with the payment period; a search finds all', async ({ page }) => {
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
		for (const [day, counterparty, cents] of [
			['2025-02-11', 'Funkbeispiel Prepaid', -1000],
			['2025-07-03', 'Rundfunk Muster eG', -2390]
		]) {
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: day,
				amountCents: cents,
				counterparty,
				purpose: 'Lastschrift Beispiel',
				bookingType: 'Basislastschrift'
			});
		}
		for (const [day, vendor, cents] of [
			['2019-10-05', 'Funkbeispiel Uruguay', 2390],
			['2025-03-02', 'Druckerei Beispiel KG', 5500],
			// Same year, far from the payment: no longer proposed.
			['2025-09-20', 'Druckerei Spät KG', 4200],
			// Assigned to the other payment below.
			['2025-07-01', 'Funkbeispiel Altvertrag', 1990]
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
	const detail = page.getByTestId('tx-detail');
	const choices = detail.getByTestId('tx-choice');

	/** @param {string} m YYYY-MM */
	const month = (m) => page.locator(`[data-testid="transaction-month"][data-month="${m}"]`).click();

	// The other payment takes "Funkbeispiel Altvertrag" first.
	await month('2025-07');
	await page.getByTestId('transaction').filter({ hasText: 'Rundfunk Muster eG' }).click();
	await detail.getByTestId('tx-find-query').fill('altvertrag');
	await expect(detail.getByTestId('tx-find-tab-alle')).toHaveAttribute('aria-pressed', 'true');
	await choices.filter({ hasText: 'Funkbeispiel Altvertrag' }).getByTestId('tx-choose').click();
	await expect(detail.getByTestId('tx-linked-vendor')).toContainText('Funkbeispiel Altvertrag');
	await detail.getByTestId('tx-detail-close').click();

	await month('2025-02');
	await page.getByTestId('transaction').filter({ hasText: 'Funkbeispiel Prepaid' }).click();

	// No suggestion: the period around 11.02.2025 is open – the receipt of
	// 02.03.2025 is in it, the one from September and the one from 2019 are not.
	await expect(detail.getByTestId('tx-find-tab-zeitraum')).toHaveAttribute('aria-pressed', 'true');
	await expect(detail.getByTestId('tx-find-tab-zeitraum')).toContainText('Um den 11.02.2025');
	await expect(choices).toHaveCount(1);
	await expect(choices).toContainText('Druckerei Beispiel KG');

	// A search text looks through all receipts: the open one from 2019, and the
	// one assigned to the other payment, which says where it is.
	await detail.getByTestId('tx-find-query').fill('funkbeispiel');
	await expect(detail.getByTestId('tx-find-tab-alle')).toHaveAttribute('aria-pressed', 'true');
	await expect(choices).toHaveCount(2);
	const assigned = choices.filter({ hasText: 'Funkbeispiel Altvertrag' });
	await expect(assigned).toHaveAttribute('data-assigned', 'true');
	await expect(assigned.getByTestId('tx-choice-assigned')).toContainText(
		'schon zugeordnet zu 03.07.2025'
	);
	await expect(assigned.getByTestId('tx-choose')).toHaveCount(0);
	await expect(choices.filter({ hasText: 'Funkbeispiel Uruguay' })).toHaveAttribute(
		'data-assigned',
		'false'
	);

	// The period with that search text has none, and says where the others are.
	await detail.getByTestId('tx-find-tab-zeitraum').click();
	await expect(choices).toHaveCount(0);
	await expect(detail.getByTestId('tx-find-none')).toContainText(
		'In diesem Zeitraum keiner. 2 aus anderen Zeiten'
	);

	// Moving it here, on a click: it is this payment's now.
	await detail.getByTestId('tx-find-tab-alle').click();
	await assigned.getByTestId('tx-choose-move').click();
	await expect(detail.getByTestId('tx-linked-vendor')).toContainText('Funkbeispiel Altvertrag');
	await detail.getByTestId('tx-detail-close').click();

	// … and the other payment needs a receipt again.
	await month('2025-07');
	await page.getByTestId('transaction').filter({ hasText: 'Rundfunk Muster eG' }).click();
	await expect(detail.getByTestId('tx-find')).toBeVisible();
	await expect(detail.getByTestId('tx-linked-vendor')).toHaveCount(0);
});

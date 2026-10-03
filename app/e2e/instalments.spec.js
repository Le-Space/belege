// One invoice, paid in instalments (issue #258), end to end with made-up books:
// our own invoice over 10.000 €, two instalments that name it – linked to it by
// the matching, one after the other – and the rest without a number, linked by
// hand "as one more instalment". The detail says which instalment it is and
// what is open; Belege says how far the invoice is paid.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const COMPANY = 'Musterfirma UG';

/** @param {import('@playwright/test').Page} page @param {Record<string, any>} tx */
const book = (page, tx) =>
	page.evaluate(async (tx) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const [bank] = await e2e.accounts();
		await e2e.addTransaction({ accountId: bank.id, source: 'hibiscus', currency: 'EUR', ...tx });
		await e2e.runMatching();
	}, tx);

test('each instalment is covered by the same invoice, and the invoice says what is open', async ({
	page
}) => {
	const day = (/** @type {number} */ back) =>
		new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await page.getByTestId('settings-link').click();
	await page.getByTestId('company-names').fill(COMPANY);
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	await page.evaluate(
		async ({ invoiceDay }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addAccount({
				source: 'hibiscus',
				sourceAccountId: '0042',
				ibanLast4: '0042',
				name: 'Geschäftskonto Test',
				currency: 'EUR'
			});
			await e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: 'rechnung-2025-017.pdf',
				vendor: 'Musterfirma UG',
				customer: 'Kunde Beispiel',
				ownInvoice: true,
				amountCents: 1_000_000,
				currency: 'EUR',
				documentDate: invoiceDay,
				invoiceNumber: '2025-017',
				extraction: {
					document_type: 'invoice',
					vendor: 'Musterfirma UG',
					invoice_number: '2025-017',
					invoice_date: invoiceDay,
					currency: 'EUR',
					gross: 10000
				}
			});
		},
		{ invoiceDay: day(60) }
	);
	const pay = { counterparty: 'Kunde Beispiel', bookingType: 'Gutschrift' };
	await book(page, {
		...pay,
		bookedOn: day(50),
		amountCents: 350_000,
		purpose: 'Teilzahlung Rechnung 2025-017-1'
	});
	await book(page, {
		...pay,
		bookedOn: day(20),
		amountCents: 350_000,
		purpose: 'Teilzahlung Rechnung 2025-017-2'
	});
	// The rest names no invoice: a person links it.
	await book(page, { ...pay, bookedOn: day(5), amountCents: 300_000, purpose: 'Zahlung' });

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await rows.filter({ hasText: '2025-017-2' }).click();
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-instalment')).toHaveText(
		/Teilzahlung 2 von 2 · 2025-017 ·\s+3\.000,00\sEUR offen/
	);
	await detail.getByTestId('tx-detail-close').click();

	// The rest: the partly paid invoice is offered as one more instalment.
	await rows.filter({ hasText: 'Zahlung' }).filter({ hasNotText: '2025-017' }).click();
	const choice = detail.getByTestId('tx-choice-instalment');
	await expect(choice).toContainText('teilweise bezahlt (2×) · 3.000,00');
	await detail.getByTestId('tx-choose').filter({ hasText: 'Als weitere Teilzahlung' }).click();
	await expect(detail.getByTestId('tx-instalment')).toHaveText(
		/Teilzahlung 3 von 3 · 2025-017 ·\s+bezahlt/
	);
	await detail.getByTestId('tx-detail-close').click();

	// Every instalment is covered; the invoice is paid in three.
	for (const row of await rows.all()) {
		await expect(row.getByTestId('coverage-badge')).toHaveText('Beleg');
	}
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await expect(page.getByTestId('receipt-instalments')).toHaveText('in 3 Raten bezahlt');
});

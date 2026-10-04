// The export's "Belege ohne Zahlung" (follow-up to the January export): a
// receipt linked to no payment is listed, with a link to it under Belege; a
// copy of a receipt that is linked (the same invoice from the mail and an
// upload) is not counted as open but named apart, to be sorted out. Every
// name, number and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('receipts without a payment link to Belege; a copy of a linked one is named apart', async ({
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
		const invoice = {
			status: 'ausgelesen',
			vendor: 'Telefonanbieter Beispiel GmbH',
			invoiceNumber: 'TB-2025-0101',
			amountCents: 4000,
			currency: 'EUR',
			documentDate: '2025-01-15'
		};
		await e2e.addReceipt({ ...invoice, source: 'upload', fileName: 'telefon-upload.pdf' });
		// The same invoice from the mailbox, its sender confirmed.
		await e2e.addReceipt({
			...invoice,
			source: 'mail',
			authVerdict: 'pass',
			fileName: 'telefon-mail.pdf'
		});
		await e2e.addReceipt({
			status: 'ausgelesen',
			source: 'upload',
			vendor: 'Wolkendienst Beispiel Ltd',
			invoiceNumber: 'WD-77',
			amountCents: 1990,
			currency: 'EUR',
			documentDate: '2025-01-28',
			fileName: 'wolke.pdf'
		});
		await e2e.runMatching();
	});

	// Link the upload to the payment by hand.
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	await page.getByTestId('filter-all').click();
	await page.getByTestId('transaction').filter({ hasText: 'Telefonanbieter' }).click();
	const detail = page.getByTestId('tx-detail');
	const linkedAlready = await detail.getByTestId('tx-find').count();
	if (linkedAlready) {
		await detail.getByTestId('tx-find-tab-alle').click();
		await detail
			.getByTestId('tx-choice')
			.filter({ hasText: 'TB-2025-0101' })
			.first()
			.getByTestId('tx-choose')
			.click();
	}
	await detail.getByTestId('tx-detail-close').click();

	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption('2025-01');
	const check = (/** @type {string} */ kind) =>
		page.locator(`[data-testid="export-check"][data-check="${kind}"]`);
	await expect(check('unlinked').getByTestId('export-check-text')).toContainText(
		'1 Belege dieses Monats sind keiner Zahlung zugeordnet – sie gehen nicht in dieses ZIP'
	);
	await expect(check('unlinked')).toContainText('Wolkendienst Beispiel Ltd');
	await expect(check('unlinked')).not.toContainText('Telefonanbieter');
	await expect(check('copies').getByTestId('export-check-text')).toContainText(
		'1 Belege dieses Monats sind Kopien bereits zugeordneter Belege'
	);
	await expect(check('copies')).toContainText('Telefonanbieter Beispiel GmbH');

	// The listed receipt opens under Belege.
	await check('unlinked').getByTestId('export-check-open').click();
	await expect(page).toHaveURL(/\/belege\?receipt=/);
	await expect(page.getByTestId('receipt').filter({ hasText: 'Wolkendienst' })).toHaveAttribute(
		'aria-current',
		'true'
	);
});

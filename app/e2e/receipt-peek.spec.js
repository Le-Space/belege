// The receipt preview with its lens (#273). Assigning by hand: resting the
// pointer on a choice opens it beside the detail; leaving closes it, Tab opens
// it and Esc closes it before the detail; a receipt from an unconfirmed sender
// shows none; on a narrow screen it sits by the row. In the lists: a payment
// shows the receipt linked to it, and the Belege list each receipt.
// Every name, number and amount is made up.
import { test, expect } from '@playwright/test';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** Made-up books: a card payment, its receipt with a PDF, one from an unconfirmed sender. @param {import('@playwright/test').Page} page */
async function books(page) {
	await page.setViewportSize({ width: 1400, height: 900 });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const pdf = [
		...makePdf([
			'Papierwerk Beispiel GmbH',
			'Rechnungsnummer: PW-2026-0042',
			'Rechnungsdatum: 2026-09-14',
			'Brutto: 48,90 EUR'
		])
	];
	await page.evaluate(
		async ({ pdf }) => {
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
				bookedOn: '2026-09-20',
				amountCents: -4890,
				counterparty: 'Unbekannter Händler',
				purpose: 'Kartenzahlung',
				bookingType: 'Lastschrift'
			});
			const receipt = {
				source: 'upload',
				status: 'ausgelesen',
				mime: 'application/pdf',
				amountCents: 4890,
				currency: 'EUR',
				documentDate: '2026-09-14'
			};
			await e2e.addReceiptFile(pdf, {
				...receipt,
				fileName: 'papierwerk.pdf',
				vendor: 'Papierwerk Beispiel GmbH',
				invoiceNumber: 'PW-2026-0042'
			});
			// From a mailbox, its sender not confirmed: never opened.
			await e2e.addReceiptFile(pdf, {
				...receipt,
				source: 'mail',
				authVerdict: 'fail',
				fileName: 'unbestaetigt.pdf',
				vendor: 'Absender Ungeprüft Ltd',
				invoiceNumber: 'UN-1'
			});
			await e2e.runMatching();
		},
		{ pdf }
	);
}

test('a receipt previewed on hover, with a lens, by keyboard too', async ({ page }) => {
	await books(page);
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	await page.getByTestId('transaction').filter({ hasText: 'Unbekannter Händler' }).click();
	const detail = page.getByTestId('tx-detail');
	await detail.getByTestId('tx-find-tab-alle').click();
	const choice = (/** @type {string} */ name) =>
		detail.getByTestId('tx-choice').filter({ hasText: name });
	const peek = page.getByTestId('receipt-peek');

	// Rest on the row: the preview beside the detail, page 1 rendered.
	await choice('Papierwerk Beispiel GmbH').hover();
	await expect(peek).toBeVisible();
	await expect(peek).toHaveAttribute('data-side', 'left');
	await expect(peek).toContainText('Papierwerk Beispiel GmbH');
	const page1 = peek.getByTestId('tx-receipt-preview');
	await expect(page1).toHaveAttribute('data-rendered', 'true');
	const panel = await detail.boundingBox();
	const box = await peek.boundingBox();
	expect(box && panel && box.x + box.width <= panel.x).toBe(true);

	// Into the page: the lens follows the pointer.
	const at = await page1.boundingBox();
	if (!at) throw new Error('no page');
	await page.mouse.move(at.x + at.width * 0.3, at.y + at.height * 0.1);
	const lens = peek.getByTestId('receipt-lens');
	await expect(lens).toBeVisible();
	await expect(lens).toHaveAttribute('data-zoom', '2.5');
	await page.mouse.move(at.x + at.width * 0.6, at.y + at.height * 0.2);
	await expect(lens).toBeVisible();

	// Away from both: closed.
	await page.mouse.move(5, 5);
	await expect(peek).toHaveCount(0);

	// An unconfirmed sender: no preview.
	await choice('Absender Ungeprüft Ltd').hover();
	await page.waitForTimeout(700);
	await expect(peek).toHaveCount(0);
	await page.mouse.move(5, 5);

	// By keyboard: focus opens it, Esc closes it – and only it.
	await choice('Papierwerk Beispiel GmbH').getByTestId('tx-choose').focus();
	await expect(peek).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(peek).toHaveCount(0);
	await expect(detail).toBeVisible();

	// Narrow: by the row, not beside the detail.
	await page.setViewportSize({ width: 420, height: 900 });
	await choice('Papierwerk Beispiel GmbH').hover();
	await expect(peek).toBeVisible();
	await expect(peek).toHaveAttribute('data-side', /below|above/);
	const row = await choice('Papierwerk Beispiel GmbH').boundingBox();
	const near = await peek.boundingBox();
	expect(
		row && near && (near.y >= row.y + row.height - 1 || near.y + near.height <= row.y + 1)
	).toBe(true);
});

test('in the lists: a payment shows its receipt, the Belege list each receipt', async ({
	page
}) => {
	await books(page);
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const row = page.getByTestId('transaction').filter({ hasText: 'Unbekannter Händler' });
	const peek = page.getByTestId('receipt-peek');

	// No receipt yet: nothing to show.
	await row.hover();
	await page.waitForTimeout(700);
	await expect(peek).toHaveCount(0);

	// Linked by hand, then the payment shows it.
	await row.click();
	const detail = page.getByTestId('tx-detail');
	await detail.getByTestId('tx-find-tab-alle').click();
	await detail
		.getByTestId('tx-choice')
		.filter({ hasText: 'Papierwerk Beispiel GmbH' })
		.getByTestId('tx-choose')
		.click();
	await detail.getByTestId('tx-detail-close').click();
	await page.mouse.move(5, 5);
	await row.hover();
	await expect(peek).toBeVisible();
	await expect(peek).toHaveAttribute('data-receipt', /.+/);
	await expect(peek).toContainText('Papierwerk Beispiel GmbH');
	await expect(peek.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
	const page1 = await peek.getByTestId('tx-receipt-preview').boundingBox();
	if (!page1) throw new Error('no page');
	await page.mouse.move(page1.x + page1.width * 0.3, page1.y + page1.height * 0.1);
	await expect(peek.getByTestId('receipt-lens')).toBeVisible();
	// Esc closes it; the page stays.
	await page.keyboard.press('Escape');
	await expect(peek).toHaveCount(0);

	// The Belege list: each receipt, the unconfirmed one not.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	const receipt = (/** @type {string} */ name) =>
		page.getByTestId('receipt').filter({ hasText: name });
	await receipt('Papierwerk Beispiel GmbH').hover();
	await expect(peek).toBeVisible();
	await expect(peek).toContainText('48,90 EUR');
	await expect(peek.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
	// Opening the receipt closes the preview.
	await receipt('Papierwerk Beispiel GmbH').click();
	await expect(peek).toHaveCount(0);
	await page.mouse.move(5, 5);
	await receipt('Absender Ungeprüft Ltd').hover();
	await page.waitForTimeout(700);
	await expect(peek).toHaveCount(0);
});

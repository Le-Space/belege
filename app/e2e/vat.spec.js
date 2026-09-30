// Input VAT on Home (issue #195): per quarter and for the year from the
// receipts as read; foreign VAT and §13b apart; per month and the small-business
// note follow the settings under Buchhaltung. Made-up receipts, written through
// the store.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const year = new Date().getFullYear();
/** @param {string} day @param {Record<string, any>} extraction */
const receipt = (day, extraction) => ({
	source: 'upload',
	fileName: 'beleg.pdf',
	documentDate: `${year}-${day}`,
	status: 'neu',
	extraction: { document_type: 'invoice', currency: 'EUR', ...extraction }
});
const RECEIPTS = [
	receipt('01-15', {
		vendor: 'Büromiete Muster GmbH',
		gross: 119,
		vat: [{ rate: 19, amount: 19 }]
	}),
	receipt('02-10', { vendor: 'Buchladen Beispiel', gross: 107, vat: [{ rate: 7, amount: 7 }] }),
	receipt('05-03', { vendor: 'Hosting Testdienst', gross: 238, vat: [{ rate: 19, amount: 38 }] }),
	receipt('05-04', { vendor: 'Alpen Software GmbH', gross: 120, vat: [{ rate: 20, amount: 20 }] }),
	receipt('05-05', {
		vendor: 'Cloud Example Ltd',
		gross: 200,
		net: 200,
		vat: [],
		reverse_charge: true
	})
];

test('Home shows the input VAT per quarter; the settings switch to months and to §19', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Vorsteuer');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(
		(receipts) => /** @type {any} */ (window).__belegeE2E.bench.putMany('receipts', receipts),
		RECEIPTS
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();

	const card = page.getByTestId('home-vat');
	await expect(card).toBeVisible();
	const period = (/** @type {string} */ key) =>
		card.locator(`[data-testid="vat-period"][data-period="${key}"]`);
	await expect(card.getByTestId('vat-period')).toHaveCount(4);
	await expect(period('Q1').getByTestId('vat-period-total')).toContainText('26,00');
	await expect(period('Q2').getByTestId('vat-period-total')).toContainText('38,00');
	await expect(card.getByTestId('vat-year-total')).toContainText('64,00');
	await expect(card.getByTestId('vat-foreign')).toContainText('20,00');
	await expect(card.getByTestId('vat-reverse')).toContainText('200,00');
	await expect(card.getByTestId('vat-unlinked')).toContainText('64,00');

	// Monthly, under Buchhaltung.
	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-vat-period').selectOption('month');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(card.getByTestId('vat-period')).toHaveCount(12);
	await expect(period(`${year}-05`).getByTestId('vat-period-total')).toContainText('38,00');

	// A small business deducts none: a note instead of the table.
	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-small-business').check();
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(card.getByTestId('vat-small-business')).toContainText('84,00');
	await expect(card.getByTestId('vat-period')).toHaveCount(0);
});

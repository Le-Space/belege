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

/** A made-up own invoice, as the invoicing app sends it (ucep/issued.js). @param {string} day @param {number} gross @param {any} [vat] */
const own = (day, gross, vat) => ({
	source: 'invoice-app',
	ownInvoice: true,
	confirmedByUser: true,
	status: 'ausgelesen',
	vendor: 'Eigene Rechnung',
	documentDate: `${year}-${day}`,
	amountCents: Math.round(gross * 100),
	currency: 'EUR',
	extraction: {
		document_type: 'invoice',
		currency: 'EUR',
		invoice_date: `${year}-${day}`,
		gross,
		...(vat === undefined ? {} : { vat })
	}
});

test('output VAT from own invoices: Ist waits for the money, Soll counts the invoice date, the payable is the difference', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Umsatzsteuer');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(
		(receipts) => /** @type {any} */ (window).__belegeE2E.bench.putMany('receipts', receipts),
		[
			...RECEIPTS,
			own('02-20', 1190, [{ rate: 19, amount: 190 }]),
			own('05-10', 107, [{ rate: 7, amount: 7 }]),
			// The app said nothing about its VAT.
			own('05-20', 500)
		]
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	const card = page.getByTestId('home-vat');
	const period = (/** @type {string} */ key) =>
		card.locator(`[data-testid="vat-period"][data-period="${key}"]`);

	// Ist (the default): nothing paid yet, so nothing due yet; the payable is a refund.
	await expect(card).toContainText(`Umsatzsteuer ${year}`);
	await expect(period('Q1').getByTestId('vat-period-output')).toContainText('0,00');
	await expect(card.getByTestId('vat-output-open')).toContainText('197,00');
	await expect(card.getByTestId('vat-output-missing')).toContainText(
		'Rechnungen ohne Steuerangabe'
	);
	await expect(card.getByTestId('vat-year-due')).toContainText('-64,00');

	// Soll: on the invoice date.
	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-vat-basis').selectOption('soll');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(period('Q1').getByTestId('vat-period-output')).toContainText('190,00');
	// Q1: 190 output − 26 input = 164 payable; Q2: 7 − 38 = −31.
	await expect(period('Q1').getByTestId('vat-period-due')).toContainText('164,00');
	await expect(period('Q2').getByTestId('vat-period-due')).toContainText('-31,00');
	await expect(card.getByTestId('vat-year-due')).toContainText('133,00');
	await expect(card.getByTestId('vat-output-open')).toHaveCount(0);

	// A small business: its turnover against the limit, no VAT payable.
	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-small-business').check();
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(card.getByTestId('vat-turnover')).toContainText('100.000,00');
	await expect(card.getByTestId('vat-period-due')).toHaveCount(0);
});

test('an own invoice among the receipts: never input VAT, its VAT is output VAT (#354)', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Eigene Rechnung');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(
		(receipts) => /** @type {any} */ (window).__belegeE2E.bench.putMany('receipts', receipts),
		[
			receipt('01-15', {
				vendor: 'Büromiete Muster GmbH',
				gross: 119,
				vat: [{ rate: 19, amount: 19 }]
			}),
			// Read like any receipt, from a PDF: our own invoice, by our name.
			{
				...receipt('02-20', {
					vendor: 'Muster Beispiel UG',
					invoice_number: 'RE-2026-9',
					gross: 1190,
					vat: [{ rate: 19, amount: 190 }]
				}),
				vendor: 'Muster Beispiel UG',
				invoiceNumber: 'RE-2026-9',
				amountCents: 119000,
				status: 'ausgelesen'
			}
		]
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	const card = page.getByTestId('home-vat');
	// Not yet told the company's name: the own invoice looks like a received one.
	await expect(card.getByTestId('vat-year-total')).toContainText('209,00');

	await page.getByTestId('settings-link').click();
	await page.getByTestId('company-names').fill('Muster Beispiel UG');
	await page.getByTestId('datev-vat-basis').selectOption('soll');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(card.getByTestId('vat-year-total')).toContainText('19,00');
	await expect(card.getByTestId('vat-year-output')).toContainText('190,00');
	await expect(card.getByTestId('vat-year-due')).toContainText('171,00');

	// In Belege it says so, and the person may say otherwise.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	const all = page.locator('[data-month="all"]');
	if (await all.count()) await all.first().click();
	await page.getByTestId('receipt').filter({ hasText: 'Muster Beispiel UG' }).click();
	await expect(page.getByTestId('field-own')).toHaveAttribute('data-own', 'true');
	await page.getByTestId('own-invoice-toggle').click();
	await expect(page.getByTestId('field-own')).toHaveAttribute('data-own', 'false');
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(card.getByTestId('vat-year-total')).toContainText('209,00');
});

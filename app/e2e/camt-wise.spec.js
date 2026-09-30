// A CAMT.053 from Wise (issue #218): an account without an IBAN and entries
// without transaction details are imported – without the bridge – with the
// merchant as counterparty, the fee as a fee beside its payment, and the
// amount in the currency it was paid in. A made-up fixture.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const WISE = fileURLToPath(new URL('../src/lib/bank/fixtures/camt053-wise.xml', import.meta.url));

test('a Wise statement imports: merchants, fees, the original currency', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Wise');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByTestId('setup-start-file').click();
	await page.getByTestId('camt-file').setInputFiles(WISE);
	await expect(page.getByTestId('camt-error')).toHaveCount(0);
	await expect(page.getByTestId('camt-result')).toContainText('Wise Example SA EUR');
	await expect(page.getByTestId('camt-result')).toContainText('···0042');
	await expect(page.getByTestId('camt-result')).toContainText(
		'Neu: 5 · Aktualisiert: 0 · Übersprungen: 0 · 1 vorgemerkt'
	);
	// Again: the entries are known by their codes.
	await page.getByTestId('camt-file').setInputFiles(WISE);
	await expect(page.getByTestId('camt-result')).toContainText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 5'
	);

	await page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await expect(rows).toHaveCount(5);
	await expect(rows.filter({ hasText: 'Example Cloud Shop' })).toHaveCount(1);
	await expect(rows.filter({ hasText: 'Musterladen Berlin' })).toHaveCount(1);
	// The fee needs no receipt: the statement is its receipt.
	const fee = rows.filter({ hasText: 'Wise Charges for' });
	await expect(fee).toHaveCount(1);
	await expect(fee).not.toContainText('ohne Beleg');

	// The payment shows what was paid in its own currency, and the bank's rate.
	await rows.filter({ hasText: 'Example Cloud Shop' }).click();
	await expect(page.getByTestId('tx-detail-original')).toContainText('12.35 USD');
	await expect(page.getByTestId('tx-detail-original')).toContainText('1.07391');
});

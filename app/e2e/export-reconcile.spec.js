// A statement whose bookings do not lead to its closing balance says so
// (#287): on Export, by the account's name. Every wallet and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('Export names the statements that are not reconciled', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		/** @param {string} name @param {string} balance */
		const wallet = (name, balance) =>
			e2e.addAccount({
				source: 'bitcoin',
				sourceAccountId: `${name}:BTC`,
				ibanLast4: '',
				name,
				currency: 'EUR',
				kind: 'wallet',
				asset: 'BTC',
				decimals: 8,
				fullHistory: true,
				balance,
				balanceOn: '2025-04-10'
			});
		// One wallet's bookings give its balance, the other's leave 0.006 BTC out.
		for (const [name, balance] of [
			['Wallet Abgestimmt', '0.00400000'],
			['Wallet Lücke', '0.01000000']
		]) {
			const account = await wallet(name, balance);
			await e2e.addTransaction({
				accountId: account.id,
				source: 'bitcoin',
				currency: 'EUR',
				bookedOn: '2025-03-12',
				amountCents: 24000,
				counterparty: 'Beispieladresse',
				purpose: 'Eingang',
				asset: 'BTC',
				quantity: '400000',
				decimals: 8,
				valuation: {
					rate: '60000',
					currency: 'EUR',
					source: 'coingecko',
					at: '2025-03-12T00:00:00Z'
				}
			});
		}
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await expect(page.getByTestId('export-month-select')).toHaveValue('2025-03');
	await expect(page.getByTestId('export-summary')).toContainText('2 Kontoauszüge');
	const warning = page.getByTestId('export-unreconciled');
	await expect(warning).toContainText('Nicht abgestimmt: Wallet Lücke');
	await expect(warning).not.toContainText('Wallet Abgestimmt');

	// Without statements, nothing to reconcile.
	await page.getByTestId('export-with-statements').uncheck();
	await expect(warning).toHaveCount(0);
});

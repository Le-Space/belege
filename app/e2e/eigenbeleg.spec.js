// "Eigenbeleg erstellen" end to end, without a bridge: a made-up crypto
// payment without any receipt gets an Eigenbeleg from its detail view; the
// Eigenbeleg is linked, listed among the receipts, and in the Verlauf.
import { test, expect } from '@playwright/test';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a payment without a receipt gets an Eigenbeleg, linked and in the Verlauf', async ({
	page
}) => {
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: '2026-09-01',
			counterparty: 'Stromwerk Test AG',
			purpose: 'Lease-Zahlung',
			amountCents: -1234,
			currency: 'EUR',
			movement: 'transfer',
			txRef: 'ABC123',
			asset: 'AKT',
			quantity: '-4200000',
			decimals: 6,
			valuation: {
				rate: '2.938095',
				currency: 'EUR',
				source: 'coingecko',
				at: '2026-09-01T00:00:00Z'
			}
		});
	});

	await tab('Zahlungen').click();
	const row = page.getByTestId('transaction').filter({ hasText: 'Stromwerk Test AG' });
	await expect(row).toHaveCount(1);
	await row.click();
	await expect(page.getByTestId('tx-detail-quantity')).toContainText('-4,2');

	await page.getByTestId('tx-eigenbeleg-open').click();
	await expect(page.getByTestId('tx-eigenbeleg-reason')).toHaveValue(/Blockchain/);
	await page.getByTestId('tx-eigenbeleg-description').fill('Rechenzeit für einen Monat (Lease)');
	await page.getByTestId('tx-eigenbeleg-create').click();

	await expect(page.getByTestId('tx-linked-vendor')).toContainText('Eigenbeleg');
	await expect(page.getByTestId('tx-eigenbeleg')).toHaveCount(0);
	await page.getByTestId('tx-detail-close').click();

	await tab('Belege').click();
	await expect(page.getByText('Eigenbeleg').first()).toBeVisible();

	await tab('Home').click();
	await page.getByTestId('home-verlauf').click();
	await expect(
		page.getByTestId('verlauf-title').filter({ hasText: 'Eigenbeleg erstellt und zugeordnet' })
	).toHaveCount(1);
});

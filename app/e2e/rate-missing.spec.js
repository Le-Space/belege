// A crypto booking without a rate (issue #162): kept with its quantity and
// "Kurs fehlt", the rate entered by hand, the euro amount follows. Made-up data.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('navigation').getByRole('link', { name });

test('a booking without a rate: shown, the rate entered by hand, the amount follows', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(async () => {
		await /** @type {any} */ (window).__belegeE2E.addTransaction({
			bookedOn: '2026-07-02',
			source: 'ethereum',
			movement: 'transfer',
			counterparty: 'Beispiel Token-Projekt',
			purpose: 'Empfangen · Tx 0xcdcdcdcd…cdcd',
			amountCents: 0,
			currency: 'EUR',
			asset: 'NEW',
			quantity: '140000000000000000000',
			decimals: 18,
			valuation: null,
			rateMissing: { reason: 'no rate found for NEW on 2026-07-02' }
		});
	});

	await tab(page, 'Zahlungen').click();
	await page.getByTestId('filter-all').click();
	await page.getByTestId('transaction').filter({ hasText: 'Beispiel Token-Projekt' }).click();
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-rate-missing')).toContainText('Kurs fehlt');
	await detail.getByTestId('tx-rate-input').fill('1,5');
	await detail.getByTestId('tx-rate-save').click();
	await expect(detail.getByTestId('tx-rate-missing')).toHaveCount(0);
	await expect(detail).toContainText(/210,00\sEUR/);
	await detail.getByTestId('tx-detail-close').click();
});

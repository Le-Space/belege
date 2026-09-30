// Income and expenses on Home (issue #194): the four sums of the year, bank
// and crypto apart, and the balance; a trade on the exchange counts as neither,
// a private payment stands on its own line; a sum leads to the bookings it
// counts. Made-up bookings, written through the store.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const day = new Date().toISOString().slice(0, 10);
const BOOKINGS = [
	{ counterparty: 'Kundin Beispiel AG', amountCents: 500_00, source: 'hibiscus' },
	{ counterparty: 'Büromiete Muster GmbH', amountCents: -120_00, source: 'hibiscus' },
	{ counterparty: 'Hosting Testdienst', amountCents: -40_00, source: 'kraken' },
	// A crypto sale to euros on the exchange: a swap, neither income nor expense.
	{ counterparty: 'Kraken', amountCents: -300_00, source: 'kraken', movement: 'trade' },
	{ counterparty: 'Kraken', amountCents: 300_00, source: 'kraken', movement: 'trade' },
	{
		counterparty: 'Privater Einkauf',
		amountCents: -60_00,
		source: 'hibiscus',
		privateMistake: { note: 'privat', at: `${day}T10:00:00.000Z` }
	}
];

test('Home sums income and expenses; a sum leads to its bookings', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Summen');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(
		async ({ bookings, day }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			for (const b of bookings) await e2e.addTransaction({ bookedOn: day, purpose: 'Test', ...b });
		},
		{ bookings: BOOKINGS, day }
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();

	const card = page.getByTestId('home-totals');
	await expect(card).toBeVisible();
	await expect(card.getByTestId('totals-bank-income')).toContainText('500,00');
	await expect(card.getByTestId('totals-bank-expenses')).toContainText('120,00');
	await expect(card.getByTestId('totals-crypto-income')).toContainText('0,00');
	await expect(card.getByTestId('totals-crypto-expenses')).toContainText('40,00');
	await expect(card.getByTestId('totals-income')).toContainText('500,00');
	await expect(card.getByTestId('totals-expenses')).toContainText('160,00');
	await expect(card.getByTestId('totals-balance')).toContainText('340,00');
	await expect(card.getByTestId('totals-private')).toContainText('60,00');
	await expect(card.getByTestId('totals-loans')).toHaveCount(0);

	// The sum leads to the bookings it counts – here the one bank expense.
	await card.getByTestId('totals-bank-expenses').click();
	await expect(page.getByTestId('flow-filter')).toHaveAttribute('data-flow', 'bank-expenses');
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText('Büromiete Muster GmbH');
	await page.getByTestId('flow-filter-clear').click();
	await expect(page.getByTestId('transaction')).toHaveCount(BOOKINGS.length);
});

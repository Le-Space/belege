// "Privat (Irrläufer)" (issue #172): a private purchase paid from the business
// account is marked private on its own, documented, suggested on the
// shareholder clearing account of a UG, open on Home until the repayment is
// linked. Made-up bookings only.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('navigation').getByRole('link', { name });

test('a private payment: marked, documented, open on Home, settled by its repayment', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// A UG, and the clearing account the tax adviser named (made up).
	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-legal-form').selectOption('corporation');
	await page.getByTestId('datev-shareholder-account').fill('1545');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// Two payments to the same provider – only one of them is private – and the repayment.
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addTransaction({
			bookedOn: '2026-02-11',
			counterparty: 'Beispiel Zahlungsdienst',
			purpose: 'Ihr Einkauf bei Beispiel Shop',
			amountCents: -4990,
			currency: 'EUR'
		});
		await e2e.addTransaction({
			bookedOn: '2026-02-18',
			counterparty: 'Beispiel Zahlungsdienst',
			purpose: 'Ihr Einkauf bei Beispiel Software',
			amountCents: -1200,
			currency: 'EUR'
		});
		await e2e.addTransaction({
			bookedOn: '2026-03-02',
			counterparty: 'Max Beispiel',
			purpose: 'Erstattung private Zahlung',
			amountCents: 4990,
			currency: 'EUR'
		});
	});

	await tab(page, 'Zahlungen').click();
	await page.getByTestId('filter-all').click();
	const month = (/** @type {string} */ name) =>
		page.getByTestId('transaction-month').filter({ hasText: name });
	await month('Februar 2026').click();
	const row = (/** @type {string} */ text) =>
		page.getByTestId('transaction').filter({ hasText: text });
	await row('Beispiel Shop').click();
	const detail = page.getByTestId('tx-detail');
	await detail.getByTestId('tx-alt-toggle').click();
	await detail.getByTestId('tx-private-mark').click();
	await expect(detail.getByTestId('tx-private-text')).toHaveValue(/Kein Betriebsausgabenbeleg/);
	await detail.getByTestId('tx-private-save').click();
	await expect(detail.getByTestId('tx-private')).toContainText('Privat (Irrläufer)');
	await expect(detail.getByTestId('tx-private-state')).toContainText('49,90');
	// On the UG's clearing account, by the legal form.
	await expect(detail.getByTestId('tx-booking-account')).toHaveValue('1545');
	await detail.getByTestId('tx-detail-close').click();
	await expect(row('Beispiel Shop').getByTestId('coverage-badge')).toHaveText('Privat (Irrläufer)');
	// The other payment to the same provider is untouched.
	await expect(row('Beispiel Software').getByTestId('coverage-badge')).toHaveCount(0);

	// Open on Home until paid back.
	await tab(page, 'Home').click();
	const open = page.getByTestId('home-private-open');
	await expect(open).toContainText('noch nicht ausgeglichen: 1');
	await open.getByTestId('home-private-open-item').click();
	await expect(detail.getByTestId('tx-private')).toBeVisible();
	await detail.getByTestId('tx-private-repay').click();
	await detail.getByTestId('tx-private-repay-pick').first().click();
	await expect(detail.getByTestId('tx-private-state')).toHaveText('Ausgeglichen.');
	await detail.getByTestId('tx-detail-close').click();
	await page.getByTestId('filter-all').click();
	await month('März 2026').click();
	await expect(row('Erstattung private Zahlung').getByTestId('coverage-badge')).toHaveText(
		'Rückzahlung privat'
	);
	await tab(page, 'Home').click();
	await expect(page.getByTestId('home-private-open')).toHaveCount(0);
});

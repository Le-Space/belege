// Sample books (issue #200, step 3): "Erst umsehen" fills the books with
// made-up payments and receipts, a banner on every page says so, the export
// refuses to mix them with a real booking, and one click takes them out.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

// The sample lies in the month before today's.
const now = new Date();
const before = new Date(now.getFullYear(), now.getMonth() - 1, 15);
const MONTH = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}`;

test('look around with sample data, marked everywhere, never mixed, removed with a click', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Beispiel');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	/** @param {string} name */
	const tab = (name) => page.getByRole('link', { name, exact: true });
	const banner = page.getByTestId('sample-banner');
	await expect(banner).toHaveCount(0);
	await page.getByTestId('setup-start-look').click();
	await expect(banner).toBeVisible({ timeout: 60_000 });

	// Sample books set nothing up: the checklist still has everything to do.
	const card = page.getByTestId('setup-home');
	await expect(card.getByTestId('setup-progress')).toHaveText('0 von 5 erledigt');
	await expect(page.getByTestId('home-totals')).toBeVisible();

	// On every page, and the bookings are there.
	await tab('Zahlungen').click();
	await expect(banner).toBeVisible();
	await page.getByTestId('filter-all').click();
	await expect(page.getByTestId('transaction').first()).toBeVisible();
	await tab('Belege').click();
	await expect(banner).toBeVisible();

	// A month of sample data alone can be tried; beside a real booking it is refused.
	await tab('Export').click();
	await page.getByTestId('export-month-select').selectOption(MONTH);
	const sample = page.locator('[data-testid="export-check"][data-check="sample"]');
	await expect(sample).toHaveAttribute('data-state', 'warning');
	await page.evaluate(
		(day) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: day,
				counterparty: 'Echte Buchung Test',
				purpose: 'Test',
				amountCents: -1000
			}),
		`${MONTH}-14`
	);
	await expect(sample).toHaveAttribute('data-state', 'blocker');
	await expect(page.getByTestId('export-download')).toBeDisabled();

	// One click, and only the real booking is left.
	await banner.getByTestId('sample-remove').click();
	await expect(banner).toHaveCount(0, { timeout: 60_000 });
	await expect(sample).toHaveCount(0);
	await tab('Zahlungen').click();
	await page.getByTestId('filter-all').click();
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText('Echte Buchung Test');
	await tab('Belege').click();
	await expect(page.getByTestId('receipt')).toHaveCount(0);
});

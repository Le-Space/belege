// A learned bank fee is seen and dropped where it applies (#320): "Bankgebühr"
// on one booking covers the next with the same purpose; its reason names the
// rule and offers "Diese Regel vergessen"; forgotten, the booking asks for a
// receipt again. Every booking is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const TODAY = new Date('2026-10-25T10:00:00Z');

test('a learned bank fee shows its rule, and can be forgotten from the booking', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.clock.install({ time: TODAY });
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const bank = await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0042',
			ibanLast4: '0042',
			name: 'Geschäftskonto Test',
			currency: 'EUR'
		});
		for (const [day, month] of [
			['2026-10-05', '09'],
			['2026-10-20', '10']
		]) {
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: day,
				amountCents: -390,
				counterparty: '',
				purpose: `Porto ${month}/2026`
			});
		}
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	const detail = page.getByTestId('tx-detail');

	// "Bankgebühr" on the September one.
	await rows.filter({ hasText: 'Porto 09/2026' }).click();
	await detail.getByTestId('tx-alt-toggle').click();
	await detail.getByTestId('tx-bank-fee').click();
	await detail.getByTestId('tx-detail-close').click();

	// The October one is covered by what was learned, and says so.
	await rows.filter({ hasText: 'Porto 10/2026' }).click();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText('schon einmal eingeordnet');
	await detail.getByTestId('tx-fee-rule-forget').click();
	await expect(detail.getByTestId('tx-fee-rule-forget')).toHaveCount(0);
	await expect(detail.getByTestId('tx-why-rule')).toHaveCount(0);
	await detail.getByTestId('tx-detail-close').click();
	await expect(rows.filter({ hasText: 'Porto 10/2026' }).getByTestId('coverage-badge')).toHaveCount(
		0
	);
});

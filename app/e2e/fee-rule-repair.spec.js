// Wrongly learned bank fees, found after the update (#320): a key learned
// before the check from a vendor's monthly debit no longer covers its
// bookings; Home lists them and forgets the rule. Every booking is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const TODAY = new Date('2026-10-25T10:00:00Z');

test('Home names payments a learned bank fee wrongly covered, and forgets the rule', async ({
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
			['2026-09-21', '09'],
			['2026-10-21', '10']
		]) {
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: day,
				amountCents: -5259,
				counterparty: 'Kabel Beispiel GmbH',
				bookingType: 'Basislastschrift',
				purpose: `${month}/2026 K-NR. 000000001 Ihre Rechnung online bei www.beispiel.de/meinkabel`
			});
		}
		// The rule as it was learned before the check: account | purpose words.
		await e2e.bench.putMany('settings', [
			{
				key: 'matching',
				value: {
					feeKeys: [`${bank.id}|nr ihre rechnung online bei www beispiel de meinkabel`]
				}
			}
		]);
		await e2e.runMatching();
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Home' }).click();
	const card = page.getByTestId('home-wrong-fees');
	await expect(card).toContainText('2 Zahlungen waren fälschlich als Bankgebühr eingeordnet');
	await expect(card.getByTestId('home-wrong-fee')).toHaveCount(2);

	// They are no longer covered: Zahlungen asks for their receipts.
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await expect(page.getByTestId('filter-without-receipt')).toContainText('(2)');

	await page.getByRole('navigation').getByRole('link', { name: 'Home' }).click();
	await card.getByTestId('home-wrong-fees-forget').click();
	await expect(card).toHaveCount(0);
});

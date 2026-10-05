// "Ist das ein eigenes Konto?" (issue #256), end to end with made-up books: the
// business account sends money to an IBAN (the bank names the payee "Wise
// Europe SA") and gets it back from the same IBAN under the company's own name.
// The way back is an own transfer by the name; the way there is not, until the
// IBAN is saved as own – offered on Home, saved with one click. A customer whose
// name only looks like the company's is offered too, and refused in the detail.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const COMPANY = 'Musterfirma UG';
const WISE = 'BE00999900001111';
const CUSTOMER = 'DE00123400005678';

// The app's today in this spec (page.clock): the payments lie a few days
// before it, all in its month – Zahlungen opens that month only, so in the
// first days of a real month the earlier ones would be folded away.
const TODAY = new Date('2026-10-20T10:00:00Z');

/** @param {import('@playwright/test').Page} page */
async function seed(page) {
	const day = (/** @type {number} */ back) =>
		new Date(TODAY.getTime() - back * 864e5).toISOString().slice(0, 10);
	await page.evaluate(
		async ({ WISE, CUSTOMER, days }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const bank = await e2e.addAccount({
				source: 'hibiscus',
				sourceAccountId: '0042',
				ibanLast4: '0042',
				name: 'Geschäftskonto Test',
				currency: 'EUR'
			});
			/** @param {Record<string, any>} tx */
			const add = (tx) =>
				e2e.addTransaction({ accountId: bank.id, source: 'hibiscus', currency: 'EUR', ...tx });
			await add({
				bookedOn: days[0],
				amountCents: -17200,
				counterparty: 'Wise Europe SA',
				counterpartyIban: WISE,
				purpose: 'Aufladung'
			});
			await add({
				bookedOn: days[1],
				amountCents: 17200,
				counterparty: 'Musterfirma UG',
				counterpartyIban: WISE,
				purpose: 'Rueckzahlung'
			});
			await add({
				bookedOn: days[2],
				amountCents: -12000,
				counterparty: 'Wise Europe SA',
				counterpartyIban: WISE,
				purpose: 'Aufladung'
			});
			await add({
				bookedOn: days[3],
				amountCents: 4500,
				counterparty: 'Musterfirma UG Kunde',
				counterpartyIban: CUSTOMER,
				purpose: 'Rechnung 17'
			});
			await e2e.runMatching();
		},
		{ WISE, CUSTOMER, days: [day(10), day(8), day(6), day(4)] }
	);
}

test('an IBAN that sends under our name is offered as own, and explains the payments to it', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.clock.install({ time: TODAY });
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Integrationen' }).click();
	await page.getByTestId('settings-link').click();
	await page.getByTestId('company-names').fill(COMPANY);
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await seed(page);

	// Home: both IBANs are offered; the Wise one explains the two open payments.
	await page.getByRole('link', { name: 'Home' }).click();
	const offers = page.getByTestId('own-iban-offer');
	await expect(offers).toHaveCount(2);
	const wise = offers.filter({ hasText: 'BE00 9999 0000 1111' });
	await expect(wise.getByTestId('own-iban-offer-explains')).toHaveText(
		'Erklärt 2 Zahlungen ohne Beleg an diese IBAN.'
	);
	await expect(wise).toContainText('„Musterfirma UG“ (1×)');

	// "Ja, eigenes Konto": both payments to it are own transfers now.
	await wise.getByTestId('own-iban-offer-yes').click();
	await expect(offers).toHaveCount(1);
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const toWise = page.getByTestId('transaction').filter({ hasText: 'Wise Europe SA' });
	await expect(toWise).toHaveCount(2);
	for (const row of await toWise.all()) {
		await expect(row.getByTestId('coverage-badge')).toHaveText('Eigene Umbuchung');
	}
	await toWise.first().click();
	await expect(page.getByTestId('tx-why-rule-line')).toContainText('···1111');

	// The customer whose name looks like ours: offered in the detail, refused there – for good.
	await page.getByTestId('tx-detail-close').click();
	await page.getByTestId('transaction').filter({ hasText: 'Kunde' }).click();
	const ask = page.getByTestId('tx-own-iban');
	await expect(ask).toContainText('DE00 1234 0000 5678');
	await ask.getByTestId('tx-own-iban-no').click();
	await expect(ask).toHaveCount(0);
	await page.getByTestId('tx-detail-close').click();
	await page.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByTestId('own-iban-offers')).toHaveCount(0);
});

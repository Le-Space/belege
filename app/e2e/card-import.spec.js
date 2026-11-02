// A company credit card (issue #382): added as an account, its statement read
// from the issuer's CSV in the browser – columns by their names, charges
// turned to money out – shown before the import, imported once, and its lines
// among the payments. A made-up statement, no issuer's real export.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const CSV = [
	'Kreditkartenabrechnung;Beispielbank Business Card',
	'',
	'Belegdatum;Buchungsdatum;Beschreibung;Betrag (EUR);Originalbetrag;Originalwährung;Kurs',
	'03.05.2026;04.05.2026;"Bahn Beispiel AG, Musterstadt";89,90;;;',
	'07.05.2026;09.05.2026;Taxi Beispiel Prag;24,73;"612,00";CZK;24,7480',
	'31.05.2026;31.05.2026;Zahlung erhalten - Danke;-114,63;;;'
].join('\r\n');
const file = { name: 'karte-mai.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') };

test('a credit card statement read from CSV, shown, imported once, among the payments', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Karte');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// The bank's debit that settles the card, a day after the statement (step 2).
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const bank = await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0042',
			ibanLast4: '0042',
			name: 'Geschäftskonto Test',
			currency: 'EUR'
		});
		await e2e.addTransaction({
			accountId: bank.id,
			source: 'hibiscus',
			currency: 'EUR',
			bookedOn: '2026-06-01',
			amountCents: -11_463,
			counterparty: 'Beispielbank',
			purpose: 'Lastschrift Kreditkarte',
			bookingType: 'Lastschrift'
		});
	});

	await page.getByTestId('setup-start-file').click();
	const cards = page.getByTestId('cards-card');
	await cards.getByTestId('card-add').click();
	await cards.getByTestId('card-name').fill('Firmenkarte Beispiel');
	await cards.getByTestId('card-last4').fill('4242');
	await cards.getByTestId('card-save').click();
	await expect(cards.getByTestId('card')).toContainText('Firmenkarte Beispiel ···4242');

	// Read: the columns recognised, the charges as money out, shown before anything is kept.
	await cards.getByTestId('card-file').setInputFiles(file);
	const preview = cards.getByTestId('card-preview');
	await expect(preview).toBeVisible();
	await expect(preview.getByTestId('card-map-originalAmount')).toHaveValue('4');
	await expect(preview.getByTestId('card-invert')).toBeChecked();
	await expect(preview.getByTestId('card-preview-line')).toHaveCount(3);
	await expect(preview.getByTestId('card-preview-line').nth(1)).toContainText(
		'612.00 CZK → -24,73 EUR'
	);
	await expect(preview.getByTestId('card-preview-line').nth(2)).toContainText(
		'Ausgleich vom Bankkonto'
	);
	await preview.getByTestId('card-import').click();
	await expect(cards.getByTestId('card-result')).toHaveText(
		'Firmenkarte Beispiel: 3 neu, 0 schon vorhanden.'
	);
	await expect(cards.getByTestId('card')).toContainText('3 Umsätze');

	// Again: the format remembered, nothing twice.
	await cards.getByTestId('card-file').setInputFiles(file);
	await expect(cards.getByTestId('card-invert')).toBeChecked();
	await cards.getByTestId('card-import').click();
	await expect(cards.getByTestId('card-result')).toHaveText(
		'Firmenkarte Beispiel: 0 neu, 3 schon vorhanden.'
	);

	// Among the payments of May.
	await page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	await page.locator('[data-testid="transaction-month"][data-month="2026-05"]').click();
	await page.getByTestId('filter-all').click();
	const rows = page.getByTestId('transaction');
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: 'Taxi Beispiel Prag' })).toContainText('24,73');
	// The card's settlement needs no receipt: it is the transfer from the bank.
	await expect(rows.filter({ hasText: 'Zahlung erhalten' })).not.toContainText('ohne Beleg');

	// And the bank's debit in June: an own transfer to the card, no receipt asked for.
	await page.locator('[data-testid="transaction-month"][data-month="2026-06"]').click();
	await page.getByTestId('filter-all').click();
	const debit = page.getByTestId('transaction').filter({ hasText: 'Lastschrift Kreditkarte' });
	await expect(debit).toHaveCount(1);
	await expect(debit).not.toContainText('ohne Beleg');
	await debit.click();
	await expect(page.getByTestId('tx-detail')).toContainText('Eigene Umbuchung');
});

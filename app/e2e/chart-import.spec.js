// "Kontenplan einlesen": a DATEV Kontenbeschriftungen file (Windows-1252, as
// DATEV writes it) is read, previewed, taken, suggested in "Konto", and
// removed again. Synthetic accounts only.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** A DATEV Kontenbeschriftungen file in Windows-1252 (ö = 0xF6). */
function datevChart() {
	const text = [
		'"EXTF";700;20;"Kontenbeschriftungen";3;20260901120000000;;"";"";"";1001;1;20260101;4;;;"";"";;;;"";;;;;;;;;',
		'Konto;Kontenbeschriftung;Sprach-ID',
		'1200;"Bank Konto A";"de-DE"',
		'4920;"Telefon und Mobilfunk";"de-DE"',
		'4964;"Software-Abos";"de-DE"',
		'8400;"Erlöse 19 % USt";"de-DE"'
	].join('\r\n');
	return Buffer.from([...text].map((c) => (c === 'ö' ? 0xf6 : c.charCodeAt(0))));
}

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('navigation').getByRole('link', { name });

test('a chart of accounts is read, previewed, taken, suggested and removed', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab(page, 'Integrationen').click();
	const chart = page.getByTestId('chart');
	await expect(chart).toContainText('Kontenplan');
	await chart.getByTestId('chart-how').locator('summary').click();
	await expect(chart.getByTestId('chart-how')).toContainText('MonKey Office');
	await expect(chart.getByTestId('chart-how')).toContainText('auf Anfrage');

	await chart.getByTestId('chart-file').setInputFiles({
		name: 'EXTF_Kontenbeschriftungen.csv',
		mimeType: 'text/csv',
		buffer: datevChart()
	});
	const preview = chart.getByTestId('chart-preview');
	await expect(preview).toContainText('4 Konten erkannt (DATEV-Kontenbeschriftungen)');
	await expect(preview).toContainText('8400 Erlöse 19 % USt');
	await chart.getByTestId('chart-take').click();
	await expect(chart.getByTestId('chart-current')).toContainText(
		'4 Konten aus „EXTF_Kontenbeschriftungen.csv“'
	);

	// "Konto" on a booking suggests from the chart now.
	await page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.addTransaction({
			bookedOn: '2026-08-22',
			counterparty: 'Mobilfunk Beispiel GmbH',
			purpose: 'Rechnung August',
			amountCents: -3999
		})
	);
	await tab(page, 'Zahlungen').click();
	await page.getByText('Mobilfunk Beispiel GmbH').first().click();
	const booking = page.getByTestId('tx-booking');
	await expect(booking.getByTestId('tx-booking-catalogue')).toContainText(
		'eingelesenen Kontenplan (4 Konten)'
	);
	await booking.getByTestId('tx-booking-account').fill('4920');
	await expect(booking.getByTestId('tx-booking-account-name')).toHaveText('Telefon und Mobilfunk');
	await booking.getByTestId('tx-booking-account').fill('4930');
	await expect(booking.getByTestId('tx-booking-account-name')).toContainText(
		'Nicht in deinem Kontenplan'
	);

	// Removed: back to the SKR 03 list.
	await page.getByTestId('tx-detail-close').click();
	await tab(page, 'Integrationen').click();
	await page.getByTestId('chart-drop').click();
	await expect(page.getByTestId('chart-current')).toHaveCount(0);
});

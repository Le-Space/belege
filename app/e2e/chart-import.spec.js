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

	await page.getByTestId('settings-link').click();
	const chart = page.getByTestId('chart');
	await expect(chart).toContainText('Kontenplan');
	await chart.getByTestId('chart-how').locator('summary').click();
	await expect(chart.getByTestId('chart-how')).toContainText('Kontenbeschriftungen');
	await expect(chart.getByTestId('chart-how')).toContainText('auf Anfrage');

	// The ⓘ beside the title: what is read, an example, and the example as a file.
	const info = chart.getByTestId('chart-formats');
	const layer = chart.getByTestId('chart-formats-tip');
	await expect(layer).toBeHidden();
	await info.hover();
	await expect(layer).toBeVisible();
	await expect(layer).toContainText('EXTF');
	await expect(chart.getByTestId('chart-formats-example')).toContainText('4922;KI-Dienste');
	await page.mouse.move(0, 0);
	await expect(layer).toBeHidden();
	await info.click();
	await expect(layer).toBeVisible();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		chart.getByTestId('chart-formats-download').click()
	]);
	expect(download.suggestedFilename()).toBe('kontenplan-beispiel.csv');
	const fs = await import('node:fs/promises');
	const example = await fs.readFile(/** @type {string} */ (await download.path()), 'utf8');
	expect(example).toBe('Konto;Bezeichnung\n4920;Telefon\n4922;KI-Dienste\n4930;Bürobedarf\n');
	await page.keyboard.press('Escape');
	await expect(layer).toBeHidden();

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

	// "Sachkonto in deiner Buchhaltung" offers the chart, not the SKR 03 placeholder.
	await page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0011',
			ibanLast4: '0011',
			name: 'Konto A Test',
			currency: 'EUR'
		})
	);
	const ledger = page.locator('[data-testid="ledger-account"][data-account="0011"]');
	await expect(ledger).toHaveAttribute('list', 'ledger-chart');
	await expect(ledger).toHaveAttribute('placeholder', '');
	await expect(page.getByTestId('books-settings')).toContainText(
		'eingelesenen Kontenplan (4 Konten)'
	);
	await ledger.fill('1200');
	await expect(page.getByTestId('ledger-account-name')).toHaveText('Bank Konto A');
	await ledger.fill('1210');
	await expect(page.getByTestId('ledger-account-name')).toContainText('Nicht in deinem Kontenplan');
	await ledger.fill('');

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
	await page.getByTestId('settings-link').click();
	await page.getByTestId('chart-drop').click();
	await expect(page.getByTestId('chart-current')).toHaveCount(0);
});

test('a chart that names the accounts of the books gives them their ledger accounts', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addAccount({
			source: 'kraken',
			sourceAccountId: 'BTC',
			ibanLast4: '',
			name: 'Kraken BTC',
			currency: 'EUR',
			kind: 'exchange',
			asset: 'BTC',
			decimals: 8
		});
		await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '4321',
			ibanLast4: '4321',
			name: 'Kontokorrent',
			currency: 'EUR'
		});
		// Nothing in the chart names this one: it stays empty.
		await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '9999',
			ibanLast4: '9999',
			name: 'Sparkonto',
			currency: 'EUR'
		});
	});

	await page.getByTestId('settings-link').click();
	const giro = page.locator('[data-testid="ledger-account"][data-account="4321"]');
	const savings = page.locator('[data-testid="ledger-account"][data-account="9999"]');
	await expect(giro).toHaveValue('');

	const chart = page.getByTestId('chart');
	await chart.getByTestId('chart-file').setInputFiles({
		name: 'kontenplan.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'Konto;Bezeichnung\n1200;Bank A Kontokorrent 4321\n1310;Kraken BTC\n1311;Kraken ETH\n4920;Telefon\n'
		)
	});
	await chart.getByTestId('chart-take').click();

	// Taken over at once, and said so.
	await expect(giro).toHaveValue('1200');
	await expect(page.getByTestId('ledger-from-chart')).toHaveCount(2);
	await expect(savings).toHaveValue('');
	const values = await page
		.locator('[data-testid="ledger-account"]')
		.evaluateAll((els) => els.map((e) => /** @type {HTMLInputElement} */ (e).value).sort());
	expect(values).toEqual(['', '1200', '1310']);

	// In the books, not only in the form: there after a reload and an unlock.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByTestId('settings-link').click();
	await expect(page.locator('[data-testid="ledger-account"][data-account="4321"]')).toHaveValue(
		'1200'
	);
});

// Bookings without an account onto a suspense account (#323): offered only
// once the settings name one, off by default; on, the export is no longer
// blocked, the line goes against that account without a BU key, and the
// overview says it is to be re-booked. Every booking is made up.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a booking without an account goes onto the suspense account, when asked', async ({
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
		const bank = await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0042',
			ibanLast4: '0042',
			name: 'Geschäftskonto Test',
			currency: 'EUR',
			ledgerAccount: '1200'
		});
		await e2e.addTransaction({
			accountId: bank.id,
			source: 'hibiscus',
			currency: 'EUR',
			bookedOn: '2025-03-12',
			amountCents: -2200,
			counterparty: 'Café Beispiel',
			purpose: 'Kartenzahlung',
			bookingType: 'Kartenzahlung'
		});
	});

	const nav = page.getByRole('navigation');
	const check = page.locator('[data-testid="export-check"][data-check="unassigned"]');
	// Without a suspense account in the settings: no switch, and the booking blocks.
	await nav.getByRole('link', { name: 'Export' }).click();
	await expect(page.getByTestId('export-month-select')).toHaveValue('2025-03');
	await expect(page.getByTestId('export-with-suspense')).toHaveCount(0);
	await expect(check).toHaveAttribute('data-state', 'blocker');
	await expect(page.getByTestId('export-download')).toBeDisabled();

	await page.getByTestId('settings-link').click();
	await page.getByTestId('datev-suspense-account').fill('1590');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// Offered now, off until switched on.
	await nav.getByRole('link', { name: 'Export' }).click();
	const toggle = page.getByTestId('export-with-suspense');
	await expect(toggle).not.toBeChecked();
	await expect(check).toHaveAttribute('data-state', 'blocker');
	await toggle.check();
	await expect(page.getByTestId('export-suspense-hint')).toContainText('zum Jahresende');
	await expect(check).toHaveAttribute('data-state', 'warning');
	await expect(check).toContainText('1 Buchungen gehen auf das Sammelkonto 1590');
	await expect(page.getByTestId('export-download')).toBeEnabled();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
	const batch = new TextDecoder('windows-1252').decode(
		zip['DATEV/EXTF_Buchungsstapel_2025-03.csv']
	);
	const line = batch.split('\r\n').find((l) => l.includes('Ungeklärt: Café Beispiel'));
	// Konto 1200, Gegenkonto the suspense account, no BU key.
	const fields = line?.split(';') ?? [];
	expect(fields.slice(0, 2)).toEqual(['22,00', '"H"']);
	expect(fields.slice(6, 9)).toEqual(['1200', '1590', '']);
	const overview = strFromU8(zip['Uebersicht_2025-03.csv']);
	expect(overview).toContain('auf Sammelkonto, umbuchen');

	// Remembered in this browser.
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('export-with-suspense')).toBeChecked();
});

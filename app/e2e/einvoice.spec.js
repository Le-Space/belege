// E-invoices (#160): an XRechnung uploaded as XML is kept as the original,
// read at once without the bridge or a model, shown as a view of its fields,
// matched to its payment, and exported as .xml. Every invoice, vendor and
// amount is made up (src/lib/receipts/einvoice.fixtures.js).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { UBL_INVOICE } from '../src/lib/receipts/einvoice.fixtures.js';

test('an XRechnung: kept as XML, read without AI, matched, exported', async ({ page }) => {
	/** @type {string[]} */
	const bridgeCalls = [];
	page.on('request', (r) => {
		if (/\/extract\b/.test(r.url())) bridgeCalls.push(r.url());
	});
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
			bookedOn: '2026-09-25',
			amountCents: -11900,
			counterparty: 'WOLKENBAU BEISPIEL GMBH',
			purpose: 'Rechnung WB-2026-0815',
			bookingType: 'Überweisung',
			booking: { account: '4930', taxKey: '9', confirmedAt: '2026-09-25T10:00:00Z', via: 'manual' }
		});
	});

	// Uploaded like any receipt.
	await page.getByTestId('upload-open').click();
	await page.getByTestId('receipt-upload').setInputFiles({
		name: 'rechnung-WB-2026-0815.xml',
		mimeType: 'application/xml',
		buffer: Buffer.from(UBL_INVOICE)
	});
	await expect(page.getByTestId('import-result')).toHaveText(
		'Neu: 1 · doppelt: 0 · nicht unterstützt: 0'
	);
	await page.getByTestId('upload-close').click();
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	const all = page.locator('[data-month="all"]');
	if (await all.count()) await all.first().click();
	const receipt = page.getByTestId('receipt').filter({ hasText: 'Wolkenbau Beispiel GmbH' });
	await expect(receipt).toHaveCount(1);
	await expect(receipt).toHaveAttribute('data-status', /ausgelesen|zugeordnet/);
	await receipt.click();

	// Read from the XML, without a model; shown as a view of the original.
	await expect(page.getByTestId('field-amount')).toContainText('119,00');
	await expect(page.getByTestId('field-invoice')).toContainText('WB-2026-0815');
	await expect(page.getByTestId('field-model')).toContainText('e-invoice (UBL)');
	const view = page.getByTestId('preview-einvoice');
	await expect(view).toContainText('Ansicht des XML-Originals');
	await expect(view).toContainText('Speicherpaket Beispiel September');
	await expect(view.getByTestId('einvoice-gross')).toContainText('119,00');
	expect(bridgeCalls).toEqual([]);

	// Matched to its payment.
	await page.evaluate(() => /** @type {any} */ (window).__belegeE2E.runMatching());
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('filter-all').click();
	const row = page.getByTestId('transaction').filter({ hasText: 'WOLKENBAU' });
	await expect(row.getByTestId('coverage-badge')).toHaveText('Beleg');

	// Exported as the XML it came as.
	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption('2026-09');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	const zip = unzipSync(
		new Uint8Array(await readFile(/** @type {string} */ (await download.path())))
	);
	const xml = Object.keys(zip).find((p) => p.startsWith('Belege/') && p.endsWith('.xml'));
	expect(xml).toMatch(/^Belege\/2026-09-001_Wolkenbau_Beispiel_GmbH\.xml$/);
	expect(new TextDecoder().decode(zip[/** @type {string} */ (xml)])).toBe(UBL_INVOICE);
});

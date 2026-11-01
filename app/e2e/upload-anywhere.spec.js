// Uploading receipts from every page (#308): the button in the header on
// Home, Zahlungen and Belege, its panel with a drop zone, files dropped on
// Zahlungen, the link to the new receipt; the old button on Belege is gone;
// on a phone a "+" above the tab bar opens the same panel. Every file is a
// made-up PDF.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** A tiny PDF with a text of its own (no reader needed: read-after is off without a bridge). */
const pdf = (/** @type {string} */ text) =>
	Buffer.from(
		`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`
	);

async function unlock(/** @type {import('@playwright/test').Page} */ page) {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
}

test('the upload button on every page, its drop zone, a drop on Zahlungen', async ({ page }) => {
	await unlock(page);
	const nav = page.getByRole('navigation');

	// On Home, Zahlungen and Belege; not on Belege's page any more.
	await expect(page.getByTestId('upload-open')).toBeVisible();
	await nav.getByRole('link', { name: 'Zahlungen' }).click();
	await expect(page.getByTestId('upload-open')).toBeVisible();
	await nav.getByRole('link', { name: 'Belege' }).click();
	await expect(page.getByTestId('upload-open')).toBeVisible();
	await expect(page.getByTestId('upload-label')).toHaveCount(0);
	await expect(page.getByTestId('belege-page').getByTestId('receipt-upload')).toHaveCount(0);

	// The panel: the drop zone opens the file picker; the file goes in.
	await nav.getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('upload-open').click();
	const panel = page.getByTestId('upload-panel');
	await expect(panel.getByTestId('upload-zone')).toContainText('oder Dateien hierher ziehen');
	const chooser = page.waitForEvent('filechooser');
	await panel.getByTestId('upload-zone').click();
	await (
		await chooser
	).setFiles({
		name: 'hotel-beispiel.pdf',
		mimeType: 'application/pdf',
		buffer: pdf('hotel')
	});
	await expect(panel.getByTestId('import-result')).toHaveText(
		/Neu: 1 · doppelt: 0 · nicht unterstützt: 0/
	);
	await panel.getByTestId('upload-close').click();
	await expect(panel).toHaveCount(0);

	// Dropped anywhere on Zahlungen: uploaded, and the panel says so.
	const transfer = await page.evaluateHandle(
		(bytes) => {
			const dt = new DataTransfer();
			dt.items.add(
				new File([new Uint8Array(bytes)], 'taxi-beispiel.pdf', { type: 'application/pdf' })
			);
			return dt;
		},
		[...pdf('taxi')]
	);
	await page.dispatchEvent('main', 'dragenter', { dataTransfer: transfer });
	await expect(page.getByTestId('upload-drop-overlay')).toBeVisible();
	await page.dispatchEvent('main', 'drop', { dataTransfer: transfer });
	await expect(page.getByTestId('upload-drop-overlay')).toHaveCount(0);
	await expect(panel.getByTestId('import-result')).toHaveText(/Neu: 1/);

	// To the new receipt on Belege.
	await panel.getByTestId('upload-goto').click();
	await expect(page).toHaveURL(/\/belege\?receipt=/);
	await expect(page.getByTestId('receipt')).toHaveCount(2);
});

test('on a phone: a "+" above the tab bar opens the same panel', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await unlock(page);
	await expect(page.getByTestId('upload-open')).toBeHidden();
	const fab = page.getByTestId('upload-open-fab');
	await expect(fab).toBeVisible();
	const tabs = await page.getByRole('navigation').boundingBox();
	const plus = await fab.boundingBox();
	expect(plus && tabs && plus.y + plus.height <= tabs.y).toBe(true);
	await fab.click();
	await expect(page.getByTestId('upload-panel')).toBeVisible();
	await expect(page.getByTestId('upload-zone')).toBeVisible();
});

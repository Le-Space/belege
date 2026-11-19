// The receipts page's technical note: with the technical view on it once stood
// in the narrow column of sources and months, beside the list, and wrapped word
// by word; on a phone it was not shown at all. It is a folded strip over the
// whole width above the list, on a desktop and on a phone. Every receipt is
// made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

// Screenshots for a person to look at, only where a folder is named.
const shots = process.env.E2E_SHOT_DIR || '';

test('the technical note is over the full width, folded, not beside the list', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		for (const [day, vendor] of [
			['2025-03-10', 'Wolkenfabrik Hosting GmbH'],
			['2025-03-12', 'Stromwerk Test AG'],
			['2025-03-20', 'Maerz Beispiel KG']
		])
			await e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 1234,
				currency: 'EUR',
				documentDate: day
			});
	});
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	await expect(page.getByTestId('receipt')).toHaveCount(3);

	const note = page.getByTestId('belege-technical');
	const list = page.getByTestId('receipt-list');
	// Simple view: no note.
	await expect(note).toHaveCount(0);
	await page.getByTestId('technical-toggle').first().click();

	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 900 });
		if (shots) await page.screenshot({ path: `${shots}/belege-${width}.png`, fullPage: true });
		await expect(note).toBeVisible();
		const n = /** @type {{ x: number, y: number, width: number, height: number }} */ (
			await note.boundingBox()
		);
		const l = /** @type {{ x: number, y: number, width: number, height: number }} */ (
			await list.boundingBox()
		);
		// Above the list, at least as wide as it, and folded to a line or two.
		expect(n.y + n.height).toBeLessThanOrEqual(l.y);
		expect(n.width).toBeGreaterThanOrEqual(l.width);
		expect(n.height).toBeLessThan(80);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width
		);
	}

	// Folded: the first sentences as one cut line; opened: both, in full.
	await page.setViewportSize({ width: 1280, height: 900 });
	const full = note.getByTestId('technical-note-lines');
	await expect(full).toBeHidden();
	await expect(note).toContainText('AES-GCM');
	await note.locator('summary').click();
	await expect(full).toBeVisible();
	await expect(full.locator('li')).toHaveCount(2);
	await expect(full).toContainText('Textebene des PDFs');
	if (shots) await page.screenshot({ path: `${shots}/belege-1280-open.png`, fullPage: true });
	await page.setViewportSize({ width: 390, height: 900 });
	await expect(full).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	if (shots) await page.screenshot({ path: `${shots}/belege-390-open.png`, fullPage: true });
});

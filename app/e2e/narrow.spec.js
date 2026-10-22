// A folding phone: closed, ~344 px wide; opened, ~690 px. Months of
// payments once stretched the payments page to 1,664 px, and the phone zoomed
// the whole app out to fit it. No page is wider than the screen.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const PAGES = ['/', '/zahlungen', '/belege', '/export', '/integrationen', '/einstellungen'];

test('closed and opened, no page is wider than a folding phone', async ({ page }) => {
	test.setTimeout(180_000);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Falt');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	// Nine months, each with a long payee and a reference without a space.
	await page.evaluate(async () => {
		const year = new Date().getFullYear();
		for (let m = 1; m <= 9; m++)
			await /** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: `${year}-${String(m).padStart(2, '0')}-0${(m % 8) + 1}`,
				counterparty: 'Beispiel Versandhandel Europa Sonderfirmenname S.C.A.',
				purpose: '303-1234567-7654321 BSPL Mktp DE 4FFVTNAH6HRT0S42XYZXYZXYZ',
				amountCents: -8999
			});
	});

	for (const width of [344, 690]) {
		await page.setViewportSize({ width, height: 860 });
		for (const path of PAGES) {
			// Inside the app: a reload would ask for the passkey again.
			await page.evaluate((href) => {
				const a = document.createElement('a');
				a.href = href;
				document.body.append(a);
				a.click();
				a.remove();
			}, path);
			await page.waitForURL((url) => url.pathname === path);
			if (path === '/zahlungen') {
				await page.getByTestId('filter-all').click();
				await expect(page.getByTestId('transaction-month')).toHaveCount(9);
			}
			const wide = await page.evaluate(() => document.documentElement.scrollWidth);
			expect(wide, `${path} at ${width} px`).toBeLessThanOrEqual(width);
		}
	}
});

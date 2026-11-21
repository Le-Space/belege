// The company's own logo (#906): chosen beside the company's name, kept in
// the sealed settings, and drawn on the Eigenbeleg the app makes next; a
// file that cannot be a logo is refused with the reason, and switching it
// off leaves the next Eigenbeleg without a picture.
import { test, expect } from '@playwright/test';
import { samplePng } from '@le-space/pdf/testing/sample-images';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** In-app navigation: a reload would lock the books. */
const follow = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ href) =>
	page.evaluate((to) => {
		const a = document.createElement('a');
		a.href = to;
		document.body.append(a);
		a.click();
		a.remove();
	}, href);

/** @param {import('@playwright/test').Page} page @param {string} counterparty */
async function eigenbeleg(page, counterparty) {
	await page.evaluate(async (name) => {
		await /** @type {any} */ (window).__belegeE2E.addTransaction({
			bookedOn: '2026-09-01',
			counterparty: name,
			purpose: 'Lease-Zahlung',
			amountCents: -1234,
			currency: 'EUR',
			movement: 'transfer',
			txRef: `ABC-${name}`,
			asset: 'AKT',
			quantity: '-4200000',
			decimals: 6,
			valuation: {
				rate: '2.938095',
				currency: 'EUR',
				source: 'coingecko',
				at: '2026-09-01T00:00:00Z'
			}
		});
	}, counterparty);
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Zahlungen' })
		.click();
	await page.getByTestId('transaction').filter({ hasText: counterparty }).click();
	await page.getByTestId('tx-alt-toggle').click();
	await page.getByTestId('tx-eigenbeleg-open').click();
	await page.getByTestId('tx-eigenbeleg-description').fill('Rechenzeit für einen Monat (Lease)');
	await page.getByTestId('tx-eigenbeleg-create').click();
	await expect(page.getByTestId('tx-linked-vendor')).toContainText('Eigenbeleg');
	await page.getByTestId('tx-detail-close').click();
	// The PDF of the receipt just made.
	const bytes = await page.evaluate(async (name) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const list = /** @type {any[]} */ (await e2e.receipts());
		const r = list.find((x) => x.fileCid && x.selfReceipt?.counterparty === name);
		const bytes = r ? await e2e.fileBytes(r.fileCid) : null;
		return bytes ?? [];
	}, counterparty);
	return Buffer.from(bytes).toString('latin1');
}

test('the company logo is chosen in the settings and drawn on the next Eigenbeleg', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await follow(page, '/einstellungen/firma');
	const setting = page.getByTestId('issuer-logo');
	// An SVG is refused, with the reason; nothing is kept.
	await setting.getByTestId('issuer-logo-file').setInputFiles({
		name: 'logo.svg',
		mimeType: 'image/svg+xml',
		buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
	});
	await expect(setting.getByTestId('issuer-logo-error')).toContainText('PNG or a JPEG');
	await expect(setting.getByTestId('issuer-logo-preview')).toHaveCount(0);
	// A PNG is kept and shown.
	await setting.getByTestId('issuer-logo-file').setInputFiles({
		name: 'logo.png',
		mimeType: 'image/png',
		buffer: Buffer.from(samplePng())
	});
	await expect(setting.getByTestId('issuer-logo-preview')).toBeVisible();
	await expect(setting).toContainText('240 × 80 Pixel');
	await expect(setting.getByTestId('issuer-logo-error')).toHaveCount(0);
	// Still there after the page is opened again: it is in the books, not in the page.

	await follow(page, '/');
	const withLogo = await eigenbeleg(page, 'Stromwerk Test AG');
	expect(withLogo.match(/\/Subtype\s*\/Image/g) ?? []).toHaveLength(1);

	// Switched off: the next Eigenbeleg carries no picture.
	await follow(page, '/einstellungen/firma');
	await page.getByTestId('issuer-logo-on').uncheck();
	await expect(page.getByTestId('issuer-logo')).toContainText('Logo gespeichert');
	await follow(page, '/');
	const without = await eigenbeleg(page, 'Wolkenfabrik Hosting GmbH');
	expect(without).toContain('%PDF');
	expect(without.match(/\/Subtype\s*\/Image/g) ?? []).toHaveLength(0);
});

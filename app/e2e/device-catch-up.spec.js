// Matching catches up on what came by sync (#473): the Mac has a receipt, the
// phone books the payment for it – nobody clicks "Abgleich starten", nobody
// imports anything more – and both end up with the one link. Made-up data.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

const DAY = new Date().toISOString().slice(0, 10);
const INVOICE = 'RE-2026-7788';

test('a receipt on one device and its payment on the other link without a click', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	const phone = await device(browser);
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Nachholen');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await samePasskey(mac, phone, did);

		// Connected, as device-sync.spec.js does it: the Mac's id scanned on the phone.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await mac.page.getByTestId('devices-qr-toggle').click();
		const code = String(await mac.page.getByTestId('devices-qr').getAttribute('data-code'));
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, code);
		await expect(phone.page.getByTestId('local-only')).toHaveAttribute('data-state', 'connected', {
			timeout: 60_000
		});

		// The Mac: a receipt, read. The phone: the payment for it. No run asked for.
		await mac.page.evaluate(
			async ({ day, invoice }) => {
				await /** @type {any} */ (window).__belegeE2E.addReceipt({
					source: 'upload',
					authVerdict: 'pass',
					status: 'ausgelesen',
					fileName: 'wolkenfabrik.pdf',
					vendor: 'Wolkenfabrik Nachhol GmbH',
					amountCents: 11900,
					currency: 'EUR',
					documentDate: day,
					invoiceNumber: invoice,
					extraction: {
						document_type: 'invoice',
						vendor: 'Wolkenfabrik Nachhol GmbH',
						invoice_number: invoice,
						invoice_date: day,
						currency: 'EUR',
						gross: 119,
						payment: 'bank_transfer'
					}
				});
			},
			{ day: DAY, invoice: INVOICE }
		);
		await phone.page.evaluate(
			async ({ day, invoice }) => {
				await /** @type {any} */ (window).__belegeE2E.addTransaction({
					bookedOn: day,
					counterparty: 'Wolkenfabrik Nachhol GmbH',
					purpose: `Rechnung ${invoice}`,
					amountCents: -11900
				});
			},
			{ day: DAY, invoice: INVOICE }
		);

		// Both: the payment has its receipt, and there is one link, not two.
		for (const d of [mac, phone]) {
			await tab(d.page, 'Zahlungen');
			await d.page.getByTestId('filter-all').click();
			const payment = d.page
				.getByTestId('transaction')
				.filter({ hasText: 'Wolkenfabrik Nachhol GmbH' });
			await expect(payment).toHaveAttribute('data-covered', 'true', { timeout: 90_000 });
		}
		await expect
			.poll(
				() =>
					mac.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.count('matches')),
				{
					timeout: 60_000
				}
			)
			.toBe(1);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

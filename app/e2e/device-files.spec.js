// Receipt files reach every own device in the background: the Mac adds a
// receipt with its PDF, the phone brings the file without anyone opening it,
// the Mac goes away – and the phone still opens the file. A receipt whose file
// no device offers says so instead of failing silently. Made-up data.
import { test, expect } from '@playwright/test';
import { CID } from 'multiformats/cid';
import * as dagCbor from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';
import { makePdf } from '@belege/bridge/testing/pdf';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

const MARKER = 'Wolkenfabrik Vorab GmbH';
const NOWHERE = 'Stromwerk Nirgends AG';

/** @param {import('@playwright/test').Page} page @param {string} vendor */
async function openReceipt(page, vendor) {
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	const monthAll = page.locator('[data-month="all"]');
	if (await monthAll.count()) await monthAll.first().click();
	await page.getByTestId('receipt').filter({ hasText: vendor }).click();
}

test('a receipt’s file reaches the other device before it is opened, and stays there', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	const phone = await device(browser);
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Dateien');
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

		// The Mac: a receipt with its PDF.
		const pdf = [...makePdf([MARKER, 'Rechnung VB-2026-3', 'Summe 12,34 EUR'])];
		const added = await mac.page.evaluate(
			async ({ pdf, marker }) =>
				/** @type {any} */ (window).__belegeE2E.addReceiptFile(pdf, {
					source: 'upload',
					status: 'ausgelesen',
					mime: 'application/pdf',
					fileName: 'vorab.pdf',
					vendor: marker,
					invoiceNumber: 'VB-2026-3',
					amountCents: 1234,
					currency: 'EUR',
					documentDate: '2026-10-07'
				}),
			{ pdf, marker: MARKER }
		);
		const fileCid = String(added.fileCid);

		// The phone: the record came, and the file with it – nobody opened it.
		await expect
			.poll(
				() =>
					phone.page.evaluate(
						(cid) => /** @type {any} */ (window).__belegeE2E.fileHere(cid),
						fileCid
					),
				{ timeout: 90_000 }
			)
			.toBe(true);
		expect(
			await phone.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.filesState())
		).toEqual({ missing: [], fetching: [] });

		// The Mac goes away. The phone opens the file from what it holds.
		await mac.context.close();
		await openReceipt(phone.page, MARKER);
		await expect(phone.page.getByTestId('preview-pdf')).toHaveAttribute('data-rendered', 'true');
		await expect(phone.page.getByTestId('file-not-here')).toHaveCount(0);

		// A receipt whose file no device offers: said so, not a silent failure.
		const nowhere = CID.createV1(
			dagCbor.code,
			await sha256.digest(dagCbor.encode({ v: 1, size: 1, chunks: [] }))
		).toString();
		await phone.page.evaluate(
			async ({ cid, vendor }) =>
				/** @type {any} */ (window).__belegeE2E.addReceipt({
					source: 'upload',
					status: 'ausgelesen',
					mime: 'application/pdf',
					fileName: 'nirgends.pdf',
					fileCid: cid,
					vendor,
					amountCents: 5678,
					currency: 'EUR',
					documentDate: '2026-10-08'
				}),
			{ cid: nowhere, vendor: NOWHERE }
		);
		await openReceipt(phone.page, NOWHERE);
		// No own device connected: it says that the file comes later – at once,
		// or after the one block wait when the phone had not yet seen the Mac go.
		const hint = phone.page.getByTestId('receipt-detail').getByTestId('file-not-here');
		await expect(hint).toHaveAttribute('data-state', 'missing', { timeout: 45_000 });
		await expect(hint).toContainText('noch nicht auf diesem Gerät');
		await expect(hint).toContainText('sobald ein eigenes Gerät online ist');
		await expect(phone.page.getByText('Die Vorschau ließ sich nicht erzeugen.')).toHaveCount(0);
	} finally {
		await mac.context.close().catch(() => {});
		await phone.context.close();
	}
});

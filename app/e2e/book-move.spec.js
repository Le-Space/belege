// "Bücher umziehen" (#328): books on passkey A moved into the empty books of
// passkey B – two browser contexts, two virtual authenticators, so two
// passkeys, two DIDs, two books. B shows a one-time key; A seals the file to
// it; B takes it over: the same payments, receipts and links, the receipt's
// file sealed anew. A is unchanged. Every booking and receipt is made up.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const MARKER = 'Umzugshändler Beispiel GmbH';

/** @param {import('@playwright/test').Browser} browser */
async function books(browser) {
	const context = await browser.newContext({ acceptDownloads: true });
	const page = await context.newPage();
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	return { context, page, did: await page.getByTestId('own-did').innerText() };
}

/** The backup page, unlocked again after the reload. @param {import('@playwright/test').Page} page */
async function backupPage(page) {
	await page.goto('/integrationen/backup');
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('move-card')).toBeVisible();
}

test('books on one passkey move into the empty books of another', async ({ browser }) => {
	test.setTimeout(120_000);
	const a = await books(browser);
	const b = await books(browser);
	expect(a.did).not.toBe(b.did);

	// A: a payment and its receipt with a file, linked.
	const pdf = [...makePdf([MARKER, 'Rechnung UM-2026-7', 'Summe 48,90 EUR'])];
	await a.page.evaluate(
		async ({ pdf, marker }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const bank = await e2e.addAccount({
				source: 'hibiscus',
				sourceAccountId: '0042',
				ibanLast4: '0042',
				name: 'Geschäftskonto Test',
				currency: 'EUR'
			});
			await e2e.addTransaction({
				accountId: bank.id,
				source: 'hibiscus',
				currency: 'EUR',
				bookedOn: '2026-09-20',
				amountCents: -4890,
				counterparty: marker,
				purpose: 'Rechnung UM-2026-7',
				bookingType: 'Lastschrift'
			});
			await e2e.addReceiptFile(pdf, {
				source: 'upload',
				status: 'ausgelesen',
				mime: 'application/pdf',
				fileName: 'umzug.pdf',
				vendor: marker,
				invoiceNumber: 'UM-2026-7',
				amountCents: 4890,
				currency: 'EUR',
				documentDate: '2026-09-18'
			});
			await e2e.runMatching();
		},
		{ pdf, marker: MARKER }
	);

	// What A shows for the payment: B must show the same after the move.
	await a.page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await a.page.getByTestId('filter-all').click();
	const before = (
		await a.page.getByTestId('transaction').filter({ hasText: MARKER }).innerText()
	).replace(/\s+/g, ' ');

	// B, empty: a one-time key.
	await backupPage(b.page);
	await b.page.getByTestId('move-receive').click();
	const keyText = await b.page.getByTestId('move-key-text').inputValue();
	const fingerprint = await b.page.getByTestId('move-fingerprint').innerText();
	expect(keyText).toMatch(/^belege-move:[A-Za-z0-9_-]{43}$/);
	await expect(b.page.getByTestId('move-key-qr').locator('svg')).toBeVisible();

	// A: not empty, so it offers to move; the key pasted, the same fingerprint.
	await backupPage(a.page);
	await expect(a.page.getByTestId('move-receive')).toHaveCount(0);
	await a.page.getByTestId('move-send').click();
	await a.page.getByTestId('move-key-input').fill('belege-move:kaputt');
	await expect(a.page.getByTestId('move-key-invalid')).toBeVisible();
	await a.page.getByTestId('move-key-input').fill(keyText);
	await expect(a.page.getByTestId('move-key-fingerprint')).toHaveText(fingerprint);
	const [download] = await Promise.all([
		a.page.waitForEvent('download'),
		a.page.getByTestId('move-pack').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^Belege-Umzug_\d{4}-\d{2}-\d{2}\.belege$/);
	await expect(a.page.getByTestId('move-packed')).toContainText('1 Zahlungen, 1 Belege, 1 Dateien');
	const file = await readFile(/** @type {string} */ (await download.path()));
	// Nothing in it readable.
	expect(file.toString('latin1')).not.toContain(MARKER);

	// B: the file read, its header shown, then taken over.
	await b.page.getByTestId('move-file').setInputFiles({
		name: download.suggestedFilename(),
		mimeType: 'application/octet-stream',
		buffer: file
	});
	await expect(b.page.getByTestId('move-file-summary')).toContainText('1 Zahlungen, 1 Belege');
	await b.page.getByTestId('move-take-over').click();
	await expect(b.page.getByTestId('move-done')).toContainText('Übernommen');

	// B now has A's payment, linked to A's receipt, the receipt's file readable.
	const nav = b.page.getByRole('navigation');
	await nav.getByRole('link', { name: 'Zahlungen' }).click();
	await b.page.getByTestId('filter-all').click();
	const row = b.page.getByTestId('transaction').filter({ hasText: MARKER });
	await expect(row).toHaveCount(1);
	expect((await row.innerText()).replace(/\s+/g, ' ')).toBe(before);
	await nav.getByRole('link', { name: 'Belege' }).click();
	await b.page.getByTestId('year-switch').selectOption('2026');
	const monthAll = b.page.locator('[data-month="all"]');
	if (await monthAll.count()) await monthAll.first().click();
	await b.page.getByTestId('receipt').filter({ hasText: MARKER }).click();
	await expect(b.page.getByTestId('preview-pdf')).toHaveAttribute('data-rendered', 'true');

	// B is no longer empty: no second take-over; A is unchanged.
	await backupPage(b.page);
	await expect(b.page.getByTestId('move-send')).toBeVisible();
	await expect(b.page.getByTestId('move-receive')).toHaveCount(0);
	const kept = await a.page.evaluate(async () =>
		(await /** @type {any} */ (window).__belegeE2E.transactions()).map(
			(/** @type {any} */ t) => t.counterparty
		)
	);
	expect(kept).toEqual([MARKER]);

	await a.context.close();
	await b.context.close();
});

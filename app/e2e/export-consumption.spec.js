// Consumption Eigenbelege at the month's export (#1034), end to end: a fake
// Aleph API, the real bridge in test mode pointed at it, and the app. An
// Aleph account is kept on its card, but no statement is made there. The
// export page of last month lists the account, reads its consumption through
// the bridge, says one Eigenbeleg will be created, and makes it on
// confirmation. It is in the ZIP with an export number; a second export
// reuses it – the same file, the same number – and the card's button finds
// it. Every address, hash, name and amount is made up
// (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

import { fakeAlephAddress, fakeItemHash, startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const ACCOUNT = fakeAlephAddress('e2e consumption');
const VM = fakeItemHash('e2e consumption vm');
const now = new Date();
const MONTH = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
	.toISOString()
	.slice(0, 7);
const YEAR = MONTH.slice(0, 4);
const day = (/** @type {number} */ d, /** @type {string} */ time) =>
	`${MONTH}-${String(d).padStart(2, '0')}T${time}.000Z`;

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	aleph = await startFakeAleph({
		accounts: {
			[ACCOUNT]: {
				balance: 2_948_000,
				rows: [
					{
						at: day(2, '09:00:00'),
						amount: 3_000_000,
						price: '0.000001',
						txHash: '0x' + 'ab'.repeat(32)
					},
					{
						at: day(3, '01:00:00'),
						amount: -40_000,
						paymentMethod: 'credit_expense',
						originRef: fakeItemHash('e2e consumption bill'),
						origin: VM
					},
					{
						at: day(4, '00:30:00'),
						amount: -12_000,
						paymentMethod: 'credit_expense',
						originRef: 'storage',
						count: 2,
						sizeMib: 300
					}
				]
			}
		},
		messages: { [VM]: { type: 'INSTANCE', name: 'e2e-node' } }
	});
	bridge = await startBridge({
		name: 'consumption',
		env: {
			BELEGE_BRIDGE_TEST_ALEPH_URL: aleph.url,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ USD: '0.9' })
		}
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await aleph?.close();
});

/** @param {import('@playwright/test').Page} page */
async function download(page) {
	await page.getByTestId('export-ack').check();
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	return unzipSync(new Uint8Array(await readFile(await file.path())));
}

test('the month’s export lists, creates and reuses the consumption Eigenbeleg', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	// A booking of the month, so that there is a month to export.
	await page.evaluate(async (month) => {
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
			bookedOn: `${month}-15`,
			amountCents: -1234,
			counterparty: 'Stromwerk Test AG',
			purpose: 'Abschlag',
			bookingType: 'Lastschrift',
			booking: { account: '4240', taxKey: '', confirmedAt: new Date().toISOString() }
		});
	}, MONTH);

	await page.getByRole('link', { name: 'Integrationen' }).click();
	await pairBridge(page, bridge);
	await openIntegration(page, 'aleph');
	const card = page.getByTestId('aleph-card');
	await card.getByTestId('aleph-extra-input').fill(ACCOUNT);
	await card.getByTestId('aleph-extra-name').fill('Projekt Süd');
	await card.getByTestId('aleph-extra-add').click();
	await expect(card.getByTestId('aleph-account')).toContainText('Projekt Süd');

	const nav = page.getByRole('navigation');
	await nav.getByRole('link', { name: 'Export' }).click();
	await page.getByTestId('export-month-select').selectOption(MONTH);
	const section = page.getByTestId('export-consumption');
	await expect(section.getByTestId('export-consumption-unread')).toContainText('Projekt Süd');
	await expect(
		page.locator('[data-testid="export-check"][data-check="consumption"]')
	).toContainText('1 Eigenbelege für Verbrauch sind noch nicht erstellt');
	await section.getByTestId('export-consumption-read').click();
	await expect(section.getByTestId('export-consumption-count')).toHaveText(
		'Zum Monatsabschluss wird 1 Eigenbeleg erstellt:'
	);
	// 52 000 credits × 0.000001 USD × 0.9 = 0.05 EUR
	await expect(section.getByTestId('export-consumption-item')).toContainText('0,05');
	await expect(section).toContainText('belegt der Kontoauszug');
	await section.getByTestId('export-consumption-create').click();
	await expect(section.getByTestId('export-consumption-done')).toContainText('1 erstellt');
	await expect(section.getByTestId('export-consumption-reused')).toContainText(`EB-${YEAR}-001`);
	await expect(section.getByTestId('export-consumption-create')).toHaveCount(0);
	await expect(page.locator('[data-testid="export-check"][data-check="consumption"]')).toHaveCount(
		0
	);

	const first = await download(page);
	const files = Object.keys(first).filter((p) => p.startsWith(`Belege/${MONTH}-`));
	expect(files).toHaveLength(1);
	expect(files[0]).toMatch(/^Belege\/\d{4}-\d{2}-001_.*Aleph/);

	// A second export: the same document under the same number, nothing new.
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await page.getByTestId('export-month-select').selectOption(MONTH);
	await expect(section.getByTestId('export-consumption-reused')).toContainText(`EB-${YEAR}-001`);
	await expect(section.getByTestId('export-consumption-create')).toHaveCount(0);
	const second = await download(page);
	expect(Object.keys(second).filter((p) => p.startsWith(`Belege/${MONTH}-`))).toEqual(files);
	expect(second[files[0]]).toEqual(first[files[0]]);
	const receipts = await page.evaluate(() => /** @type {any} */ (window).__belegeE2E.receipts());
	expect(receipts.filter((/** @type {any} */ r) => r.source === 'eigenbeleg')).toHaveLength(1);

	// The card finds it: the same number, no second one offered.
	await page.getByTestId('tab-integrationen').click();
	await openIntegration(page, 'aleph');
	await card.getByTestId('aleph-month').selectOption(MONTH);
	await expect(card.getByTestId('aleph-statement-exists')).toContainText(`EB-${YEAR}-001`);
	await expect(card.getByTestId('aleph-make')).toHaveCount(0);
	expect(bridge.out()).not.toContain(ACCOUNT);
});

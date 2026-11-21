// Aleph Cloud (issue #113), end to end: a fake Aleph API on 127.0.0.1, the
// real bridge in test mode pointed at it (BELEGE_BRIDGE_TEST_ALEPH_URL) with
// a fixed USD rate, and the app. An Aleph account typed in → "Bei Aleph
// prüfen" finds it → "Verbrauchsnachweis erstellen" for last month → an
// Eigenbeleg under Belege, and a second one for the same month is not
// offered. Every address, hash and amount is made up
// (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';

import { fakeAlephAddress, fakeItemHash, startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const ACCOUNT = fakeAlephAddress('e2e hosting');
const VM = fakeItemHash('e2e vm');
// Last month, as the card offers it by default.
const now = new Date();
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const MONTH = last.toISOString().slice(0, 7);
const day = (/** @type {number} */ d, /** @type {string} */ time) =>
	`${MONTH}-${String(d).padStart(2, '0')}T${time}.000Z`;

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	const rows = [
		{
			at: day(2, '09:00:00'),
			amount: 3_000_000,
			price: '0.000001',
			txHash: '0x' + 'ef'.repeat(32)
		},
		{
			at: day(3, '00:30:00'),
			amount: -12_000,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 5,
			sizeMib: 800
		},
		{
			at: day(3, '01:00:00'),
			amount: -40_000,
			paymentMethod: 'credit_expense',
			originRef: fakeItemHash('bill'),
			origin: VM
		},
		{
			at: day(4, '00:30:00'),
			amount: -12_000,
			paymentMethod: 'credit_expense',
			originRef: 'storage',
			count: 5,
			sizeMib: 800
		}
	];
	aleph = await startFakeAleph({
		accounts: { [ACCOUNT]: { balance: 2_936_000, rows } },
		messages: { [VM]: { type: 'INSTANCE', name: 'e2e-relay' } }
	});
	bridge = await startBridge({
		name: 'aleph',
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

test('an Aleph account is found, and last month becomes an Eigenbeleg', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Integrationen' }).click();
	await pairBridge(page, bridge);

	await openIntegration(page, 'aleph');
	const card = page.getByTestId('aleph-card');
	await expect(card.getByTestId('aleph-scan')).toBeDisabled();
	await card.getByTestId('aleph-extra-input').fill(ACCOUNT);
	await card.getByTestId('aleph-extra-name').fill('Projekt Nord');
	await card.getByTestId('aleph-extra-add').click();
	// Asked at once, and listed with its name and what Aleph said.
	await expect(card.getByTestId('aleph-scan-result')).toContainText('1 Adressen geprüft, 1 davon');
	await expect(card.getByTestId('aleph-extra')).toHaveCount(1);
	await expect(card.getByTestId('aleph-extra')).toHaveAttribute('data-state', 'has');
	await expect(card.getByTestId('aleph-extra')).toContainText('Projekt Nord');
	await expect(card.getByTestId('aleph-account')).toContainText('Projekt Nord');
	// An address Aleph holds nothing for says so, and can be taken off again.
	const UNKNOWN = '0x00000000000000000000000000000000000000aa';
	await card.getByTestId('aleph-extra-input').fill(UNKNOWN);
	await card.getByTestId('aleph-extra-add').click();
	const unknown = card.getByTestId('aleph-extra').filter({ hasText: UNKNOWN });
	await expect(unknown).toHaveAttribute('data-state', 'nothing');
	await unknown.getByTestId('aleph-extra-remove').click();
	await expect(card.getByTestId('aleph-extra')).toHaveCount(1);
	await expect(card.getByTestId('aleph-account')).toHaveCount(1);
	await expect(card.getByTestId('aleph-account-credits')).toContainText('2.936.000 Credits');
	await expect(card.getByTestId('aleph-month')).toHaveValue(MONTH);

	await card.getByTestId('aleph-make').click();
	await expect(card.getByTestId('aleph-made')).toContainText(`EB-${MONTH.slice(0, 4)}-001`);
	// 64 000 credits × 0.000001 USD × 0.9 = 0.06 EUR
	await expect(card.getByTestId('aleph-made')).toContainText('0,06 EUR');
	await expect(card.getByTestId('aleph-statement-exists')).toContainText(
		`EB-${MONTH.slice(0, 4)}-001`
	);
	await expect(card.getByTestId('aleph-make')).toHaveCount(0);

	await page.getByRole('link', { name: 'Belege', exact: true }).click();
	await expect(page.getByTestId('receipt').filter({ hasText: 'Aleph Cloud' })).toHaveCount(1);
	// The address never reaches the bridge's log.
	expect(bridge.out()).not.toContain(ACCOUNT);
	expect(bridge.out()).toContain('aleph: statement');
});

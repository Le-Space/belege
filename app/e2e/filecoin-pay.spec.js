// Filecoin Pay end to end: a fake of the makers' index, Blockscout and
// Filfox on 127.0.0.1, the real bridge in test mode pointed at it
// (BELEGE_BRIDGE_TEST_FILECOINPAY_URL) with a fixed USDFC rate and a
// Blockscout key, and the app. An own Filecoin wallet typed as 0x… →
// the card "Filecoin Pay" appears → "Filecoin-Wallets prüfen" finds its
// balance → last month is shown → "Verbrauchsnachweis erstellen" → an
// Eigenbeleg under Belege, and a second one for the same month is not
// offered. Every address, hash and amount is made up
// (@belege/bridge/testing/filecoin-pay); the contract's addresses are public.
import { test, expect } from '@playwright/test';

import { startFakeFilecoinPay } from '@belege/bridge/testing/filecoin-pay';
import { FILECOIN_PAY } from '@le-space/chains/filecoin-pay';
import { toFilecoinAddress } from '@le-space/chains/filecoin';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const PAYER = `0x${'1a'.repeat(20)}`;
const WALLET = toFilecoinAddress(PAYER);
const PROVIDER = `0x${'a1'.repeat(20)}`;
const USDFC = FILECOIN_PAY.token.contract;
const WARM = Object.keys(FILECOIN_PAY.services)[0];
const KEY = 'proapi_e2e_made_up_key';
// Last month, as the card offers it by default.
const now = new Date();
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const MONTH = last.toISOString().slice(0, 7);
const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15)).toISOString();
const day = (/** @type {number} */ d, /** @type {string} */ time) =>
	`${MONTH}-${String(d).padStart(2, '0')}T${time}Z`;

/** @type {Awaited<ReturnType<typeof startFakeFilecoinPay>>} */ let fake;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	fake = await startFakeFilecoinPay({
		contract: FILECOIN_PAY.contract,
		token: USDFC,
		toFilecoin: toFilecoinAddress,
		key: KEY,
		// 10 paid in before; last month 1.2 + 0.5 settled and 1 taken out: 7.3 now.
		funds: { [PAYER]: '7.3' },
		events: [
			{ at: before, deposit: '10', token: USDFC, from: PAYER, to: PAYER },
			{ at: before, rail: 7, payer: PAYER, payee: PROVIDER, token: USDFC, operator: WARM },
			{
				at: day(3, '09:00:00'),
				settled: '1.2',
				railId: 7,
				toPayee: '1.19',
				commission: '0',
				fee: '0.01',
				upTo: day(3, '00:00:00')
			},
			{
				at: day(20, '09:00:00'),
				settled: '0.5',
				railId: 7,
				toPayee: '0.5',
				commission: '0',
				fee: '0',
				upTo: day(19, '00:00:00')
			},
			{ at: day(25, '12:00:00'), withdraw: '1', token: USDFC, from: PAYER, to: PAYER }
		]
	});
	bridge = await startBridge({
		name: 'filpay',
		env: {
			BELEGE_BRIDGE_TEST_FILECOINPAY_URL: fake.url,
			BELEGE_BRIDGE_TEST_BLOCKSCOUT_KEY: KEY,
			BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ USDFC: '0.9' })
		}
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await fake?.close();
});

test('a wallet’s balance in Filecoin Pay is found, and last month becomes an Eigenbeleg', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Filecoin Pay');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Integrationen' }).click();
	await pairBridge(page, bridge);

	await openIntegration(page, 'wallets');
	// No Filecoin wallet yet: no card, nothing asked.
	await expect(page.getByTestId('filecoin-pay-card')).toHaveCount(0);
	const wallets = page.getByTestId('wallets-card');
	const open = wallets.getByTestId('wallet-add-open');
	if (await open.isVisible()) await open.click();
	await wallets.getByTestId('wallet-chain').selectOption('filecoin');
	await wallets.getByTestId('wallet-address-input').fill(PAYER);
	await wallets.getByTestId('wallet-add-button').click();
	await expect(wallets.getByTestId('wallet').filter({ hasText: WALLET.slice(-6) })).toHaveCount(1);

	const card = page.getByTestId('filecoin-pay-card');
	await expect(card).toBeVisible();
	expect(fake.calls).toEqual([]);
	await card.getByTestId('filecoin-pay-scan').click();
	await expect(card.getByTestId('filecoin-pay-scan-result')).toContainText(
		'1 Wallets geprüft, 1 davon'
	);
	await expect(card.getByTestId('filecoin-pay-account')).toHaveCount(1);
	await expect(card.getByTestId('filecoin-pay-funds')).toContainText('7,3 USDFC');
	await expect(card.getByTestId('filecoin-pay-funds')).toContainText('1 Rails');
	// The bridge has a key: no hint to set one up.
	await expect(card.getByTestId('filecoin-pay-no-key')).toHaveCount(0);
	await expect(card.getByTestId('filecoin-pay-month')).toHaveValue(MONTH);

	await card.getByTestId('filecoin-pay-show').click();
	const shown = card.getByTestId('filecoin-pay-statement');
	await expect(shown.getByTestId('filecoin-pay-opening')).toContainText('10');
	// 1.7 USDFC × 0.9 = 1.08 + 0.45 EUR
	await expect(shown.getByTestId('filecoin-pay-usage')).toContainText('1,7 · 1,53 EUR');
	await expect(shown.getByTestId('filecoin-pay-closing')).toContainText('7,3 USDFC');
	await expect(shown.getByTestId('filecoin-pay-line')).toHaveCount(2);
	await expect(shown.getByTestId('filecoin-pay-line').first()).toContainText(
		'Filecoin Warm Storage'
	);
	await expect(shown.getByTestId('filecoin-pay-source')).toContainText('Index');

	await card.getByTestId('filecoin-pay-make').click();
	await expect(card.getByTestId('filecoin-pay-made')).toContainText(`EB-${MONTH.slice(0, 4)}-001`);
	await expect(card.getByTestId('filecoin-pay-made')).toContainText('1,53 EUR');
	await expect(card.getByTestId('filecoin-pay-exists')).toContainText(
		`EB-${MONTH.slice(0, 4)}-001`
	);
	await expect(card.getByTestId('filecoin-pay-make')).toHaveCount(0);

	await page.getByRole('link', { name: 'Belege', exact: true }).click();
	await expect(page.getByTestId('receipt').filter({ hasText: 'Filecoin Pay' })).toHaveCount(1);

	// Neither address nor the key reaches the bridge's log; the key went to
	// the keyed host only, in a header.
	expect(bridge.out()).not.toContain(PAYER);
	expect(bridge.out()).not.toContain(WALLET);
	expect(bridge.out()).not.toContain(KEY);
	expect(bridge.out()).toContain('filecoin pay: statement');
	expect(bridge.out()).toContain('Blockscout with a key');
	expect(fake.authorizations.length).toBeGreaterThan(0);
	expect(fake.authorizations.every((a) => a.startsWith('/keyed/'))).toBe(true);
});

// A fake token's "transfer" out of an own wallet (address poisoning): a
// token without any rate, logged as sent from this wallet in a transaction
// someone else sent, to an address that starts and ends like one this wallet
// really paid. It needs no receipt and no rate, and the payment says to
// never send there. Every address, hash and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const OWN = '0x1111111111111111111111111111111111111111';
const EXCHANGE = '0xabcd000000000000000000000000000000009876';
// Same first and last four characters as EXCHANGE.
const POISON = '0xabcd555555555555555555555555555555559876';
const STRANGER = '0x7777000000000000000000000000000000003333';

test('a fake token sent "from" the wallet needs no receipt, and warns about its address', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(
		async ({ OWN, EXCHANGE, POISON, STRANGER }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const wallet = await e2e.addAccount({
				source: 'ethereum',
				sourceAccountId: `${OWN}:ETH`,
				ibanLast4: '',
				name: `Wallet ETH ···${OWN.slice(-6)}`,
				currency: 'EUR',
				kind: 'wallet',
				asset: 'ETH',
				decimals: 18,
				walletAddress: OWN
			});
			const common = {
				accountId: wallet.id,
				source: 'ethereum',
				currency: 'EUR',
				counterpartyIban: '',
				endToEndId: '',
				bankCode: '',
				movement: 'transfer',
				decimals: 18
			};
			// A real payment to the exchange, earlier.
			await e2e.addTransaction({
				...common,
				sourceId: `0x${'a'.repeat(64)}:value`,
				bookedOn: '2026-10-01',
				amountCents: -8000,
				counterparty: EXCHANGE,
				counterpartyAddress: EXCHANGE,
				purpose: 'Gesendet · Tx 0xaaaa…aaaa',
				bookingType: 'Gesendet',
				txRef: `0x${'a'.repeat(64)}`,
				asset: 'ETH',
				quantity: '-50000000000000000',
				valuation: {
					rate: '1600',
					currency: 'EUR',
					source: 'coingecko',
					at: '2026-10-01T00:00:00Z'
				},
				rateMissing: null
			});
			// The fake: 1.400 "ERC" to the lookalike, in a stranger's transaction.
			await e2e.addTransaction({
				...common,
				sourceId: `0x${'b'.repeat(64)}:log:2171`,
				bookedOn: '2026-10-15',
				amountCents: 0,
				counterparty: POISON,
				counterpartyAddress: POISON,
				purpose: 'Gesendet · Tx 0xbbbb…bbbb',
				bookingType: 'Gesendet',
				txRef: `0x${'b'.repeat(64)}`,
				asset: 'ERC',
				quantity: '-1400000000000000000000',
				valuation: null,
				rateMissing: { reason: 'no rate found for ERC on 2026-10-15' },
				movedByOther: { by: STRANGER }
			});
			await e2e.runMatching();
		},
		{ OWN, EXCHANGE, POISON, STRANGER }
	);

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	await page.getByTestId('filter-all').click();
	await page.locator('[data-testid="transaction-month"][data-month="2026-10"]').click();
	await page.getByTestId('transaction').filter({ hasText: '0xabcd5' }).click();
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-status-receipt')).toHaveAttribute(
		'data-state',
		'none-needed'
	);
	await expect(detail.getByTestId('tx-detail-classification')).toContainText(
		'Fake-Token (Adressvergiftung) – nichts bewegt, kein Beleg nötig'
	);
	const warning = detail.getByTestId('tx-spam-warning');
	await expect(warning).toContainText('Achtung: mögliche Adressvergiftung');
	await expect(warning).toContainText(POISON);
	await expect(warning).toContainText(`Sie beginnt und endet wie ${EXCHANGE}`);
	// No rate to find, none to enter.
	await expect(detail.getByTestId('tx-rate-missing')).toHaveCount(0);
	await expect(detail.getByTestId('tx-rate-input')).toHaveCount(0);
});

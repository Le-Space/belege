// A withdrawal from an exchange to an address that is no own wallet yet: the
// payment's detail asks what it was – an own wallet, private, a vendor, own
// money at another exchange – and keeps the answer for the address. As an own
// wallet: A click opens Integrationen → Eigene
// Wallets with the chain and the address filled in; nothing is added before
// the person presses "hinzufügen". Once it is an own wallet, the offer is
// gone. Real bridge in test mode; the account id, hash and amount are made up.
import { test, expect } from '@playwright/test';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const day = new Date().toISOString().slice(0, 10);
const ACCOUNT = 'wolkenfabrik.near';
const HASH = '7'.repeat(44);

/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	bridge = await startBridge({ name: 'wallet-offer' });
});

test.afterAll(async () => {
	await bridge?.stop();
});

test('a withdrawal to an unknown address offers it as an own wallet, filled in', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Wallet-Vorschlag');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await pairBridge(page, bridge);

	await page.evaluate(
		async ({ day, ACCOUNT, HASH }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: day,
				counterparty: 'Kraken NEAR Auszahlung',
				purpose: 'Auszahlung',
				amountCents: -12_34,
				source: 'kraken',
				movement: 'transfer',
				asset: 'NEAR',
				chainTxRef: HASH,
				chainMethod: 'NEAR',
				chainAddress: ACCOUNT
			});
		},
		{ day, ACCOUNT, HASH }
	);

	const openPayment = async () => {
		await page.getByTestId('tab-zahlungen').click();
		await page.getByTestId('transaction').filter({ hasText: 'Kraken NEAR Auszahlung' }).click();
		const address = page.getByTestId('tx-detail-chain-address');
		if (!(await address.isVisible()))
			await page.getByText('Details', { exact: true }).first().click();
		await expect(address).toContainText(ACCOUNT);
	};
	await openPayment();
	// "Was war diese Zahlung?": an own wallet is the first answer, where Belege can read one.
	const kind = page.getByTestId('tx-address-kind');
	await expect(kind).toContainText('Was war diese Zahlung?');
	await expect(kind.getByTestId('tx-address-kind-own')).toBeChecked();

	// Private: no receipt needed, said for the address – and taken back again.
	await kind.getByTestId('tx-address-kind-private').check();
	await expect(kind.getByTestId('tx-where-name')).toHaveValue('Privat');
	await kind.getByTestId('tx-where-name-save').click();
	await expect(page.getByTestId('tx-why-rule-line')).toContainText(
		'als private Adresse gemerkt („Privat“). Kein Beleg nötig.'
	);
	await expect(kind.getByTestId('tx-address-kind-current')).toContainText('Gemerkt als: Privat');

	// Own money at an exchange Belege does not read: an own transfer, said so.
	await kind.getByTestId('tx-address-kind-custodian').check();
	await kind.getByTestId('tx-where-name').fill('Testbörse Nordlicht');
	await kind.getByTestId('tx-where-name-save').click();
	await expect(page.getByTestId('tx-why-rule-line')).toContainText(
		'Eigenes Geld bei „Testbörse Nordlicht“'
	);
	await kind.getByTestId('tx-address-kind-forget').click();
	await expect(kind.getByTestId('tx-address-kind-current')).toHaveCount(0);

	await kind.getByTestId('tx-address-kind-own').check();
	await expect(page.getByTestId('tx-detail-wallet-offer')).toContainText('Leg sie an');
	const add = page.getByTestId('tx-detail-wallet-offer-add');
	await expect(add).toHaveText('Als eigene Wallet anlegen (NEAR)');
	await add.click();

	// The form, filled in – and the address not in the URL.
	await expect(page).toHaveURL(/\/integrationen\/wallets\/?$/);
	const card = page.getByTestId('wallets-card');
	await expect(card.getByTestId('wallet-chain')).toHaveValue('near');
	await expect(card.getByTestId('wallet-address-input')).toHaveValue(ACCOUNT);
	await expect(card.getByTestId('wallet-address')).toHaveCount(0);
	await card.getByTestId('wallet-add-button').click();
	await expect(card.getByTestId('wallet-address')).toContainText(ACCOUNT);

	// An own wallet now: no offer any more.
	await openPayment();
	await expect(page.getByTestId('tx-detail-wallet-offer')).toHaveCount(0);
});

// An exchange's deposit and its blockchain (issue #215): a FIL deposit whose
// hash is a Filecoin message CID shows "Filecoin" and a link to the explorer;
// an ETH deposit with an EVM hash and no network named says the chain is not
// clear and offers the candidates. Made-up hashes and amounts, written
// through the store.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const day = new Date().toISOString().slice(0, 10);
const CID = `bafy2bzace${'b'.repeat(52)}`;
const EVM = `0x${'ef'.repeat(32)}`;

test('a deposit names its blockchain and links the explorer', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Kette');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(
		async ({ day, CID, EVM }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: day,
				counterparty: 'Kraken FIL Einzahlung',
				purpose: 'Einzahlung',
				amountCents: 100_00,
				source: 'kraken',
				movement: 'transfer',
				asset: 'FIL',
				chainTxRef: CID,
				chainMethod: 'Filecoin'
			});
			await e2e.addTransaction({
				bookedOn: day,
				counterparty: 'Kraken ETH Einzahlung',
				purpose: 'Einzahlung',
				amountCents: 50_00,
				source: 'kraken',
				movement: 'transfer',
				asset: 'ETH',
				chainTxRef: EVM
			});
		},
		{ day, CID, EVM }
	);
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await page.getByTestId('tab-zahlungen').click();

	await page.getByTestId('transaction').filter({ hasText: 'Kraken FIL Einzahlung' }).click();
	const ref = page.getByTestId('tx-detail-chain-ref');
	if (!(await ref.isVisible())) await page.getByText('Details', { exact: true }).first().click();
	await expect(page.getByTestId('tx-detail-chain')).toContainText('Filecoin');
	await expect(page.getByTestId('tx-detail-chain')).toContainText('Netzwerk laut Börse: Filecoin');
	const link = page.getByTestId('tx-detail-chain-explorer');
	await expect(link).toHaveAttribute('href', `https://filfox.info/en/message/${CID}`);
	await expect(link).toHaveAttribute('rel', /noreferrer/);
	await expect(link).toHaveAttribute('target', '_blank');

	await page.getByRole('button', { name: 'Schließen' }).first().click();
	await page.getByTestId('transaction').filter({ hasText: 'Kraken ETH Einzahlung' }).click();
	if (!(await page.getByTestId('tx-detail-chain-ref').isVisible())) {
		await page.getByText('Details', { exact: true }).first().click();
	}
	const unclear = page.getByTestId('tx-detail-chain-unclear');
	await expect(unclear).toContainText('Blockchain nicht eindeutig');
	await expect(unclear.getByRole('link')).toHaveCount(5);
	await expect(unclear.getByRole('link', { name: 'Ethereum' })).toHaveAttribute(
		'href',
		`https://etherscan.io/tx/${EVM}`
	);
});

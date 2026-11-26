// The network fee rule (#305), end to end: a wallet's network fees each wait
// for an account; one click in a fee's account block sets the rule, and all
// of them – and one synced later – take it. Lifted, they are without an
// account again. The fees of a wallet's month are one row in the list (#1043),
// which opens to the single fees. Every hash and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('one click puts every network fee on its account, later ones too, and can be lifted', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const addFee = (/** @type {string} */ n) =>
		page.evaluate(async (n) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const accounts = await e2e.accounts();
			const wallet =
				accounts.find((/** @type {any} */ a) => a.source === 'akash') ??
				(await e2e.addAccount({
					source: 'akash',
					sourceAccountId: `akash1${'q'.repeat(38)}:AKT`,
					kind: 'wallet',
					name: 'Akash · AKT',
					asset: 'AKT',
					currency: 'EUR'
				}));
			await e2e.addTransaction({
				accountId: wallet.id,
				source: 'akash',
				movement: 'fee',
				bookedOn: '2026-07-12',
				amountCents: -1,
				currency: 'EUR',
				counterparty: 'Netzwerkgebühr',
				purpose: 'Netzwerkgebühr · Memo: akash: CreateLease',
				txRef: n.repeat(64),
				asset: 'AKT',
				quantity: '-10000',
				decimals: 6
			});
			await e2e.runMatching();
		}, n);
	for (const n of ['A', 'B', 'C']) await addFee(n);

	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('year-switch').selectOption('2026');
	const without = page.getByTestId('filter-without-account');
	// One row for the wallet's three fees of July.
	await expect(without).toContainText('(1)');
	await page.getByTestId('filter-all').click();
	const group = page.getByTestId('fee-group');
	await expect(group.getByTestId('fee-group-meta')).toContainText('3 Transaktionen');
	await group.getByTestId('fee-group-toggle').click();
	await group.getByTestId('fee-group-fee').first().click();
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-booking-account')).toHaveValue(/4970/);
	await detail.getByTestId('tx-fee-rule-apply').click();
	await expect(detail.getByTestId('tx-fee-rule-note')).toHaveText('3 Netzwerkgebühren übernommen.');
	await expect(detail.getByTestId('tx-fee-rule')).toContainText(
		'Per Regel für alle Netzwerkgebühren'
	);
	await detail.getByTestId('tx-detail-close').click();
	await expect(without).toContainText('(0)');

	// A fee synced later takes it with the next run.
	await addFee('D');
	await expect(without).toContainText('(0)');
	await expect(page.getByTestId('filter-all')).toContainText('(1)');
	await expect(group.getByTestId('fee-group-meta')).toContainText('4 Transaktionen');
	await expect(group).toHaveAttribute('data-booking', 'all');

	// Lifted: all four are without an account again.
	if (!(await group.getByTestId('fee-group-fee').first().isVisible()))
		await group.getByTestId('fee-group-toggle').click();
	await group.getByTestId('fee-group-fee').first().click();
	await detail.getByTestId('tx-fee-rule-lift').click();
	await expect(detail.getByTestId('tx-fee-rule-note')).toContainText('4 Netzwerkgebühren');
	await detail.getByTestId('tx-detail-close').click();
	await expect(without).toContainText('(1)');
	await expect(group).toHaveAttribute('data-booking', 'none');
});

// Network fees as one row per wallet and month (#1043), end to end: a fake
// Akash node with 30 transactions the wallet paid a fee for in one morning (a
// deployment recreated every ten minutes), the real bridge in test mode, and
// the app. Zahlungen shows one row for the 30 fees; one "Übernehmen" confirms
// all of them, "Rückgängig" takes it back; a reload keeps it; the export books
// them as one collective line with the usage statement; and a second device
// that joins sees the same. Every address, hash and amount is made up.
import { test, expect } from '@playwright/test';

import {
	akashDeployment,
	cosmosTx,
	fakeCosmosAddress,
	startFakeAkashConsole,
	startFakeCosmos
} from '@belege/bridge/testing/chains';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';
import { joinOwn, ownDevice } from './devices.js';

const W = fakeCosmosAddress('e2e fee groups wallet', 'akash');
const FEES = 30;

/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let node;
/** @type {Awaited<ReturnType<typeof startFakeAkashConsole>>} */ let indexer;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	// Height 1000 is 2026-09-01 00:00 UTC, one block a minute (fake-chains blockTime):
	// a fee every ten minutes until 04:50.
	node = await startFakeCosmos({
		network: 'akashnet-2',
		txs: Array.from({ length: FEES }, (_, i) =>
			cosmosTx({
				seed: `e2e fee group ${i}`,
				height: 1000 + i * 10,
				prefix: 'akash',
				fee: { payer: W, amount: '1234uakt' },
				transfers: []
			})
		),
		balances: {
			[W]: [
				{ denom: 'uakt', amount: '1000000' },
				{ denom: 'uact', amount: '1000000' }
			]
		},
		deployments: [
			akashDeployment({ owner: W, dseq: '4243', created: 1000, settled: 1290, uact: '1000000' })
		]
	});
	indexer = await startFakeAkashConsole({ txs: [] });
	bridge = await startBridge({
		name: 'fee-groups',
		env: { BELEGE_BRIDGE_TEST_FIXED_RATES: JSON.stringify({ AKT: '2', USD: '0.9' }) }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await node?.close();
	await indexer?.close();
});

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

/** The count in a filter button, "Ohne Konto (n)". @param {import('@playwright/test').Locator} button */
const countOf = async (button) => Number(/\((\d+)\)/.exec(String(await button.textContent()))?.[1]);

test('thirty fees of a wallet in a month: one row, one Übernehmen, one export line, on both devices', async ({
	browser
}) => {
	test.setTimeout(420_000);
	const laptop = await ownDevice(browser, 21);
	const phone = await ownDevice(browser, 22);
	const page = laptop.page;
	try {
		await page.goto('/');
		await acceptConsent(page);
		await page.getByTestId('passkey-label').fill('E2E Gebühren');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();
		await page.getByRole('link', { name: 'Integrationen' }).click();
		await pairBridge(page, bridge);

		// The wallet, with its ledger account for the export, synced: 30 fees.
		await openIntegration(page, 'wallets');
		const card = page.getByTestId('wallets-card');
		const open = card.getByTestId('wallet-add-open');
		if (await open.isVisible()) await open.click();
		await card.getByTestId('wallet-chain').selectOption('akash');
		await card.getByTestId('wallet-address-input').fill(W);
		await card.getByTestId('wallet-endpoint-rpc').fill(node.url);
		await card.getByTestId('wallet-endpoint-rest').fill(node.url);
		await card.getByTestId('wallet-endpoint-indexer').fill(indexer.url);
		await card.getByTestId('wallet-add-button').click();
		const wallet = card.getByTestId('wallet').filter({ hasText: W });
		await wallet.getByTestId('wallet-menu').click();
		await wallet.getByTestId('wallet-edit').click();
		await wallet.getByTestId('wallet-edit-ledger').fill('1365');
		await wallet.getByTestId('wallet-edit-save').click();
		await wallet.getByTestId('wallet-sync').click();
		await expect(wallet.getByTestId('wallet-result')).toHaveText(
			`Neu: ${FEES} · Aktualisiert: 0 · Übersprungen: 0`,
			{ timeout: 60_000 }
		);

		// September's usage statement covers all of them.
		await card.getByTestId('wallets-tab-statements').click();
		const statement = card
			.getByTestId('wallet-statement')
			.filter({ hasText: W })
			.getByTestId('akash-statement');
		await statement.getByTestId('akash-statement-month').selectOption('2026-09');
		await statement.getByTestId('akash-statement-make').click();
		await expect(statement.getByTestId('akash-statement-note')).toContainText(
			`${FEES} Netzwerkgebühren verknüpft`
		);

		// Zahlungen: one row for the thirty, without an account, with the statement.
		await tab(page, 'Zahlungen');
		const withoutAccount = page.getByTestId('filter-without-account');
		await withoutAccount.click();
		await expect.poll(() => countOf(withoutAccount)).toBe(1);
		const group = page.getByTestId('fee-group');
		await expect(group).toHaveCount(1);
		await expect(page.getByTestId('transaction')).toHaveCount(0);
		await expect(group.getByTestId('fee-group-meta')).toContainText(`${FEES} Transaktionen`);
		await expect(group).toHaveAttribute('data-booking', 'none');
		await expect(group).toHaveAttribute('data-cover', 'all');
		await expect(group.getByTestId('amount-quantity')).toContainText('0,03702');

		// It opens to the single fees.
		await group.getByTestId('fee-group-toggle').click();
		await expect(group.getByTestId('fee-group-fee')).toHaveCount(FEES);
		await group.getByTestId('fee-group-toggle').click();
		await expect(group.getByTestId('fee-group-fee')).toHaveCount(0);

		// The search finds the group by its name.
		await page.getByTestId('transaction-search').fill('netz');
		await expect(group).toHaveCount(1);
		await page.getByTestId('transaction-search').fill('');

		// One Übernehmen for all thirty – and Rückgängig for all thirty.
		await expect(group.getByTestId('fee-group-input')).toHaveValue('4970');
		await group.getByTestId('fee-group-confirm').click();
		await expect(group.getByTestId('fee-group-taken')).toContainText(
			`${FEES} Netzwerkgebühren auf 4970 gebucht.`
		);
		await expect(group).toHaveAttribute('data-booking', 'all');
		await expect.poll(() => countOf(withoutAccount)).toBe(0);
		await group.getByTestId('fee-group-undo').click();
		await expect(group).toHaveAttribute('data-booking', 'none');
		await expect.poll(() => countOf(withoutAccount)).toBe(1);
		await group.getByTestId('fee-group-confirm').click();
		await expect(group).toHaveAttribute('data-booking', 'all');

		// A reload keeps it: the row under "Alle", all with 4970.
		await page.reload();
		await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await tab(page, 'Zahlungen');
		await page.getByTestId('filter-all').click();
		await expect(page.getByTestId('fee-group')).toHaveAttribute('data-booking', 'all');
		await expect(page.getByTestId('fee-group').getByTestId('fee-group-accounts')).toHaveText(
			'4970'
		);
		await expect.poll(() => countOf(page.getByTestId('filter-without-account'))).toBe(0);

		// At phone width the row wraps; the page does not scroll sideways.
		await page.setViewportSize({ width: 375, height: 812 });
		await page.getByTestId('fee-group').getByTestId('fee-group-toggle').click();
		await expect(page.getByTestId('fee-group-fee').first()).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			)
		).toBe(true);
		await page.setViewportSize({ width: 1280, height: 800 });

		// The export: thirty bookings, one collective line with the statement.
		await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
		await page.getByTestId('export-month-select').selectOption('2026-09');
		await expect(page.getByTestId('export-collect-fees')).toBeChecked();
		await expect(page.getByTestId('export-summary')).toContainText(
			`${FEES} Buchungen · 1 im Buchungsstapel`
		);

		// A second device joins and syncs: the same row, all confirmed.
		await joinOwn(laptop, phone, 'E2E Telefon');
		await expect(phone.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await tab(phone.page, 'Zahlungen');
		await phone.page.getByTestId('filter-all').click();
		const there = phone.page.getByTestId('fee-group');
		await expect(there).toHaveCount(1, { timeout: 120_000 });
		await expect(there.getByTestId('fee-group-meta')).toContainText(`${FEES} Transaktionen`, {
			timeout: 120_000
		});
		await expect(there).toHaveAttribute('data-booking', 'all', { timeout: 120_000 });
	} finally {
		await laptop.context.close();
		await phone.context.close();
	}
});

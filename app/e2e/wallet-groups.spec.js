// Integrationen → Eigene Wallets as tabs, the list grouped by chain, one row
// per wallet (#1019): groups by chain with their count, a search over name,
// address and chain, folding, the ⋯ menu and the details with the API named
// per chain, the tab kept per browser, and on a phone the groups folded.
// Real bridge in test mode; nothing is synced. The wallets are made up.
import { test, expect } from '@playwright/test';

import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';
import { openIntegration } from './integrations.js';

/** @param {number} n */
const evm = (n) => `0x${String(n).padStart(40, '0')}`;
const WALLETS = [
	{ chain: 'ethereum', address: evm(1), name: 'Wallet A' },
	{ chain: 'ethereum', address: evm(2), name: 'Wallet B' },
	{ chain: 'base', address: evm(3), name: 'Wallet C' },
	{ chain: 'near', address: 'stromwerk-test.near', name: 'Wallet D' },
	{ chain: 'polygon', address: evm(5), name: 'Wallet E' }
];

/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	bridge = await startBridge({ name: 'wallet-groups' });
});

test.afterAll(async () => {
	await bridge?.stop();
});

test('wallets grouped by chain, searched, folded; the tab is kept', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Wallet-Gruppen');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await pairBridge(page, bridge);
	await openIntegration(page, 'wallets');

	const card = page.getByTestId('wallets-card');
	for (const w of WALLETS) {
		const open = card.getByTestId('wallet-add-open');
		if (await open.isVisible()) await open.click();
		await card.getByTestId('wallet-chain').selectOption(w.chain);
		await card.getByTestId('wallet-address-input').fill(w.address);
		await card.getByTestId('wallet-new-name').fill(w.name);
		await card.getByTestId('wallet-add-button').click();
		await expect(card.getByTestId('wallet').filter({ hasText: w.name })).toHaveCount(1);
	}

	// The list is the first tab; one group per chain, by name where nothing has a value yet.
	await expect(card.getByTestId('wallets-tab-wallets')).toHaveAttribute('aria-selected', 'true');
	const groups = card.getByTestId('wallet-group');
	await expect(groups).toHaveCount(4);
	await expect(card.getByTestId('wallet-group-name')).toHaveText([
		'Base',
		'Ethereum',
		'NEAR',
		'Polygon PoS'
	]);
	const eth = card.locator('[data-testid="wallet-group"][data-chain="ethereum"]');
	await expect(eth.getByTestId('wallet-group-count')).toHaveText('2 Wallets');
	await expect(eth.getByTestId('wallet')).toHaveCount(2);
	await expect(eth.getByTestId('wallet-group-sync')).toBeVisible();

	// Search: by name, by a piece of the address, by the chain; nothing found says so.
	const search = card.getByTestId('wallets-search');
	await search.fill('wallet b');
	await expect(groups).toHaveCount(1);
	await expect(eth.getByTestId('wallet-group-count')).toHaveText('1 von 2 Wallets');
	await expect(eth.getByTestId('wallet')).toHaveText(/Wallet B/);
	await search.fill('0003');
	await expect(card.getByTestId('wallet-group-name')).toHaveText(['Base']);
	await search.fill('near');
	await expect(card.getByTestId('wallet-group-name')).toHaveText(['NEAR']);
	await search.fill('Stromwerk-Test');
	await expect(card.getByTestId('wallet-group-name')).toHaveText(['NEAR']);
	await search.fill('nirgends');
	await expect(groups).toHaveCount(0);
	await expect(card.getByTestId('wallets-search-none')).toContainText('nirgends');
	await search.fill('');
	await expect(groups).toHaveCount(4);

	// Folding: all closed, one opened again.
	await card.getByTestId('wallets-collapse-all').click();
	await expect(eth.getByTestId('wallet').first()).toBeHidden();
	await eth.getByTestId('wallet-group-toggle').click();
	await expect(eth.getByTestId('wallet').first()).toBeVisible();
	await card.getByTestId('wallets-expand-all').click();

	// The row: ⋯ holds name, account, cost centre and the explorer; the details name the API per chain.
	const near = card.locator('[data-testid="wallet-group"][data-chain="near"]');
	const d = near.getByTestId('wallet');
	await expect(d.getByTestId('wallet-edit')).toBeHidden();
	await d.getByTestId('wallet-menu').click();
	await expect(d.getByTestId('wallet-edit')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(d.getByTestId('wallet-edit')).toBeHidden();
	await expect(d.getByTestId('wallet-details')).toBeHidden();
	await d.getByTestId('wallet-details-toggle').click();
	await expect(d.getByTestId('wallet-details')).toBeVisible();
	await expect(d.getByTestId('wallet-endpoints')).toContainText('API (NearBlocks)');
	await expect(d.getByTestId('wallet-endpoints')).not.toContainText('Blockscout');

	// The tab is kept by this browser: away and back, still the overview.
	await card.getByTestId('wallets-tab-overview').click();
	await expect(card.getByTestId('wallets-panel-overview')).toBeVisible();
	await expect(card.getByTestId('wallets-panel-wallets')).toBeHidden();
	await page.getByTestId('tab-zahlungen').click();
	await openIntegration(page, 'wallets');
	await expect(card.getByTestId('wallets-tab-overview')).toHaveAttribute('aria-selected', 'true');
	await expect(card.getByTestId('wallet-chain-total')).toHaveCount(4);
	await card.getByTestId('wallets-tab-statements').click();
	await expect(card.getByTestId('wallet-statement-aleph')).toBeVisible();

	// On a phone: one column, the groups folded until opened.
	await card.getByTestId('wallets-tab-wallets').click();
	await page.setViewportSize({ width: 375, height: 812 });
	await page.getByTestId('tab-zahlungen').click();
	await openIntegration(page, 'wallets');
	await expect(groups).toHaveCount(4);
	await expect(eth).toHaveAttribute('data-open', 'false');
	await expect(eth.getByTestId('wallet').first()).toBeHidden();
	await eth.getByTestId('wallet-group-toggle').click();
	await expect(eth.getByTestId('wallet').first()).toBeVisible();
	const box = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(box).toBeLessThanOrEqual(375);
});

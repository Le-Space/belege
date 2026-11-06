// Integrationen has an overview and a page per integration (issue #152).
import { expect } from '@playwright/test';

/**
 * Open one integration's page from the overview.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'bridge' | 'bank' | 'ki' | 'kraken' | 'wallets' | 'aleph' | 'geraete' | 'portale' | 'rechnungs-app' | 'assistent'} id
 */
export async function openIntegration(page, id) {
	// Always through the tab: a check of the URL can race a navigation still under way.
	await page.getByTestId('tab-integrationen').click();
	await expect(page).toHaveURL(/\/integrationen\/?$/);
	await page.getByTestId(id === 'bridge' ? 'integration-bridge' : `integration-${id}`).click();
	await expect(page.getByTestId('integration-title')).toBeVisible();
}

/**
 * The device card's "Erweitert", opened if it is not: this device's id and QR
 * code, adding a device, the bridge share and the sync log live there.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openDevicesAdvanced(page) {
	const advanced = page.getByTestId('devices-advanced');
	if (!(await advanced.evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open))) {
		await advanced.locator('summary').first().click();
	}
}

/**
 * The backup card's "Erweitert", opened if it is not (#656): account, key,
 * grant, the full backup, the list and its options live there.
 *
 * @param {import('@playwright/test').Locator} card the backup card
 */
export async function openBackupAdvanced(card) {
	const advanced = card.getByTestId('backup-advanced');
	if (!(await advanced.evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open))) {
		await advanced.locator('summary').first().click();
	}
}

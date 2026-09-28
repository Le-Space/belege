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

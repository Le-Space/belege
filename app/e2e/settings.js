// The settings are an overview of tiles, each opening a page of its own
// (/einstellungen/<id>): the way a person gets to one of them.
import { expect } from '@playwright/test';

/**
 * Opens one page of the settings from wherever the app is.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'einrichtung' | 'firma' | 'abgleich' | 'gelerntes' | 'buchhaltung' | 'kontenplan' | 'reisende' | 'schluessel' | 'speicher'} id
 */
export async function openSettings(page, id) {
	await page.getByTestId('settings-link').click();
	await page.getByTestId(`settings-tile-${id}`).click();
	await expect(page.getByTestId('settings-section')).toHaveAttribute('data-section', id);
}

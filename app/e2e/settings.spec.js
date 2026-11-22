// The settings: an overview of tiles, a page for each, the old anchors still
// lead somewhere, and the tables there can be searched, filtered and sorted.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openSettings } from './settings.js';

const REVIEW_DIR = process.env.REVIEW_DIR;

/** A link followed inside the app: a reload would ask for the passkey again. */
const follow = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ href) =>
	page.evaluate((to) => {
		const a = document.createElement('a');
		a.href = to;
		document.body.append(a);
		a.click();
		a.remove();
	}, href);

test('an overview of tiles, each with a page of its own, and tables to search and sort', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		for (const [last4, name] of [
			['0011', 'Konto A'],
			['0022', 'Konto B']
		])
			await e2e.addAccount({
				source: 'hibiscus',
				sourceAccountId: last4,
				ibanLast4: last4,
				name,
				currency: 'EUR'
			});
	});

	// The overview: eleven tiles, no form.
	await page.getByTestId('settings-link').click();
	const overview = page.getByTestId('settings-overview');
	await expect(
		overview.locator('[data-testid^="settings-tile-"]:not([data-testid$="-state"])')
	).toHaveCount(11);
	await expect(page.getByTestId('matching-save')).toHaveCount(0);
	if (REVIEW_DIR)
		await page.screenshot({ path: `${REVIEW_DIR}/settings-overview.png`, fullPage: true });

	// One page: its own title, the way back, and only its part.
	await page.getByTestId('settings-tile-buchhaltung').click();
	await expect(page).toHaveURL(/\/einstellungen\/buchhaltung$/);
	await expect(page.getByTestId('settings-section-title')).toBeVisible();
	await expect(page.getByTestId('books-settings')).toBeVisible();
	await expect(page.getByTestId('company-names')).toHaveCount(0);
	await expect(page.getByTestId('chart')).toHaveCount(0);

	// The accounts are a table: searched, filtered, sorted.
	const table = page.getByTestId('ledger-accounts');
	await expect(table.getByTestId('ledger-row')).toHaveCount(2);
	await table.getByTestId('ledger-accounts-search').fill('konto 0022');
	await expect(table.getByTestId('ledger-row')).toHaveCount(1);
	await expect(table.getByTestId('ledger-accounts-count')).toContainText('1');
	await table.getByTestId('ledger-accounts-search').fill('');
	await page.locator('[data-testid="ledger-account"][data-account="0022"]').fill('1210');
	await table.getByTestId('ledger-accounts-filter-missing').check();
	await expect(table.getByTestId('ledger-row')).toHaveCount(1);
	await expect(table.getByTestId('ledger-row')).toContainText('Konto A');
	await table.getByTestId('ledger-accounts-filter-missing').uncheck();
	await table.getByTestId('ledger-accounts-sort-account').click();
	await expect(table.getByTestId('ledger-row').first()).toContainText('Konto A');
	await table.getByTestId('ledger-accounts-sort-account').click();
	await expect(table.getByTestId('ledger-row').first()).toContainText('Konto B');
	if (REVIEW_DIR)
		await page.screenshot({ path: `${REVIEW_DIR}/settings-buchhaltung.png`, fullPage: true });

	await page.getByTestId('settings-back').click();
	await expect(overview).toBeVisible();

	// The Verlauf (#967): a tile that says what it holds, a link straight to
	// each group, and the clock in the header from every page.
	const verlaufTile = page.getByTestId('settings-tile-verlauf');
	await expect(verlaufTile).toContainText('Verlauf');
	await expect(verlaufTile).toContainText('was du entschieden hast');
	const groups = page.getByTestId('settings-verlauf-group');
	await expect(groups).toHaveCount(4);
	await groups.filter({ hasText: 'Abruf' }).click();
	await expect(page).toHaveURL(/\/verlauf\?group=abruf$/);
	await expect(page.locator('[data-testid="verlauf-filter"][data-group="abruf"]')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByTestId('settings-link').click();
	await verlaufTile.click();
	await expect(page).toHaveURL(/\/verlauf$/);
	await expect(page.getByTestId('header-verlauf')).toHaveAttribute('aria-current', 'page');
	await page.getByTestId('tab-zahlungen').click();
	await expect(page.getByTestId('header-verlauf')).not.toHaveAttribute('aria-current', 'page');
	await page.getByTestId('header-verlauf').click();
	await expect(page).toHaveURL(/\/verlauf$/);
	await expect(page.locator('[data-testid="verlauf-filter"][data-group="all"]')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByTestId('settings-link').click();

	// A link from before the pages (/einstellungen#kontenplan) opens the page.
	await follow(page, '/einstellungen#kontenplan');
	await expect(page).toHaveURL(/\/einstellungen\/kontenplan$/);
	await expect(page.getByTestId('chart')).toBeVisible();

	// A page that does not exist says so and leads back.
	await follow(page, '/einstellungen/gibt-es-nicht');
	await expect(page.getByTestId('settings-unknown')).toBeVisible();

	// Narrow: a row of the table is a card, nothing wider than the screen.
	await page.setViewportSize({ width: 344, height: 800 });
	await openSettings(page, 'buchhaltung');
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(344);
	if (REVIEW_DIR) {
		await page.screenshot({
			path: `${REVIEW_DIR}/settings-buchhaltung-narrow.png`,
			fullPage: true
		});
		await page.getByTestId('settings-back').click();
		await page.screenshot({ path: `${REVIEW_DIR}/settings-overview-narrow.png`, fullPage: true });
	}
});

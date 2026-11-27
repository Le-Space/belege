// The acknowledgments (#1053): the consent screen needs "gelesen" and asks
// again after a version bump; the first start asks once that Belege is not a
// cloud app; Home shows the cloud banner while there is neither a backup nor
// an own device, small after "Verstanden", gone after a backup. Each is kept
// with its text's version and time in the books' sealed settings.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';

/** @param {import('@playwright/test').Page} page @param {string} kind */
const acknowledgment = (page, kind) =>
	page.evaluate((k) => /** @type {any} */ (window).__belegeE2E.acknowledgment(k), kind);

test('consent, first start and the cloud banner, each kept in the books', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');

	// The consent screen: "Verstanden" only after "gelesen"; the new sentences are there.
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	const terms = dialog.getByTestId('consent-terms');
	await terms.locator('summary').click();
	await expect(terms).toContainText('Belege ist keine Cloud-App');
	await expect(terms).toContainText('weder deine Passkeys noch deine Wiederherstellungswörter');
	await expect(terms).toContainText('nicht von DATEV zertifiziert');
	await expect(dialog.getByTestId('consent-proceed')).toBeDisabled();
	await dialog.getByTestId('consent-read').check();
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();

	await page.getByTestId('passkey-label').fill('E2E Hinweise');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	// The acceptance, now that there are books, in their settings.
	await expect
		.poll(async () => (await acknowledgment(page, 'consent'))?.entries?.[0]?.text)
		.toMatch(/^consent-\d+$/);

	// The first start: no way in before the sentence is ticked, and asked once.
	await expect(page.getByTestId('setup-start-look')).toBeDisabled();
	await page.getByTestId('setup-start-ack').check();
	await page.getByTestId('setup-start-look').click();
	await expect(page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });
	const start = await acknowledgment(page, 'onboarding');
	expect(start.entries).toHaveLength(1);
	expect(start.entries[0].text).toBe('no-backup-1');
	expect(Date.parse(start.entries[0].at)).toBeGreaterThan(Date.now() - 5 * 60_000);

	// Books with something in them, no backup, no device: the banner, in full.
	const banner = page.getByTestId('cloud-banner');
	await expect(banner).toHaveAttribute('data-size', 'full');
	await expect(banner).toContainText('Belege ist keine Cloud-App');
	await expect(banner).toContainText('Le Space hat keine Kopie und kann nichts wiederherstellen');
	await banner.getByTestId('cloud-banner-ok').click();
	await expect(banner).toHaveAttribute('data-size', 'small');
	expect((await acknowledgment(page, 'no-backup')).entries[0].text).toBe('no-backup-1');

	// Small after a reload too: kept in the books, not in this browser.
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect(banner).toHaveAttribute('data-size', 'small');
	const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	expect(stored).not.toContain('no-backup-1');
	expect(stored).not.toContain('ack/');

	// A backup: the banner goes.
	await page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.rememberBackup({
			at: new Date().toISOString(),
			provider: 'aleph',
			cid: 'bafyexamplebackup',
			size: 1,
			status: 'processed',
			entries: 1
		})
	);
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
	await nav.getByRole('link', { name: 'Export' }).click();
	await nav.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(banner).toHaveCount(0);
});

test('a new version of the consent screen asks again, "gelesen" included', async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('belege.consent', '1');
			sessionStorage.setItem('seeded', '1');
		}
	});
	await page.goto('/');
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('consent-proceed')).toBeDisabled();
	await dialog.getByTestId('consent-read').check();
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();
	await page.reload();
	await expect(page.getByTestId('passkey-onboarding')).toBeVisible();
	await expect(dialog).toBeHidden();
});

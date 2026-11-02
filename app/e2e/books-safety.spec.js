// Whether the books would survive this browser (storage/safety.js): asked for
// persistent storage on unlock; Home warns while the browser may clear the
// books and there is no other copy, and reminds – for a week at a time – when
// the browser keeps them but no backup does. The browser's answer is stubbed.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ granted: boolean, grantOnAsk?: boolean }} answer
 */
async function stubPersistence(page, { granted, grantOnAsk = false }) {
	await page.addInitScript(
		([granted, grantOnAsk]) => {
			let kept = granted;
			/** @type {any} */ (window).__persistAsked = 0;
			const storage = navigator.storage;
			storage.persisted = async () => kept;
			storage.persist = async () => {
				/** @type {any} */ (window).__persistAsked++;
				if (grantOnAsk && /** @type {any} */ (window).__persistAsked > 1) kept = true;
				return kept;
			};
		},
		[granted, grantOnAsk]
	);
}

/** @param {import('@playwright/test').Page} page @param {string} label */
async function startWithSample(page, label) {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByTestId('setup-start-look').click();
	await expect(page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });
}

test('warns while the browser may clear the books, until it agrees', async ({ page }) => {
	// Refused on unlock; the second ask (the button) is granted.
	await stubPersistence(page, { granted: false, grantOnAsk: true });
	await startWithSample(page, 'E2E Sicherung');
	expect(await page.evaluate(() => /** @type {any} */ (window).__persistAsked)).toBe(1);

	const card = page.getByTestId('home-safety');
	await expect(card).toHaveAttribute('data-level', 'warn');
	await expect(card).toContainText('Deine Bücher liegen nur in diesem Browser');
	await expect(card.getByTestId('home-safety-backup')).toHaveText('Noch kein Backup.');
	await expect(card.getByTestId('home-safety-snooze')).toHaveCount(0);

	// Kept now: a reminder, which can be put away for a week.
	await card.getByTestId('home-safety-persist').click();
	await expect(card).toHaveAttribute('data-level', 'remind');
	await expect(card).toContainText('Zeit für ein Backup');
	await card.getByTestId('home-safety-snooze').click();
	await expect(card).toHaveCount(0);
	expect(
		Number(await page.evaluate(() => localStorage.getItem('belege.safety-snooze')))
	).toBeGreaterThan(Date.now());
});

test('empty books ask for nothing to be saved', async ({ page }) => {
	await stubPersistence(page, { granted: false });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Leer');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__persistAsked)).toBe(1);
	await expect(page.getByTestId('home-safety')).toHaveCount(0);
});

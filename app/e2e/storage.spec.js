// Storage and factory reset (issue #212): Einstellungen shows what each
// database and the receipt files take; "Alles in diesem Browser löschen" asks
// for a typed word, then leaves nothing of the app in this browser – the next
// page is the first visit again. Also from the unlock screen.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** What the browser still holds for this site. @param {import('@playwright/test').Page} page */
const held = (page) =>
	page.evaluate(async () => ({
		databases: (await indexedDB.databases()).map((d) => String(d.name)),
		caches: await caches.keys(),
		local: Object.keys(localStorage),
		session: Object.keys(sessionStorage)
	}));

/** @param {import('@playwright/test').Page} page @param {string} label */
async function start(page, label) {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
}

test('what the books take, and a reset that leaves nothing behind', async ({ page }) => {
	await start(page, 'E2E Speicher');
	await page.getByTestId('setup-start-look').click();
	await expect(page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });

	await page.getByTestId('settings-link').click();
	const card = page.getByTestId('storage-card');
	const row = (/** @type {string} */ name) =>
		card.locator(`[data-testid="storage-database"][data-name="${name}"] td`);
	await expect(card.getByTestId('storage-database')).toHaveCount(8);
	// Twelve sample bookings; each was written more than once (import, then the mark).
	await expect(row('transactions').nth(0)).toHaveText('12');
	expect(Number(await row('transactions').nth(1).textContent())).toBeGreaterThan(12);
	await expect(card.getByTestId('storage-databases-size')).not.toHaveText(/^0\s/);
	await expect(card.getByTestId('storage-total')).toBeVisible();
	expect((await held(page)).databases.some((n) => n.includes('belege'))).toBe(true);

	// The word, not a click: anything else keeps the button off.
	await card.getByTestId('reset-open').click();
	const dialog = page.getByTestId('reset-dialog');
	await expect(dialog.getByTestId('reset-before')).toContainText('Monate exportieren');
	await expect(dialog.getByTestId('reset-confirm')).toBeDisabled();
	await dialog.getByTestId('reset-word').fill('ja');
	await expect(dialog.getByTestId('reset-confirm')).toBeDisabled();
	await dialog.getByTestId('reset-word').fill('löschen');
	await dialog.getByTestId('reset-confirm').click();

	// A first visit again, and nothing of the books left in this browser.
	await expect(page.getByTestId('consent-modal')).toBeVisible({ timeout: 60_000 });
	const after = await held(page);
	expect(after.databases.filter((n) => n.includes('belege'))).toEqual([]);
	expect(after.local.filter((k) => k !== 'belege.theme')).toEqual([]);
	// The fresh page's own router state is all there is.
	expect(after.session.filter((k) => !k.startsWith('sveltekit:'))).toEqual([]);
	await acceptConsent(page);
	await expect(page.getByTestId('passkey-unlock')).toHaveCount(0);
	await expect(page.getByTestId('passkey-label')).toBeVisible();
});

test('from the unlock screen, without unlocking', async ({ page }) => {
	await start(page, 'E2E Zurücksetzen');
	await page.reload();
	await expect(page.getByTestId('passkey-unlock')).toBeVisible();
	await page.getByTestId('reset-from-lock').click();
	const dialog = page.getByTestId('reset-dialog');
	// Locked: nothing to offer first.
	await expect(dialog.getByTestId('reset-before')).toHaveCount(0);
	await dialog.getByTestId('reset-cancel').click();
	await expect(dialog).toBeHidden();
	await page.getByTestId('reset-from-lock').click();
	await dialog.getByTestId('reset-word').fill('LÖSCHEN');
	await dialog.getByTestId('reset-confirm').click();
	await expect(page.getByTestId('consent-modal')).toBeVisible({ timeout: 60_000 });
	expect((await held(page)).databases.filter((n) => n.includes('belege'))).toEqual([]);
});

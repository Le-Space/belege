// The consent screen and the footer: what a first visit shows before anything
// else, that the decision is remembered and can be revisited, that the
// technical level stays out of the way until asked for, and that the footer
// names this repository as the source.
import { test, expect } from '@playwright/test';
import { acceptConsent } from './consent.js';

test('the consent screen opens on a first visit, and not after "Verstanden"', async ({ page }) => {
	await page.goto('/');
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Bevor du anfängst' })).toBeVisible();

	// A decision, not something to dismiss: no close control, and Escape does
	// not close it.
	await expect(dialog.getByTestId('consent-close')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();

	// The four sections, in plain words.
	await expect(dialog.getByTestId('consent-identity')).toContainText('Ohne Passkey geht nichts');
	await expect(dialog.getByTestId('consent-loss')).toContainText(
		'Verlierst du den Passkey, verlierst du den Zugang zu deinen Daten'
	);
	await expect(dialog.getByTestId('consent-network')).toContainText('Netzwerk: aus');
	// Collaboration has its place, off and not switchable yet.
	const collaboration = dialog.getByTestId('consent-collaboration');
	await expect(collaboration).toContainText('geplant');
	await expect(dialog.getByTestId('consent-collaboration-switch')).toBeDisabled();
	await expect(dialog.getByTestId('consent-collaboration-switch')).not.toBeChecked();
	// Planned services say so; the LLM runs only once it is set up on the bridge.
	await expect(
		dialog.locator('[data-service="enableBanking"]').getByTestId('consent-service-status')
	).toHaveText('noch nicht aktiv');
	await expect(
		dialog.locator('[data-service="deepseek"]').getByTestId('consent-service-status')
	).toHaveText('aktiv, wenn eingerichtet');
	await expect(dialog.locator('[data-service="deepseek"]')).toContainText('außerhalb der EU');
	// Where KI helps: not ours, the model each installation sets up, only on a ✦ button.
	const ai = dialog.getByTestId('consent-ai');
	await expect(ai).toContainText('Le Space betreibt keine KI');
	await expect(ai).toContainText('lokales auf deinem eigenen Rechner');
	await expect(ai.getByTestId('consent-ai-uses').locator('li')).toHaveCount(3);
	await expect(ai).toContainText('Ohne KI, nach festen Regeln');
	// The customer portals: a browser on this Mac, only once set up.
	await expect(
		dialog.locator('[data-service="portals"]').getByTestId('consent-service-status')
	).toHaveText('aktiv, wenn eingerichtet');
	await expect(dialog.locator('[data-service="portals"]')).toContainText(
		'nur die Rechnungen herunter'
	);

	const before = await page.evaluate(() => Object.keys(localStorage).sort());
	await acceptConsent(page);
	// A flag, and nothing else.
	const after = await page.evaluate(() =>
		Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]))
	);
	expect(Object.keys(after).filter((key) => !before.includes(key))).toEqual(['belege.consent']);
	// CONSENT_VERSION in src/lib/consent.js.
	expect(after['belege.consent']).toBe('4');
	await expect(page.getByTestId('passkey-onboarding')).toBeVisible();

	await page.reload();
	await expect(page.getByTestId('passkey-onboarding')).toBeVisible();
	await expect(dialog).toBeHidden();
});

test('the consent screen can be opened again, from the footer and the header', async ({ page }) => {
	await page.goto('/');
	await acceptConsent(page);
	const dialog = page.getByTestId('consent-modal');

	await page.getByTestId('consent-reopen').click();
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('consent-close').click();
	await expect(dialog).toBeHidden();

	await page.getByTestId('local-only').click();
	await expect(dialog).toBeVisible();
	// Accepted already, so Escape may close it now.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});

test('the technical explanation stays hidden until "Technisch" is switched on', async ({
	page
}) => {
	await page.goto('/');
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	const technical = dialog.locator('[data-testid^="consent-technical-"]');

	await expect(technical).toHaveCount(0);
	await expect(dialog).not.toContainText('HKDF-SHA-256');

	await dialog.getByTestId('consent-technical').click();
	await expect(dialog.getByTestId('consent-technical-identity')).toContainText('PRF-Erweiterung');
	await expect(dialog.getByTestId('consent-technical-storage')).toContainText('HKDF-SHA-256');
	await expect(dialog.getByTestId('consent-technical-network')).toContainText('ohne Transporte');
	await expect(dialog.getByTestId('consent-technical-service')).toHaveCount(5);
	await expect(
		dialog.locator('[data-service="portals"]').getByTestId('consent-technical-service')
	).toContainText('FileVault');

	// One switch for the page: the header's shows the same state.
	await dialog.getByTestId('consent-technical').click();
	await expect(technical).toHaveCount(0);
	await expect(dialog).not.toContainText('HKDF-SHA-256');
});

test('the footer credits Le Space and names this repository as the source', async ({ page }) => {
	await page.goto('/');
	await acceptConsent(page);
	const footer = page.getByTestId('app-footer');

	const source = footer.getByTestId('source-link');
	await expect(source).toHaveText('Quellcode');
	await expect(source).toHaveAttribute('href', 'https://github.com/Le-Space/belege');

	const credit = footer.getByTestId('le-space-credit');
	await expect(credit).toHaveAttribute('href', 'https://le-space.de');
	await expect(credit).toHaveAccessibleName('Le Space');
	await expect(footer).toContainText('Gebaut mit');
	const mark = credit.getByTestId('le-space-credit-mark');
	expect(await mark.getAttribute('width')).toBe('22');
	// The credit belongs to the footer only.
	await expect(page.locator('header').getByTestId('le-space-credit')).toHaveCount(0);

	// The build: the commit's instant, UTC on hover and for machines, and the
	// commit in this repository.
	const time = footer.getByTestId('build-stamp').locator('time');
	await expect(time).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
	await expect(time).toHaveAttribute('title', /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
	await expect(footer.getByTestId('build-stamp').getByRole('link')).toHaveAttribute(
		'href',
		/^https:\/\/github\.com\/Le-Space\/belege\/commit\/[0-9a-f]{40}$/
	);
});

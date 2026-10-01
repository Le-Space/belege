// Help in context (issue #200, step 4): an empty page names the next step, and
// an integration's page says what it is and how to set it up, with the command
// to copy and the docs in the app's language.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('empty pages lead on; an integration explains itself', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Hilfe');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const tab = (/** @type {string} */ name) => page.getByRole('link', { name, exact: true });

	// No payments yet: the export says why, and both pages lead to the bank's page.
	await tab('Export').click();
	await expect(page.getByTestId('export-empty-link')).toBeVisible();
	await tab('Belege').click();
	await expect(page.getByTestId('receipts-empty-link')).toBeVisible();
	await tab('Zahlungen').click();
	await page.getByTestId('transactions-empty').getByRole('link').click();
	await expect(page).toHaveURL(/\/integrationen\/bank$/);

	// Not set up yet: the help is unfolded, with the command and the docs.
	const help = page.getByTestId('integration-help');
	await expect(help).toHaveAttribute('open', '');
	await expect(help).toContainText('CAMT.053');
	await expect(help.getByTestId('integration-help-command-value')).toHaveText(
		'pnpm setup:hibiscus'
	);
	await expect(help.getByTestId('integration-help-doc')).toHaveAttribute(
		'href',
		/docs\/banking\.de\.md$/
	);

	// The docs follow the language.
	await page.getByTestId('integration-back').click();
	await page.getByRole('link', { name: /KI/ }).first().click();
	await expect(help.getByTestId('integration-help-doc')).toHaveAttribute(
		'href',
		/docs\/ai\.de\.md$/
	);
	await page.getByTestId('language-en').click();
	await expect(help.getByTestId('integration-help-doc')).toHaveAttribute('href', /docs\/ai\.md$/);
	await expect(help).toContainText('What is this');
});

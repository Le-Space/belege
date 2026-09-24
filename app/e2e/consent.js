// The consent screen, as a test gets past it.
//
// It opens on every first visit (and after `forgetThisDevice`, which clears
// the flag), in front of the passkey onboarding, and the page behind it is
// inert until "Verstanden". Specs that are about something else call this
// right after their first `page.goto`.
import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export async function acceptConsent(page) {
	const dialog = page.getByTestId('consent-modal');
	await expect(dialog).toBeVisible();
	await dialog.getByTestId('consent-proceed').click();
	await expect(dialog).toBeHidden();
}

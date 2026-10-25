// Recovery words (#406, stage 2), end to end: books on passkey A, offered
// words right after they are made; 24 words made under Einstellungen →
// Schlüssel, three asked back (a wrong one refused), the vault kept on (a
// fake) Aleph. Then A is gone from the authenticator and this browser forgets
// everything: on the lock screen, the words alone – misspelt first, then
// right, pasted with their numbers – find the vault through their index, a new
// passkey is made, and it opens the same books: the same identity, databases
// and keys. Every key and address is made up (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator, forgetThisDevice } from './webauthn.js';
import { acceptConsent } from './consent.js';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

test.beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {} });
});
test.afterAll(async () => {
	await aleph?.close();
});

/** @param {import('@playwright/test').Page} page */
const books = (page) =>
	page.evaluate(() => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const secrets = e2e.secrets();
		return {
			booksDid: String(e2e.booksDid()),
			addresses: e2e.addresses(),
			databaseKey: secrets.databaseKey,
			blobKey: secrets.blobKey
		};
	});

test('recovery words open the same books when every passkey is gone', async ({ page }) => {
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	const cdp = await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const didA = await page.getByTestId('own-did').getAttribute('data-did');
	const booksOfA = await books(page);

	// New books: the words are offered, and lead to the keys.
	await expect(page.getByTestId('words-offer')).toContainText('Wiederherstellungswörter');
	await page.getByTestId('words-offer-go').click();
	const keys = page.getByTestId('keys-card');
	await expect(keys.getByTestId('keys-single')).toBeVisible();
	await expect(keys.getByTestId('words-none')).toBeVisible();
	await expect(page.getByTestId('words-offer')).toHaveCount(0);

	// 24 words, shown once.
	await keys.getByTestId('words-start').click();
	const shown = keys.getByTestId('words-word');
	await expect(shown).toHaveCount(24);
	const words = await shown.allTextContents();
	await expect(keys.getByTestId('words-next')).toBeDisabled();
	await keys.getByTestId('words-written').check();
	await keys.getByTestId('words-next').click();

	// Three asked back: a wrong one is refused, then the right ones.
	const inputs = keys.getByTestId('words-ask-input');
	await expect(inputs).toHaveCount(3);
	const positions = await inputs.evaluateAll((els) =>
		els.map((e) => Number(e.getAttribute('data-position')))
	);
	await inputs.nth(0).fill('falsch');
	await inputs.nth(1).fill(words[positions[1] - 1]);
	await inputs.nth(2).fill(words[positions[2] - 1]);
	await keys.getByTestId('words-confirm').click();
	await expect(keys.getByTestId('words-error')).toContainText(`Stelle ${positions[0]}`);
	await inputs.nth(0).fill(words[positions[0] - 1].toUpperCase());
	await expect(keys.getByTestId('words-publish')).toBeChecked();
	await keys.getByTestId('words-confirm').click();
	await expect(keys.getByTestId('words-done')).toContainText('öffnen jetzt die Bücher', {
		timeout: 30_000
	});
	await expect(keys.getByTestId('words-has')).toBeVisible();
	await expect(keys.getByTestId('words-word')).toHaveCount(0);
	// One passkey, but words: no longer "the only key".
	await expect(keys.getByTestId('keys-single')).toHaveCount(0);
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);
	// Index M of the books, P of A and W of the words; no word on Aleph, nor in this browser.
	expect(aleph.kept.size).toBe(3);
	const onAleph = JSON.stringify([...aleph.kept.values()]);
	const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	for (const w of words) {
		expect(onAleph).not.toMatch(new RegExp(`\\b${w}\\b`));
		expect(kept).not.toMatch(new RegExp(`\\b${w}\\b`));
	}

	// Passkey A is gone, and so is everything this browser had.
	const { credentials } = await cdp.send('WebAuthn.getCredentials', {
		authenticatorId: cdp.authenticatorId
	});
	expect(credentials).toHaveLength(1);
	await cdp.send('WebAuthn.removeCredential', {
		authenticatorId: cdp.authenticatorId,
		credentialId: credentials[0].credentialId
	});
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);

	// The words, one swapped: they do not fit together, and nothing is made.
	await page.getByTestId('words-recover').locator('summary').click();
	const swapped = [...words];
	[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
	if (swapped[0] === swapped[1]) swapped[0] = swapped[0] === 'zoo' ? 'abandon' : 'zoo';
	await page.getByTestId('words-recover-text').fill(swapped.join(' '));
	await page.getByTestId('words-recover-go').click();
	await expect(page.getByTestId('passkey-error')).toContainText(/passen nicht zusammen|nicht/);
	expect(
		(await cdp.send('WebAuthn.getCredentials', { authenticatorId: cdp.authenticatorId }))
			.credentials
	).toHaveLength(0);

	// The words as written on paper, numbered: a new passkey, the same books.
	if (!(await page.getByTestId('words-recover-text').isVisible())) {
		await page.getByTestId('words-recover').locator('summary').click();
	}
	await page
		.getByTestId('words-recover-text')
		.fill(words.map((w, i) => `${i + 1}. ${w}`).join('\n'));
	await page.getByTestId('words-recover-label').fill('Ersatz');
	await page.getByTestId('words-recover-go').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	const didNew = await page.getByTestId('own-did').getAttribute('data-did');
	expect(didNew).not.toBe(didA);
	expect(await books(page)).toEqual(booksOfA);
	// Recovered books are no new books: nothing offered.
	await expect(page.getByTestId('words-offer')).toHaveCount(0);

	// The new passkey has its slot beside A's, and the words stay.
	await page.getByTestId('settings-link').click();
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	await expect(keys.getByTestId('keys-slot').filter({ hasText: 'Ersatz' })).toHaveCount(1);
	await expect(keys.getByTestId('words-has')).toBeVisible();

	// Next time, the new passkey alone.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', String(didNew));
	expect(await books(page)).toEqual(booksOfA);
});

// The books' vault (#406), end to end: books on passkey A with a payment; a
// second passkey B added under Einstellungen → Schlüssel and the vault kept on
// (a fake) Aleph; then A is gone from the authenticator and this browser
// forgets everything – B alone, on what is now an empty device, finds the
// vault through its index and opens the same books: the same identity,
// databases and keys (what they hold comes from a backup or an own device). B then takes A out, and a
// third passkey C is added and removed again with the vault renewed. Every
// key and address is made up (@belege/bridge/testing/aleph).
import { test, expect } from '@playwright/test';
import { startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator, forgetThisDevice } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openSettings } from './settings.js';

const MARKER = 'Tresorprobe-Lindenweg';

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

test.beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {} });
});
test.afterAll(async () => {
	await aleph?.close();
});

/** @param {import('@playwright/test').Page} page */
const transactions = (page) =>
	page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return ((await e2e.transactions()) ?? []).map((/** @type {any} */ t) => t.counterparty);
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

/** @param {import('@playwright/test').Page} page */
async function openKeys(page) {
	// In the app, not by URL: a reload would lock the books.
	await openSettings(page, 'schluessel');
	await expect(page.getByTestId('keys-card')).toBeVisible();
	return page.getByTestId('keys-card');
}

test('a second passkey opens the same books, also alone on an empty device', async ({ page }) => {
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	const cdp = await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const didA = await page.getByTestId('own-did').getAttribute('data-did');
	const booksOfA = await books(page);
	await page.evaluate(
		(marker) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-10-01',
				counterparty: marker,
				purpose: 'Probe',
				amountCents: -4711
			}),
		MARKER
	);

	// One key only: said plainly.
	let keys = await openKeys(page);
	await expect(keys.getByTestId('keys-single')).toContainText('Einziger Schlüssel');
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);
	await expect(keys.getByTestId('keys-slot-mine')).toBeVisible();

	// A second passkey, and the vault kept on Aleph.
	await keys.getByTestId('keys-add-label').fill('YubiKey');
	await expect(keys.getByTestId('keys-publish')).toBeChecked();
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-done')).toContainText('öffnet dieselben Bücher', {
		timeout: 30_000
	});
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	await expect(keys.getByTestId('keys-single')).toHaveCount(0);
	// Index P of each passkey, and index M of the books: three addresses, nothing named.
	expect(aleph.kept.size).toBe(3);
	expect(JSON.stringify([...aleph.kept.values()])).not.toContain('YubiKey');
	expect(JSON.stringify([...aleph.kept.values()])).not.toContain('Laptop');

	// Passkey A is gone, and so is everything this browser had.
	const stored = await page.evaluate(() =>
		JSON.parse(String(localStorage.getItem('belege.webauthnCredential')))
	);
	const { credentials } = await cdp.send('WebAuthn.getCredentials', {
		authenticatorId: cdp.authenticatorId
	});
	expect(credentials).toHaveLength(2);
	const toBase64 = (/** @type {string} */ u) => Buffer.from(u, 'base64url').toString('base64');
	const a = credentials.find((c) => c.credentialId === toBase64(stored.credentialId));
	expect(a).toBeTruthy();
	await cdp.send('WebAuthn.removeCredential', {
		authenticatorId: cdp.authenticatorId,
		credentialId: /** @type {any} */ (a).credentialId
	});
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);

	// Passkey B alone: its index leads to the vault, the vault to the same books.
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	const didB = await page.getByTestId('own-did').getAttribute('data-did');
	expect(didB).not.toBe(didA);
	expect(await books(page)).toEqual(booksOfA);
	expect(await transactions(page)).toEqual([]);
	// … and they write.
	await page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.addTransaction({
			bookedOn: '2026-10-02',
			counterparty: 'Mit B gebucht',
			purpose: 'Probe',
			amountCents: -1
		})
	);
	await expect.poll(async () => (await transactions(page)).length).toBe(1);

	// B takes A out.
	keys = await openKeys(page);
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	// Its name stayed in the first browser: here it is just "Passkey", not this one.
	await expect(keys.getByTestId('keys-slot').filter({ hasText: 'Laptop' })).toHaveCount(0);
	const slotA = keys
		.getByTestId('keys-slot')
		.filter({ hasNot: page.getByTestId('keys-slot-mine') });
	await slotA.getByTestId('keys-remove').click();
	await keys.getByTestId('keys-remove-plain').click();
	await expect(keys.getByTestId('keys-done')).toContainText('Entfernt');
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);
	await expect(keys.getByTestId('keys-single')).toBeVisible();

	// A third passkey, removed again with the vault renewed: B answers once.
	await keys.getByTestId('keys-add-label').fill('Telefon');
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2, { timeout: 30_000 });
	await keys
		.getByTestId('keys-slot')
		.filter({ hasText: 'Telefon' })
		.getByTestId('keys-remove')
		.click();
	await keys.getByTestId('keys-remove-renew').click();
	await expect(keys.getByTestId('keys-done')).toContainText('erneuert', { timeout: 30_000 });
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);

	// After all that, B still opens the same books.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', String(didB));
	await expect.poll(() => transactions(page)).toEqual(['Mit B gebucht']);
	expect(await books(page)).toEqual(booksOfA);
});

// #524: passkey B has a slot in books made elsewhere, kept on Aleph – and
// opens Belege on an empty device without the index being asked (here: the
// network is paused). The device founds books of its own. Under
// Einstellungen → Schlüssel it then asks Aleph, is offered the other books,
// and opens them; the books it founded stay in the browser, set aside.
test('a device that founded its own books finds the vault its passkey belongs to', async ({
	page
}) => {
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	const cdp = await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const booksOfA = await books(page);
	let keys = await openKeys(page);
	await keys.getByTestId('keys-add-label').fill('YubiKey');
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-done')).toContainText('öffnet dieselben Bücher', {
		timeout: 30_000
	});

	// The other device: only passkey B, nothing in the browser, the network paused.
	const stored = await page.evaluate(() =>
		JSON.parse(String(localStorage.getItem('belege.webauthnCredential')))
	);
	const { credentials } = await cdp.send('WebAuthn.getCredentials', {
		authenticatorId: cdp.authenticatorId
	});
	const toBase64 = (/** @type {string} */ u) => Buffer.from(u, 'base64url').toString('base64');
	const a = credentials.find((c) => c.credentialId === toBase64(stored.credentialId));
	await cdp.send('WebAuthn.removeCredential', {
		authenticatorId: cdp.authenticatorId,
		credentialId: /** @type {any} */ (a).credentialId
	});
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);
	const asked = aleph.calls.length;
	await page.evaluate(() =>
		localStorage.setItem(
			'belege.network-paused',
			JSON.stringify({ ucep: false, at: '2026-01-01T00:00:00.000Z' })
		)
	);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	// Paused: Aleph was not asked, and B founded books of its own.
	expect(aleph.calls.length).toBe(asked);
	const ownBooks = await books(page);
	expect(ownBooks.booksDid).not.toBe(booksOfA.booksDid);

	// The network on again. An unlock by itself still asks nothing: device sync is off.
	await page.evaluate(() => localStorage.removeItem('belege.network-paused'));
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	expect(await books(page)).toEqual(ownBooks);
	expect(aleph.calls.length).toBe(asked);
	await expect(page.getByTestId('other-books-banner')).toHaveCount(0);

	// Asked under Einstellungen → Schlüssel: the other vault, with its two passkeys.
	keys = await openKeys(page);
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);
	await keys.getByTestId('keys-other-ask').click();
	const offer = keys.getByTestId('other-books-offer');
	await expect(offer).toContainText('Passkeys darin: 2', { timeout: 30_000 });
	await offer.getByTestId('other-books-open').click();

	// The page reloads; the passkey answers once and opens the books made elsewhere.
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	await expect(page.getByTestId('other-books-result')).toHaveAttribute('data-result', 'opened');
	expect(await books(page)).toEqual(booksOfA);
	keys = await openKeys(page);
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	// Both vaults are kept, sealed: the one founded here set aside for this passkey.
	const kept = await page.evaluate(() =>
		JSON.parse(String(localStorage.getItem('belege.vaults.v1'))).map((/** @type {any} */ r) => ({
			slots: r.vault.slots.length,
			aside: (r.aside ?? []).length
		}))
	);
	expect(kept).toEqual([
		{ slots: 1, aside: 1 },
		{ slots: 2, aside: 0 }
	]);
	expect(await page.evaluate(() => sessionStorage.getItem('belege.vault.other'))).toBeNull();

	// From now on, with nothing asked: the same books.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	expect(await books(page)).toEqual(booksOfA);
	await expect(page.getByTestId('other-books-result')).toHaveCount(0);
});

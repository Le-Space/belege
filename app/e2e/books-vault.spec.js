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
	// Nothing in this browser, nothing asked: the page asks before it makes books (#555).
	await expect(page.getByTestId('new-books-why')).toContainText('Netz pausiert');
	await page.getByTestId('new-books-open').click();
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

// #555: two devices of the same books, each with a vault of its own. Here in
// one browser: the laptop keeps vault 1 with A and B on Aleph; then this
// browser forgets its vault record – as a phone set up before the vault was
// published – and A's unlock makes vault 2, the same books. Its next change
// takes vault 1 first instead of publishing over it, so B, which only vault 1
// has, still opens the books on an empty device.
test('a device with a vault of its own takes the published one, and a later passkey still gets in', async ({
	page
}) => {
	test.setTimeout(240_000);
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
	const vault1 = await page.evaluate(
		() => JSON.parse(String(localStorage.getItem('belege.vaults.v1')))[0].vault.id
	);
	const stored = await page.evaluate(() =>
		JSON.parse(String(localStorage.getItem('belege.webauthnCredential')))
	);
	const toBase64 = (/** @type {string} */ u) => Buffer.from(u, 'base64url').toString('base64');
	const b = (
		await cdp.send('WebAuthn.getCredentials', { authenticatorId: cdp.authenticatorId })
	).credentials.find((c) => c.credentialId !== toBase64(stored.credentialId));
	expect(b).toBeTruthy();

	// The "phone": no vault record, so A's unlock makes vault 2 for the same books.
	// The network paused, so that nothing asks Aleph yet – the keys page would.
	await page.evaluate(() => localStorage.removeItem('belege.vaults.v1'));
	await page.evaluate(() =>
		localStorage.setItem(
			'belege.network-paused',
			JSON.stringify({ ucep: false, at: '2026-01-01T00:00:00.000Z' })
		)
	);
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	expect(await books(page)).toEqual(booksOfA);
	const vault2 = await page.evaluate(
		() => JSON.parse(String(localStorage.getItem('belege.vaults.v1')))[0].vault.id
	);
	expect(vault2).not.toBe(vault1);

	// A passkey added while paused stays in vault 2 alone.
	keys = await openKeys(page);
	await expect(keys.getByTestId('keys-slot')).toHaveCount(1);
	await keys.getByTestId('keys-add-label').fill('Telefon');
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2, { timeout: 30_000 });
	// "Fortsetzen" in the network menu.
	await page.getByTestId('local-only').click();
	await page.getByTestId('network-resume').click();
	await expect(page.getByTestId('local-only')).not.toHaveAttribute('data-state', 'paused');

	// The keys page, opened again, asks Aleph first: vault 1 is taken, B is in it,
	// Telefon only in vault 2. (The test authenticator holds three passkeys at most.)
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Home' }).click();
	keys = await openKeys(page);
	await expect(keys.getByTestId('keys-lost')).toContainText('Telefon', { timeout: 30_000 });
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	await expect(keys.getByTestId('keys-slot').filter({ hasText: 'Telefon' })).toHaveCount(0);
	expect(
		await page.evaluate(() =>
			JSON.parse(String(localStorage.getItem('belege.vaults.v1'))).map(
				(/** @type {any} */ r) => r.vault.id
			)
		)
	).toEqual([vault2, vault1]);

	// Recovery words, kept on Aleph: published into vault 1, not over it.
	await keys.getByTestId('words-start').click();
	await expect(keys.getByTestId('words-word')).toHaveCount(24);
	const words = await keys.getByTestId('words-word').allTextContents();
	await keys.getByTestId('words-written').check();
	await keys.getByTestId('words-next').click();
	const inputs = keys.getByTestId('words-ask-input');
	await expect(inputs).toHaveCount(3);
	const positions = await inputs.evaluateAll((els) =>
		els.map((e) => Number(e.getAttribute('data-position')))
	);
	for (const [i, at] of positions.entries()) await inputs.nth(i).fill(words[at - 1]);
	await expect(keys.getByTestId('words-publish')).toBeChecked();
	await keys.getByTestId('words-confirm').click();
	await expect(keys.getByTestId('words-done')).toContainText('öffnen jetzt die Bücher', {
		timeout: 30_000
	});

	// An empty device with B alone: index M names vault 1, which has B's slot.
	const { credentials } = await cdp.send('WebAuthn.getCredentials', {
		authenticatorId: cdp.authenticatorId
	});
	for (const c of credentials) {
		if (c.credentialId !== /** @type {any} */ (b).credentialId) {
			await cdp.send('WebAuthn.removeCredential', {
				authenticatorId: cdp.authenticatorId,
				credentialId: c.credentialId
			});
		}
	}
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	expect(await books(page)).toEqual(booksOfA);
});

// #555: the vault is kept on Aleph, then the network is paused. A passkey
// added now is added – and said so –, and Aleph is not asked until the pause ends.
test('a passkey added while the network is paused is added, and Aleph is not asked', async ({
	page
}) => {
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const keys = await openKeys(page);
	await keys.getByTestId('keys-add-label').fill('YubiKey');
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-done')).toContainText('öffnet dieselben Bücher', {
		timeout: 30_000
	});

	await page.evaluate(() =>
		localStorage.setItem(
			'belege.network-paused',
			JSON.stringify({ ucep: false, at: '2026-01-01T00:00:00.000Z' })
		)
	);
	const asked = aleph.calls.length;
	await keys.getByTestId('keys-add-label').fill('Telefon');
	await keys.getByTestId('keys-add').click();
	await expect(keys.getByTestId('keys-slot')).toHaveCount(3, { timeout: 30_000 });
	await expect(keys.getByTestId('keys-done')).toContainText('öffnet dieselben Bücher');
	await expect(keys.getByTestId('keys-error')).toHaveCount(0);
	expect(aleph.calls.length).toBe(asked);
});

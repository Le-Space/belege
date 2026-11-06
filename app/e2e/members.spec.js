// A member joins the books (#611): two browsers, two different passkeys. The
// bookkeeping makes a join code; the owner admits it and answers; the answer
// opens on the bookkeeping's device only, and the member is listed on the
// owner's. Made-up names; nothing goes over the network for the joining.
import { test, expect } from '@playwright/test';

import { createHash } from 'node:crypto';

import { memoryKeychain } from '@belege/bridge';
import { alephAccountOf, startFakeAleph } from '@belege/bridge/testing/aleph';
import { runAlephGrants } from '../../bridge/src/setup-aleph.js';
import { acceptConsent } from './consent.js';
import { openBackupAdvanced, openIntegration } from './integrations.js';
import { addVirtualAuthenticator, forgetThisDevice } from './webauthn.js';

/** @param {import('@playwright/test').Browser} browser @param {string} label */
async function person(browser, label) {
	const context = await browser.newContext();
	await context.addInitScript(() => {
		/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
	});
	const page = await context.newPage();
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	return { context, page };
}

test('the bookkeeping joins by a join code, and the owner lists them', async ({ browser }) => {
	test.setTimeout(180_000);
	const owner = await person(browser, 'E2E Inhaber');
	const keeper = await person(browser, 'E2E Buchhaltung');
	try {
		// The bookkeeping: a join code, with its check.
		await openIntegration(keeper.page, 'zusammenarbeit');
		await keeper.page.getByTestId('member-join-name').fill('Buchhaltung Test');
		await keeper.page.getByTestId('member-join-button').click();
		const code = keeper.page.getByTestId('member-join-code');
		await expect(code).toHaveValue(/^belege-join:/);
		const check = String(await keeper.page.getByTestId('member-join-check').textContent());

		// The owner: admitted, the same check, an answer to send back.
		await openIntegration(owner.page, 'zusammenarbeit');
		await expect(owner.page.getByTestId('members-none')).toBeVisible();
		await owner.page.getByTestId('member-admit-name').fill('Buchhaltung Test');
		await owner.page.getByTestId('member-admit-books').fill('Wolkenfabrik Hosting GmbH');
		await owner.page.getByTestId('member-admit-code').fill(await code.inputValue());
		// Nothing written before the check is compared: the same on both screens.
		await owner.page.getByTestId('member-admit-read').click();
		const fingerprint = /[0-9A-F]{4}(-[0-9A-F]{4}){3}/.exec(check)?.[0] ?? 'none';
		await expect(owner.page.getByTestId('member-admit-preview')).toContainText(fingerprint);
		await expect(owner.page.getByTestId('member-admit-button')).toBeDisabled();
		await expect(owner.page.getByTestId('members-none')).toBeVisible();
		await owner.page.getByTestId('member-admit-match').check();
		await owner.page.getByTestId('member-admit-button').click();
		const answer = owner.page.getByTestId('member-answer');
		await expect(answer).toHaveValue(/^belege-member:/);
		const booksCheck = String(
			await owner.page.getByTestId('member-admit-books-check').textContent()
		);
		const booksPrint = /[0-9A-F]{4}(-[0-9A-F]{4}){3}/.exec(booksCheck)?.[0] ?? 'none';
		await expect(owner.page.getByTestId('member')).toContainText('Buchhaltung Test');
		await expect(owner.page.getByTestId('member')).toContainText('Buchhaltung');

		// The bookkeeping: the answer opens here, names the books and shows their
		// check – the owner's – before anything is kept.
		await keeper.page.getByTestId('member-join-answer').fill(await answer.inputValue());
		await keeper.page.getByTestId('member-join-read').click();
		await expect(keeper.page.getByTestId('member-join-books')).toContainText(booksPrint);
		await expect(keeper.page.getByTestId('member-join-books')).toContainText(
			'Wolkenfabrik Hosting GmbH'
		);
		expect(
			await keeper.page.evaluate(() => localStorage.getItem('belege.memberships.v1'))
		).toBeNull();
		await keeper.page.getByTestId('member-join-match').check();
		await keeper.page.getByTestId('member-join-finish').click();
		await expect(keeper.page.getByTestId('member-joined')).toContainText(
			'Wolkenfabrik Hosting GmbH'
		);
		const kept = await keeper.page.evaluate(() => localStorage.getItem('belege.memberships.v1'));
		expect(kept).toContain('Wolkenfabrik Hosting GmbH');
		// Sealed at rest: no address of the owner's books in the clear.
		expect(kept).not.toContain('/orbitdb/');

		// The same answer on another device, with a join code of its own: it does not open there.
		const sent = await answer.inputValue();
		await owner.page.getByTestId('member-join-button').click();
		await owner.page.getByTestId('member-join-answer').fill(sent);
		await owner.page.getByTestId('member-join-read').click();
		await expect(owner.page.getByTestId('members-error')).toContainText('anderen Beitrittscode');
	} finally {
		await owner.context.close();
		await keeper.context.close();
	}
});

/**
 * A person with their own passkey and device sync on, at the local test relay.
 * The PRF answer is set per person (the E2E hook), so the two never share keys.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} label
 * @param {number} seed
 * @param {string} [alephUrl] a fake Aleph in place of the real one (E2E builds only)
 */
async function online(browser, label, seed, alephUrl = '') {
	const context = await browser.newContext();
	await context.addInitScript(
		({ prf, alephUrl }) => {
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
			localStorage.setItem('belege.device-sync', 'on');
			if (alephUrl) localStorage.setItem('belege.e2e.alephUrl', alephUrl);
		},
		{ prf: Array.from({ length: 32 }, (_, i) => (i * 13 + seed) % 256), alephUrl }
	);
	const page = await context.newPage();
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	return { context, page };
}

/** @param {import('@playwright/test').Page} page */
const transactions = (page) =>
	page.evaluate(async () => /** @type {any} */ (window).__belegeE2E.transactions());

test('a member opens the owner’s books and writes as themselves', async ({ browser }) => {
	test.setTimeout(300_000);
	const owner = await online(browser, 'E2E Inhaber', 7);
	const keeper = await online(browser, 'E2E Buchhaltung', 91);
	try {
		// The owner's books hold a booking before the bookkeeping joins.
		await owner.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await owner.page.getByTestId('add-test-transaction').click();
		await expect(owner.page.getByTestId('transaction')).toHaveCount(1);

		// Joining, as in the test above.
		await openIntegration(keeper.page, 'zusammenarbeit');
		await keeper.page.getByTestId('member-join-name').fill('Buchhaltung Test');
		await keeper.page.getByTestId('member-join-button').click();
		const code = await keeper.page.getByTestId('member-join-code').inputValue();
		await openIntegration(owner.page, 'zusammenarbeit');
		await owner.page.getByTestId('member-admit-name').fill('Buchhaltung Test');
		await owner.page.getByTestId('member-admit-books').fill('Wolkenfabrik Hosting GmbH');
		await owner.page.getByTestId('member-admit-code').fill(code);
		await owner.page.getByTestId('member-admit-read').click();
		await owner.page.getByTestId('member-admit-match').check();
		await owner.page.getByTestId('member-admit-button').click();
		const answer = await owner.page.getByTestId('member-answer').inputValue();
		await keeper.page.getByTestId('member-join-answer').fill(answer);
		await keeper.page.getByTestId('member-join-read').click();
		await keeper.page.getByTestId('member-join-match').check();
		await keeper.page.getByTestId('member-join-finish').click();
		await expect(keeper.page.getByTestId('member-joined')).toBeVisible();

		// The bookkeeping opens the owner's books: chosen on the unlock screen.
		await keeper.page.reload();
		await keeper.page.getByTestId('open-books-member').check();
		await keeper.page.getByTestId('passkey-unlock').click();
		await expect(keeper.page.getByTestId('member-books')).toContainText(
			'Wolkenfabrik Hosting GmbH'
		);
		// The owner's booking comes over.
		await expect
			.poll(async () => (await transactions(keeper.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(1);

		// The bookkeeping writes; it shows on the owner's device, with the member as its author.
		await keeper.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await keeper.page.getByTestId('add-test-transaction').click();
		await expect
			.poll(async () => (await transactions(owner.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(2);
		// Written under their write identity, the one the owner's member list shows.
		const writer = /did:key:z[1-9A-HJ-NP-Za-km-z]+/.exec(
			String(await owner.page.getByTestId('member').first().textContent())
		)?.[0];
		expect(writer).toBeTruthy();
		const theirs = (await transactions(owner.page)).find(
			(/** @type {any} */ t) => t.author === writer
		);
		expect(theirs, 'the member’s booking, written under their name').toBeTruthy();
		// The card says when the member was last seen; the device list whose device it is.
		await expect(owner.page.getByTestId('member-last-seen').first()).toContainText(
			'zuletzt gesehen'
		);
		await openIntegration(owner.page, 'geraete');
		await expect(owner.page.getByTestId('devices-item-member').first()).toContainText(
			'Buchhaltung Test'
		);
	} finally {
		await owner.context.close();
		await keeper.context.close();
	}
});

/**
 * Joins `keeper` to the owner's books and opens them there, as in the test above.
 *
 * @param {{ page: import('@playwright/test').Page }} owner
 * @param {{ page: import('@playwright/test').Page }} keeper
 * @param {'bookkeeping' | 'reader'} [role]
 */
async function joinAndOpen(owner, keeper, role = 'bookkeeping') {
	await openIntegration(keeper.page, 'zusammenarbeit');
	await keeper.page.getByTestId('member-join-name').fill('Buchhaltung Test');
	await keeper.page.getByTestId('member-join-button').click();
	const code = await keeper.page.getByTestId('member-join-code').inputValue();
	await openIntegration(owner.page, 'zusammenarbeit');
	await owner.page.getByTestId('member-admit-name').fill('Buchhaltung Test');
	await owner.page.getByTestId('member-admit-books').fill('Wolkenfabrik Hosting GmbH');
	await owner.page.getByTestId('member-admit-code').fill(code);
	await owner.page.getByTestId(`member-role-${role}`).check();
	await owner.page.getByTestId('member-admit-read').click();
	await owner.page.getByTestId('member-admit-match').check();
	await owner.page.getByTestId('member-admit-button').click();
	const answer = await owner.page.getByTestId('member-answer').inputValue();
	await keeper.page.getByTestId('member-join-answer').fill(answer);
	await keeper.page.getByTestId('member-join-read').click();
	await keeper.page.getByTestId('member-join-match').check();
	await keeper.page.getByTestId('member-join-finish').click();
	await expect(keeper.page.getByTestId('member-joined')).toBeVisible();
	await openMemberBooks(keeper.page);
}

/** The unlock screen, the member's books chosen. @param {import('@playwright/test').Page} page */
async function openMemberBooks(page) {
	await page.reload();
	await page.getByTestId('open-books-member').check();
	await page.getByTestId('passkey-unlock').click();
	await expect(page.getByTestId('member-books')).toContainText('Wolkenfabrik Hosting GmbH');
}

test('the bookkeeping backs up, and an empty browser with their passkey restores the books', async ({
	browser
}) => {
	// Two browsers, a fake Aleph, a backup and a restore: on a busy runner the
	// waits for sync and for the restore are generous, not the ones of one device.
	test.setTimeout(720_000);
	const KEY = createHash('sha256').update('belege e2e member backup key').digest('hex');
	const aleph = await startFakeAleph({
		accounts: { [alephAccountOf(KEY)]: { balance: 1_000_000, rows: [] } }
	});
	const owner = await online(browser, 'E2E Inhaber', 7, aleph.url);
	const keeper = await online(browser, 'E2E Buchhaltung', 91, aleph.url);
	try {
		// The owner's books: a booking, and the account their backups are kept for,
		// with this browser's key allowed there.
		await owner.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await owner.page.getByTestId('add-test-transaction').click();
		await expect(owner.page.getByTestId('transaction')).toHaveCount(1);
		await openIntegration(owner.page, 'backup');
		const ownerCard = owner.page.getByTestId('backup-card');
		await ownerCard.getByTestId('backup-owner').fill(alephAccountOf(KEY));
		await ownerCard.getByTestId('backup-owner-save').click();
		const browserKey = /** @type {string} */ (
			await ownerCard.getByTestId('backup-key-address-value').textContent()
		).trim();
		expect(
			await runAlephGrants({
				io: { print: () => {} },
				keychain: memoryKeychain(KEY, 'aleph-backup'),
				action: 'authorize',
				address: browserKey,
				channel: 'BELEGE-BACKUP',
				apiHost: aleph.url,
				settle: { timeout: 5_000, interval: 50 }
			})
		).toBe(true);

		await joinAndOpen(owner, keeper);
		await expect
			.poll(async () => (await transactions(keeper.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(1);

		// The bookkeeping backs up: the books' account, the books' browser key, the books' backup key.
		await openIntegration(keeper.page, 'backup');
		const card = keeper.page.getByTestId('backup-card');
		await openBackupAdvanced(card);
		// The books' account and key come with the settings, which may sync after the bookings.
		await expect(card.getByTestId('backup-address')).toContainText(alephAccountOf(KEY), {
			timeout: 180_000
		});
		await expect(card.getByTestId('backup-granted')).toBeVisible({ timeout: 60_000 });
		const indexesBefore = aleph.kept.size;
		await card.getByTestId('backup-now').click();
		await expect(card.getByTestId('backup-made')).toContainText('von Aleph aufbewahrt', {
			timeout: 120_000
		});
		// The history says who made it.
		await expect(card.getByTestId('backup-row-by').first()).toContainText('Buchhaltung Test');
		// The member vault went to Aleph's index, with no name of the books in the clear.
		await expect.poll(() => aleph.kept.size, { timeout: 120_000 }).toBeGreaterThan(indexesBefore);
		expect(JSON.stringify([...aleph.kept.values()])).not.toContain('Wolkenfabrik');

		// The owner is gone; the bookkeeping's browser loses everything.
		await owner.context.close();
		await forgetThisDevice(keeper.page);
		await keeper.page.goto('/');
		await acceptConsent(keeper.page);
		await keeper.page.getByTestId('passkey-restore').click();
		await expect(keeper.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });

		// Aleph's index gave the membership back: the member's books open, still empty.
		await openMemberBooks(keeper.page);
		expect((await transactions(keeper.page))?.length ?? 0).toBe(0);

		// The pointer named the account: the backup is listed, and comes back.
		await openIntegration(keeper.page, 'backup');
		await openBackupAdvanced(card);
		await expect(card.getByTestId('backup-address')).toContainText(alephAccountOf(KEY), {
			timeout: 60_000
		});
		await expect(card.getByTestId('backup-chain-group')).toHaveCount(1, { timeout: 60_000 });
		await card.getByTestId('backup-restore').click();
		await card.getByTestId('restore-yes').click();
		// The download may fall back from the gateway to IPFS after 15 seconds of silence.
		await expect(card.getByTestId('restore-done')).toContainText('Wiederhergestellt', {
			timeout: 180_000
		});
		await expect(keeper.page.getByTestId('passkey-unlock')).toBeVisible({ timeout: 60_000 });
		await keeper.page.getByTestId('open-books-member').check();
		await keeper.page.getByTestId('passkey-unlock').click();
		await expect(keeper.page.getByTestId('member-books')).toContainText(
			'Wolkenfabrik Hosting GmbH'
		);
		await expect
			.poll(async () => (await transactions(keeper.page))?.length ?? 0, { timeout: 60_000 })
			.toBe(1);
	} finally {
		await owner.context.close().catch(() => {});
		await keeper.context.close();
		await aleph.close();
	}
});

test('a member taken out: their devices leave the list, and what they write after does not arrive', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const owner = await online(browser, 'E2E Inhaber', 7);
	const keeper = await online(browser, 'E2E Buchhaltung', 91);
	try {
		await owner.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await owner.page.getByTestId('add-test-transaction').click();
		await expect(owner.page.getByTestId('transaction')).toHaveCount(1);
		await joinAndOpen(owner, keeper);
		await expect
			.poll(async () => (await transactions(keeper.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(1);
		// Before: what the bookkeeping writes arrives.
		await keeper.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await keeper.page.getByTestId('add-test-transaction').click();
		await expect
			.poll(async () => (await transactions(owner.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(2);

		// The bookkeeping's device is on the owner's list.
		await openIntegration(owner.page, 'geraete');
		await expect(owner.page.getByTestId('devices-item')).not.toHaveCount(0);
		const devicesBefore = await owner.page.getByTestId('devices-item').count();

		// The owner takes the member out; the card says what that does and does not do.
		await openIntegration(owner.page, 'zusammenarbeit');
		const card = owner.page.getByTestId('members-card');
		await card.getByTestId('member-remove').click();
		const confirm = card.getByTestId('member-remove-confirm');
		await expect(confirm).toContainText('bis jetzt geschrieben hat, bleibt');
		await expect(confirm).toContainText('bis die Bücher neue Schlüssel bekommen');
		await confirm.getByTestId('member-remove-yes').click();
		await expect(card.getByTestId('member')).toHaveCount(0);
		await expect(card.getByTestId('members-removed')).toContainText('1 herausgenommen');
		// What they wrote before stays.
		expect((await transactions(owner.page))?.length).toBe(2);
		// Their device is off the owner's list.
		await openIntegration(owner.page, 'geraete');
		await expect(owner.page.getByTestId('devices-item')).toHaveCount(devicesBefore - 1);

		// What the bookkeeping writes now does not arrive.
		await keeper.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await keeper.page.getByTestId('add-test-transaction').click();
		await owner.page.waitForTimeout(20_000);
		expect((await transactions(owner.page))?.length).toBe(2);
	} finally {
		await owner.context.close();
		await keeper.context.close();
	}
});

test('an assistant who only reads sees the owner’s books and writes nothing', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const owner = await online(browser, 'E2E Inhaber', 7);
	const reader = await online(browser, 'E2E Assistenz', 53);
	try {
		await owner.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await owner.page.getByTestId('add-test-transaction').click();
		await expect(owner.page.getByTestId('transaction')).toHaveCount(1);
		await joinAndOpen(owner, reader, 'reader');
		await expect(reader.page.getByTestId('member-books')).toContainText('du liest mit');
		await expect(owner.page.getByTestId('member')).toContainText('Liest mit');
		// The owner's booking comes over …
		await expect
			.poll(async () => (await transactions(reader.page))?.length ?? 0, { timeout: 120_000 })
			.toBe(1);
		// … and writing is refused, with words the person reads.
		const refused = await reader.page.evaluate(() =>
			/** @type {any} */ (window).__belegeE2E
				.addTransaction({
					bookedOn: '2026-10-03',
					counterparty: 'Stromwerk Test AG',
					purpose: 'Probe',
					amountCents: -1
				})
				.then(
					() => '',
					(/** @type {any} */ e) => String(e?.message ?? e)
				)
		);
		expect(refused).toContain('nur zum Lesen');
		await owner.page.waitForTimeout(10_000);
		expect((await transactions(owner.page))?.length).toBe(1);
	} finally {
		await owner.context.close();
		await reader.context.close();
	}
});

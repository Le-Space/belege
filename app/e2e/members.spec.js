// A member joins the books (#611): two browsers, two different passkeys. The
// bookkeeping makes a join code; the owner admits it and answers; the answer
// opens on the bookkeeping's device only, and the member is listed on the
// owner's. Made-up names; nothing goes over the network for the joining.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { addVirtualAuthenticator } from './webauthn.js';

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
		await owner.page.getByTestId('member-admit-button').click();
		const answer = owner.page.getByTestId('member-answer');
		await expect(answer).toHaveValue(/^belege-member:/);
		const fingerprint = /[0-9A-F]{4}(-[0-9A-F]{4}){3}/.exec(check)?.[0] ?? 'none';
		await expect(owner.page.getByTestId('member-admitted')).toContainText(fingerprint);
		await expect(owner.page.getByTestId('member')).toContainText('Buchhaltung Test');
		await expect(owner.page.getByTestId('member')).toContainText('Buchhaltung');

		// The bookkeeping: the answer opens here, and names the books.
		await keeper.page.getByTestId('member-join-answer').fill(await answer.inputValue());
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
		await owner.page.getByTestId('member-join-finish').click();
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
 */
async function online(browser, label, seed) {
	const context = await browser.newContext();
	await context.addInitScript(
		({ prf }) => {
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			/** @type {any} */ (globalThis).__belegeSkipPasskeySteps = true;
			localStorage.setItem('belege.device-sync', 'on');
		},
		{ prf: Array.from({ length: 32 }, (_, i) => (i * 13 + seed) % 256) }
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
		const keeperDid = String(await keeper.page.getByTestId('own-did').getAttribute('data-did'));

		// Joining, as in the test above.
		await openIntegration(keeper.page, 'zusammenarbeit');
		await keeper.page.getByTestId('member-join-name').fill('Buchhaltung Test');
		await keeper.page.getByTestId('member-join-button').click();
		const code = await keeper.page.getByTestId('member-join-code').inputValue();
		await openIntegration(owner.page, 'zusammenarbeit');
		await owner.page.getByTestId('member-admit-name').fill('Buchhaltung Test');
		await owner.page.getByTestId('member-admit-books').fill('Wolkenfabrik Hosting GmbH');
		await owner.page.getByTestId('member-admit-code').fill(code);
		await owner.page.getByTestId('member-admit-button').click();
		const answer = await owner.page.getByTestId('member-answer').inputValue();
		await keeper.page.getByTestId('member-join-answer').fill(answer);
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
		const theirs = (await transactions(owner.page)).find(
			(/** @type {any} */ t) => t.author === keeperDid
		);
		expect(theirs, 'the member’s booking, written under their name').toBeTruthy();
	} finally {
		await owner.context.close();
		await keeper.context.close();
	}
});

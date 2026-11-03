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

// Recovery words, recorded: a passkey makes the books; 24 words are made
// and written down; then the passkey is gone and the browser forgets
// everything — and the words alone, typed on an empty device, make a new
// passkey and open the same books. Every address and amount is made up; the
// Aleph that keeps the vault's index is a fake (@belege/bridge/testing/aleph).
//
// A short clip (about a minute) for the Belege channel and scene 3 of the
// Devcon 8 application video. Narrated from LINES by kit/scene.js.
import { test, expect } from '@playwright/test';
import { startFakeAleph } from '@belege/bridge/testing/aleph';
import { addVirtualAuthenticator, forgetThisDevice } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { startScene } from './kit/scene.js';

const LINES = {
	intro:
		'Le Space Belege keeps your books in the browser, sealed with a passkey. But what if every passkey is gone?',
	passkey: 'A passkey makes the books. Every key they are sealed with is derived from it.',
	offer: 'Right after the books are made, Belege offers recovery words.',
	shown: 'Twenty-four words, drawn at random, shown once. They go on paper, nowhere else.',
	ask: 'Three of them are asked back, so a typo on the paper is caught now, not in an emergency.',
	slot: 'The words are a slot in the books’ vault now, kept sealed on Aleph. Not one word is stored anywhere.',
	lost: 'Now the worst case. The passkey is lost, and this browser forgets everything it had.',
	empty: 'An empty device. No passkey. Only the paper.',
	typed: 'The words, typed as written.',
	back: 'They find the vault on Aleph, make a new passkey, and open the same books: the same identity, the same keys.',
	same: 'The new passkey has its slot beside the old one, and the words still work. With these keys, a backup on Aleph would bring the bookings back as well.',
	outro: 'Recovery words: on paper, and the books survive every lost passkey.'
};

/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
test.beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {} });
});
test.afterAll(async () => {
	await aleph?.close();
});

test('recovery words: the books survive a lost passkey', async ({ page, context }, testInfo) => {
	const scene = await startScene(page, context, LINES);
	await page.addInitScript((url) => localStorage.setItem('belege.e2e.alephUrl', url), aleph.url);
	const cdp = await addVirtualAuthenticator(page);

	await page.goto('/');
	// The first line over the consent screen, not over the page still loading.
	await expect(page.getByTestId('consent-modal')).toBeVisible();
	scene.markStart();
	await scene.say(LINES.intro);
	await acceptConsent(page);

	// A passkey, and bookings from a statement — no bridge needed.
	await scene.type(page.getByTestId('passkey-label'), 'Laptop');
	await scene.click(page.getByRole('button', { name: 'Create passkey' }));
	await expect(page.getByTestId('own-did')).toBeVisible();
	await scene.say(LINES.passkey);

	// The words.
	await expect(page.getByTestId('words-offer')).toBeVisible();
	await scene.say(LINES.offer);
	await scene.click(page.getByTestId('words-offer-go'));
	const keys = page.getByTestId('keys-card');
	await expect(keys.getByTestId('words-none')).toBeVisible();
	await scene.click(keys.getByTestId('words-start'));
	const shown = keys.getByTestId('words-word');
	await expect(shown).toHaveCount(24);
	const words = await shown.allTextContents();
	await scene.say(LINES.shown);
	await scene.click(keys.getByTestId('words-written'));
	await scene.click(keys.getByTestId('words-next'));
	const inputs = keys.getByTestId('words-ask-input');
	await expect(inputs).toHaveCount(3);
	const positions = await inputs.evaluateAll((els) =>
		els.map((e) => Number(e.getAttribute('data-position')))
	);
	await scene.say(LINES.ask, { after: 0 });
	for (let i = 0; i < 3; i++)
		await scene.type(inputs.nth(i), words[positions[i] - 1], { delay: 55 });
	await scene.click(keys.getByTestId('words-confirm'));
	await expect(keys.getByTestId('words-done')).toBeVisible({ timeout: 30_000 });
	await keys.getByTestId('words-done').scrollIntoViewIfNeeded();
	await scene.say(LINES.slot);

	// Every passkey gone, and everything this browser had.
	await scene.say(LINES.lost, { after: 0 });
	const { credentials } = await cdp.send('WebAuthn.getCredentials', {
		authenticatorId: cdp.authenticatorId
	});
	for (const c of credentials) {
		await cdp.send('WebAuthn.removeCredential', {
			authenticatorId: cdp.authenticatorId,
			credentialId: c.credentialId
		});
	}
	await forgetThisDevice(page);
	await page.goto('/');
	await acceptConsent(page);
	await scene.say(LINES.empty);

	// The paper.
	await scene.click(page.getByTestId('words-recover').locator('summary'));
	await scene.say(LINES.typed, { after: 0 });
	await scene.click(page.getByTestId('words-recover-text'), { settle: 100 });
	await page.keyboard.type(words.map((w, i) => `${i + 1}. ${w}`).join('  '), { delay: 18 });
	await scene.type(page.getByTestId('words-recover-label'), 'New phone');
	await scene.click(page.getByTestId('words-recover-go'));
	await scene.say(LINES.back, { after: 0 });
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	await scene.beat(1500);
	await scene.click(page.getByTestId('settings-link'));
	await expect(keys.getByTestId('keys-slot')).toHaveCount(2);
	// The whole card, heading first: both passkeys, then the words below them.
	await keys.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	await scene.beat(600);
	await scene.say(LINES.same);
	await scene.say(LINES.outro);
	await scene.finish(testInfo);
});

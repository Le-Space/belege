// What Le Space Belege is, recorded: a passkey makes the books, "Look around
// first" fills them with made-up sample data, and the tour goes through Home,
// Payments, Receipts, the questions, the monthly export and the keys. No
// bridge, no network: everything the sample set has is in the browser.
//
// The channel's introduction (about 80 s). Narrated from LINES by
// kit/scene.js, in English or, with DEMO_LANG=de, in German.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';
import { startScene } from './kit/scene.js';

const LANG = process.env.DEMO_LANG === 'de' ? 'de' : 'en';

const EN = {
	intro:
		'Le Space Belege is bookkeeping before the bookkeeper: bank payments and receipts, matched only on your own devices. No account, no cloud, no server.',
	passkey: 'A passkey is the identity and the key to the books. Nothing else to sign up for.',
	sample:
		'To look around, Belege fills the books with made-up sample data. One click removes it again.',
	home: 'Home shows what the books hold and what still needs you: coverage, open questions, the month at a glance.',
	payments:
		'Payments come from the bank. A bridge on your computer fetches them, or you upload a statement file. Crypto from an exchange or a wallet is booked in euros at the day’s rate.',
	receipts:
		'Receipts come from the mailbox, from uploads, or from portals. Belege matches each one to its payment and says why.',
	questions: 'What it cannot decide, it asks. Every question points at one payment or one receipt.',
	export:
		'Once a month, one package for the bookkeeper: DATEV bookings, the receipts, and an overview.',
	keys: 'Everything stays only on your devices, sealed with keys derived from your passkey. A second passkey, recovery words and a backup on Aleph keep the books safe.',
	outro:
		'Open source, no subscription, no cloud. Le Space Belege runs only on your devices, at belege dot le-space dot de.'
};

const DE = {
	intro:
		'Le Space Belege ist die Vorbuchhaltung vor dem Steuerbüro: Kontoumsätze und Belege, zusammengeführt nur auf deinen eigenen Geräten. Kein Konto, keine Cloud, kein Server.',
	passkey:
		'Ein Passkey ist die Identität und der Schlüssel zu den Geschäftsbüchern. Nichts sonst muss angelegt werden.',
	sample:
		'Zum Umsehen füllt Belege die Bücher mit erfundenen Beispieldaten. Ein Klick entfernt sie wieder.',
	home: 'Die Startseite zeigt, was in den Geschäftsbüchern steht und was noch dich braucht: Abdeckung, offene Rückfragen, der Monat auf einen Blick.',
	payments:
		'Zahlungen kommen von der Bank. Eine Bridge auf deinem Rechner holt sie, oder du lädst einen Kontoauszug hoch. Krypto von Börse oder Wallet wird in Euro zum Tageskurs gebucht.',
	receipts:
		'Belege kommen aus dem Postfach, per Upload oder aus Portalen. Belege ordnet jeden seiner Zahlung zu und sagt, warum.',
	questions:
		'Was es nicht entscheiden kann, fragt es. Jede Rückfrage zeigt auf eine Zahlung oder einen Beleg.',
	export:
		'Einmal im Monat ein Paket fürs Steuerbüro: DATEV-Buchungen, die Belege und eine Übersicht.',
	keys: 'Alles bleibt nur auf deinen Geräten, versiegelt mit Schlüsseln aus deinem Passkey. Ein zweiter Passkey, Wiederherstellungswörter und ein Backup auf Aleph halten die Geschäftsbücher sicher.',
	outro:
		'Open Source, kein Abo, keine Cloud. Le Space Belege läuft nur auf deinen Geräten, unter belege Punkt le-space Punkt de.'
};

const LINES = LANG === 'de' ? DE : EN;
const CREATE = LANG === 'de' ? 'Passkey anlegen' : 'Create passkey';

test('what Le Space Belege is: a tour through the sample books', async ({
	page,
	context
}, testInfo) => {
	const scene = await startScene(page, context, LINES, { lang: LANG });
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await expect(page.getByTestId('consent-modal')).toBeVisible();
	scene.markStart();
	await scene.say(LINES.intro);
	await acceptConsent(page);

	// The passkey.
	await scene.say(LINES.passkey, { after: 0 });
	await scene.type(page.getByTestId('passkey-label'), 'Laptop');
	await scene.click(page.getByRole('button', { name: CREATE }));
	await expect(page.getByTestId('own-did')).toBeVisible();
	await scene.beat(800);

	// Sample data.
	await scene.say(LINES.sample, { after: 0 });
	await scene.click(page.getByTestId('setup-start-look'));
	await expect(page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });
	await expect(page.getByTestId('coverage-percent')).toBeVisible({ timeout: 60_000 });
	await scene.beat(600);
	await scene.say(LINES.home);

	// Payments.
	await scene.click(page.getByTestId('tab-zahlungen'));
	await expect(page.getByTestId('transaction').first()).toBeVisible();
	await scene.click(page.getByTestId('filter-all'));
	await scene.say(LINES.payments);

	// Receipts.
	await scene.click(page.getByTestId('tab-belege'));
	await expect(page.getByTestId('receipt-vendor').first()).toBeVisible({ timeout: 30_000 });
	await scene.say(LINES.receipts);

	// Questions: through Home's agent card, never by URL — a reload would lock the books.
	await scene.click(page.getByTestId('tab-home'));
	const agent = page.getByTestId('agent-card');
	await expect(agent).toBeVisible({ timeout: 30_000 });
	await agent.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	const toQuestions = page.locator('a[href="/rueckfragen"]').first();
	if (await toQuestions.isVisible().catch(() => false)) {
		await scene.click(toQuestions);
		await expect(
			page.getByTestId('question').or(page.getByTestId('questions-empty')).first()
		).toBeVisible({
			timeout: 30_000
		});
	}
	await scene.say(LINES.questions);

	// Export.
	await scene.click(page.getByTestId('tab-export'));
	await expect(page.getByTestId('export-month-select')).toBeVisible({ timeout: 30_000 });
	await scene.say(LINES.export);

	// Keys.
	await scene.click(page.getByTestId('settings-link'));
	const keys = page.getByTestId('keys-card');
	await expect(keys).toBeVisible({ timeout: 30_000 });
	await keys.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	await scene.say(LINES.keys);

	// Home again, for the close.
	await scene.click(page.getByTestId('tab-home'));
	await expect(page.getByTestId('coverage-percent')).toBeVisible({ timeout: 30_000 });
	await scene.say(LINES.outro);
	await scene.finish(testInfo);
});

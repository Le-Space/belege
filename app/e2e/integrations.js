// Integrationen has an overview and a page per integration (issue #152).
import { expect } from '@playwright/test';

/**
 * Open one integration's page from the overview.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'bridge' | 'bank' | 'ki' | 'kraken' | 'wallets' | 'aleph' | 'geraete' | 'portale' | 'rechnungs-app' | 'assistent'} id
 */
export async function openIntegration(page, id) {
	// Always through the tab: a check of the URL can race a navigation still under way.
	await page.getByTestId('tab-integrationen').click();
	await expect(page).toHaveURL(/\/integrationen\/?$/);
	await page.getByTestId(id === 'bridge' ? 'integration-bridge' : `integration-${id}`).click();
	await expect(page.getByTestId('integration-title')).toBeVisible();
}

/**
 * The device card's "Erweitert", opened if it is not: this device's id and QR
 * code, adding a device, the bridge share and the sync log live there.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openDevicesAdvanced(page) {
	const advanced = page.getByTestId('devices-advanced');
	if (!(await advanced.evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open))) {
		await advanced.locator('summary').first().click();
	}
}

/**
 * The backup card's "Erweitert", opened so that it stays open (#656): account,
 * key, grant, the full backup, the list and its options live there.
 *
 * It opens by itself while something is still to set up – and closes by
 * itself once that is done, e.g. when the books' account arrives by sync. A
 * spec that found it open that way would lose it halfway. So it is opened the
 * way a person keeps it open: chosen, which this browser remembers.
 *
 * The card may open or close by itself between a look and a click, so a
 * click can land on the wrong state. It is retried until the card is open and
 * chosen, with a pause between clicks (toggle events of two quick clicks may
 * merge into one).
 *
 * @param {import('@playwright/test').Locator} card the backup card
 */
export async function openBackupAdvanced(card) {
	const advanced = card.getByTestId('backup-advanced');
	const summary = advanced.locator('summary').first();
	const isOpen = () => advanced.evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open);
	const chosen = () =>
		card.page().evaluate(() => globalThis.localStorage.getItem('belege.backup.advanced'));
	await expect(async () => {
		if (!((await chosen()) === '1' && (await isOpen()))) await summary.click();
		expect(await chosen()).toBe('1');
		expect(await isOpen()).toBe(true);
	}).toPass({ timeout: 30_000, intervals: [700, 1000, 2000] });
}

/**
 * What a restore ends in, seen by the page itself. A restore shows
 * "Wiederhergestellt" (or its error) and reloads the page 2.5 s (4 s) later
 * to open the books again; on a busy runner a polling assertion can miss that
 * window and find only the unlock screen. So the page reports the first
 * `restore-done` or `restore-error` it shows. Call before the restore starts.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<() => Promise<{ kind: 'done' | 'error', text: string }>>} wait for the outcome
 */
export async function watchRestore(page) {
	/** @type {(v: { kind: 'done' | 'error', text: string }) => void} */
	let settle = () => {};
	const outcome = new Promise((resolve) => (settle = resolve));
	await page.exposeFunction(
		'__e2eRestoreOutcome',
		(/** @type {string} */ kind, /** @type {string} */ text) =>
			settle({ kind: kind === 'done' ? 'done' : 'error', text })
	);
	await page.evaluate(() => {
		const w = /** @type {any} */ (globalThis);
		const look = () => {
			for (const kind of ['done', 'error']) {
				const el = document.querySelector(`[data-testid="restore-${kind}"]`);
				if (el) {
					observer.disconnect();
					w.__e2eRestoreOutcome(kind, el.textContent ?? '');
					return;
				}
			}
		};
		const observer = new MutationObserver(look);
		observer.observe(document.body, { subtree: true, childList: true, characterData: true });
		look();
	});
	return () =>
		Promise.race([
			outcome,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('the restore showed neither done nor an error')), 180_000)
			)
		]);
}

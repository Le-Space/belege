// The relay closes its circuit beside a direct connection (#393): two devices
// that met through the relay gossip over the relay's circuit, also once WebRTC
// connects them directly. When the circuit goes – its duration, its data cap –
// gossipsub's streams go with it, and nothing told it to open new ones on the
// connection that is left: the devices looked connected and replicated
// nothing. Here the circuit is closed under two devices that sit on a direct
// connection, and a booking written afterwards has to arrive, both ways, well
// before the redial round's last resort (hang up after 45 s) could have
// helped. Made-up data.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

/** @param {import('@playwright/test').Page} page */
const count = (page) =>
	page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.count('transactions'));

/** @param {import('@playwright/test').Page} page @param {string} sourceId */
const book = (page, sourceId) =>
	page.evaluate(
		(id) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				source: 'hibiscus',
				sourceId: id,
				bookedOn: '2026-03-02',
				valueDate: '2026-03-02',
				amountCents: -1234,
				currency: 'EUR',
				counterparty: 'Wolkenfabrik Hosting GmbH',
				purpose: 'Probe',
				deleted: false
			}),
		sourceId
	);

/** The connections to `peer`, as the page's node has them. @param {import('@playwright/test').Page} page @param {string} peer */
const linksTo = async (page, peer) =>
	(await page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.connections())).filter(
		(/** @type {any} */ c) => c.peer === peer
	);

const relayed = (/** @type {any} */ c) => /\/p2p-circuit\/p2p\//.test(c.addr);
const gossiping = (/** @type {any} */ c) =>
	c.streams.some((/** @type {string} */ p) => p.startsWith('/meshsub/'));

test('a booking still arrives after the relay closed its circuit beside a direct connection', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	const phone = await device(browser);
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Circuit');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		// A booking the Mac has before the phone ever connects.
		await book(mac.page, 'before-1');
		await samePasskey(mac, phone, did);

		// Connected, as device-sync.spec.js does it: the Mac's id scanned on the phone.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await mac.page.getByTestId('devices-qr-toggle').click();
		const code = String(await mac.page.getByTestId('devices-qr').getAttribute('data-code'));
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, code);
		const macId = await mac.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.peerId());
		const phoneId = await phone.page.evaluate(() =>
			/** @type {any} */ (window).__belegeE2E.peerId()
		);

		// Both directly connected, and in step: the booking the Mac had before
		// they met has come over.
		await expect
			.poll(async () => (await linksTo(mac.page, phoneId)).some((c) => !relayed(c)), {
				timeout: 60_000
			})
			.toBe(true);
		await expect.poll(() => count(phone.page), { timeout: 60_000 }).toBe(1);

		// The relay closes the circuit; the direct connection stays.
		await mac.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.bench.closeRelayed());
		await expect
			.poll(async () => (await linksTo(mac.page, phoneId)).filter(relayed).length)
			.toBe(0);
		expect((await linksTo(mac.page, phoneId)).length).toBeGreaterThan(0);
		expect((await linksTo(phone.page, macId)).length).toBeGreaterThan(0);

		// gossipsub is put on what is left, on both devices, without a new connection …
		for (const [page, peer] of /** @type {const} */ ([
			[mac.page, phoneId],
			[phone.page, macId]
		])) {
			await expect
				.poll(async () => (await linksTo(page, peer)).some(gossiping), { timeout: 15_000 })
				.toBe(true);
		}
		// … and what is written now arrives, both ways.
		await book(mac.page, 'after-mac');
		await expect.poll(() => count(phone.page), { timeout: 15_000 }).toBe(2);
		await book(phone.page, 'after-phone');
		await expect.poll(() => count(mac.page), { timeout: 15_000 }).toBe(3);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

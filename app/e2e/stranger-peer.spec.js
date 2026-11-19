// A stranger against the real stack (audit plan #209, the central test of
// #537): a device of the books is at the relay, and a node with a key of its
// own and no device proof tries everything a device does. It gets identify
// and the relay protocols – nothing of the books: no protocol of the device
// opens for it, before or after a made-up proof; gossipsub tells it nothing;
// bitswap hands it no block, not even a database's manifest.
//
// Through the relay, in the modes that listen at one ("public" and "Beides").
// In the mode "Ohne Relay, per QR" a device has no address at all: the
// stranger cannot reach it. A direct connection between browsers is WebRTC,
// set up over a signalling protocol on the relayed connection – which the
// stranger is refused like every other, so it never gets that far.
import { test, expect } from '@playwright/test';

import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';
import { relayAddr } from './relay.js';
import { startStranger } from './stranger.js';

/** What a stranger may be told: identify, the relay protocols and the offer of the proof. */
const OPEN = /^\/(ipfs\/id\/|libp2p\/circuit\/relay\/|belege\/device-proof\/)/;
/** What identify tells a stranger: not even that the device asks for a proof. */
const TOLD = /^\/(ipfs\/id\/|libp2p\/circuit\/relay\/)/;

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

/** @param {import('@playwright/test').Page} page */
const facts = (page) =>
	page.evaluate(() => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return {
			protocols: /** @type {string[]} */ (e2e.protocols()),
			addresses: /** @type {Record<string, string>} */ (e2e.addresses())
		};
	});

/**
 * A device with a booking, at the relay.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {'public' | 'both'} mode
 */
async function deviceAtRelay(browser, mode) {
	const mac = await device(browser, { mode });
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E Fremder');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await tab(mac.page, 'Zahlungen');
	await mac.page.getByTestId('add-test-transaction').click();
	await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
	return { mac, macId };
}

for (const mode of /** @type {const} */ (['public', 'both'])) {
	test(`a stranger at the relay gets identify and nothing of the books (mode ${mode})`, async ({
		browser
	}) => {
		test.setTimeout(180_000);
		const { mac, macId } = await deviceAtRelay(browser, mode);
		const stranger = await startStranger(await relayAddr());
		try {
			const { protocols, addresses } = await facts(mac.page);
			// The device does speak what the stranger is about to ask for: gossipsub,
			// bitswap, OrbitDB's heads exchange for each database, WebRTC signalling.
			const closed = protocols.filter((p) => !OPEN.test(p));
			for (const speaks of [
				/^\/meshsub\//,
				/^\/ipfs\/bitswap\//,
				/^\/orbitdb\/heads\//,
				/^\/webrtc-signaling\//
			]) {
				expect(
					closed.some((p) => speaks.test(p)),
					String(speaks)
				).toBe(true);
			}

			// It may connect: a relay hands a circuit to anybody.
			const connection = await stranger.connect(macId);
			// Identify: no protocol of the books, and no browser or system.
			const told = await stranger.told(connection);
			console.log('identify told the stranger:', JSON.stringify(told));
			expect(told).not.toBeNull();
			expect(told?.protocols.filter((p) => !TOLD.test(p))).toEqual([]);
			expect(told?.agent).toBe('js-libp2p');
			// Every protocol the device registered, tried by name.
			// All at once: each stream is held for the proof, then aborted.
			const tryAll = async (/** @type {any} */ on) =>
				(
					await Promise.all(
						closed.map(async (p) => /** @type {const} */ ([p, await stranger.tryProtocol(on, p)]))
					)
				).filter(([, outcome]) => outcome !== 'refused');
			// The control: identify is open, and the same probe gets its answer.
			expect(await stranger.tryProtocol(connection, '/ipfs/id/1.0.0')).toBe('answered');
			console.log(`trying ${closed.length} protocols as a stranger`);
			expect(await tryAll(connection)).toEqual([]);
			// A proof made up: refused, and nothing opens afterwards either.
			await stranger.tryProtocol(
				connection,
				'/belege/device-proof/1.0.0',
				crypto.getRandomValues(new Uint8Array(34))
			);
			expect(await tryAll(await stranger.connect(macId)), 'after a false proof').toEqual([]);

			// Gossipsub: subscribed to every database's topic, as a device is.
			const topics = Object.values(addresses);
			stranger.subscribe(topics);
			// Bitswap: a database's manifest – public by design, and still not handed out.
			const manifest = topics[0].replace(/^\/orbitdb\//, '');
			expect(await stranger.wants(manifest), 'a block over bitswap').toBe(false);

			// The device writes on: the stranger hears nothing of it, and nobody
			// tells it who subscribes to the books.
			await tab(mac.page, 'Zahlungen');
			await mac.page.getByTestId('add-test-transaction').click();
			await expect(mac.page.getByTestId('transaction')).toHaveCount(2);
			await mac.page.waitForTimeout(5_000);
			expect(stranger.heard).toEqual([]);
			for (const topic of topics) expect(stranger.subscribers(topic)).toEqual([]);
			// The device is still at the relay, its books as they were.
			await expect(mac.page.getByTestId('transaction')).toHaveCount(2);
		} finally {
			await stranger.stop();
			await mac.context.close();
		}
	});
}

test('without a relay ("per QR") a stranger has no address to reach a device at', async ({
	browser
}) => {
	const mac = await device(browser, { mode: 'qr' });
	const stranger = await startStranger(await relayAddr());
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Fremder QR');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const macId = await mac.page.evaluate(() =>
			String(/** @type {any} */ (window).__belegeE2E.peerId())
		);
		expect(macId).toMatch(/^12D3KooW/);
		// It holds no place at the relay, so the relay has nobody to hand the stranger to.
		await expect(stranger.connect(macId)).rejects.toThrow();
	} finally {
		await stranger.stop();
		await mac.context.close();
	}
});

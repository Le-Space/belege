// The bridge's own node (#573, #575): a device of the books reaches the bridge
// over the stream, with no HTTP to 127.0.0.1 at all. The real bridge runs in
// test mode with a fake LLM and prints its invitation; the device (one
// browser context, device sync on, through the local test relay) pairs by
// that invitation, hands the books' device key over, and from then on the
// bridge is a device of the books: listed under Geräte as connected, and the
// bridge's status comes over the stream while every HTTP request to the
// bridge is refused. Made-up passkey; nothing is real.
import { test, expect } from '@playwright/test';

import { defaultConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { acceptConsent } from './consent.js';
import { openDevicesAdvanced, openIntegration } from './integrations.js';
import { device } from './devices.js';
import { startBridge } from './bridge-process.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	llm = await startFakeLlm();
	bridge = await startBridge({
		name: 'bridge-node',
		config: {
			llm: {
				...defaultConfig().llm,
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				baseUrl: llm.url,
				configured: true
			}
		},
		env: { BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY },
		ready: /web\+ucep:pair\?\S+/
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await llm?.close();
});

test('a device pairs the bridge’s node by invitation and reaches it over the stream, with HTTP refused', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	/** @type {string[]} */
	const blocked = [];
	// No HTTP to the bridge at all: what a phone sees, and what the stream must carry.
	await mac.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
		blocked.push(new URL(route.request().url()).pathname);
		return route.abort('connectionrefused');
	});
	/** @type {string[]} */
	const console = [];
	mac.page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') console.push(m.text().slice(0, 300));
	});
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Bridge-Knoten');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);

		// The invitation from the bridge's console, pasted into the Bridge card.
		const invitation = /(web\+ucep:pair\?\S+)/.exec(bridge.out())?.[1] ?? '';
		expect(invitation).not.toBe('');
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('bridge-invitation').fill(invitation);
		await mac.page.getByTestId('bridge-pair-invitation').click();
		const status = mac.page.getByTestId('bridge-status');
		// Paired – or the card's error, named, instead of a silent timeout.
		await expect
			.poll(
				async () => {
					const error = mac.page.getByTestId('bridge-error');
					if (await error.isVisible())
						throw new Error(`pairing failed: ${await error.textContent()}`);
					return status.getAttribute('data-paired');
				},
				{ timeout: 90_000, intervals: [1_000] }
			)
			.toBe('true');
		// The bridge took the key and came back armed.
		await expect.poll(() => bridge.out(), { timeout: 30_000 }).toMatch(/node is armed/);
		// Its status comes over the stream; "Status prüfen" asks again until the node is proved.
		await expect
			.poll(
				async () => {
					const route = `${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
					if (route !== 'online/stream') await mac.page.getByTestId('bridge-check').click();
					return route;
				},
				{ timeout: 90_000, intervals: [2_000] }
			)
			.toBe('online/stream');
		await expect(status).toContainText('über ihren eigenen Knoten');
		await expect(mac.page.getByTestId('bridge-via-stream')).toBeVisible();
		// Once the node is there, nothing tries HTTP any more: "Status prüfen" goes over the stream.
		blocked.length = 0;
		await mac.page.getByTestId('bridge-check').click();
		await expect(status).toHaveAttribute('data-route', 'stream');
		await expect(status).toHaveAttribute('data-state', 'online');
		expect(blocked).toEqual([]);

		// The bridge is a device of the books, connected.
		await openIntegration(mac.page, 'geraete');
		await expect(
			mac.page
				.getByTestId('devices-item')
				.filter({ hasText: 'Bridge' })
				.getByTestId('devices-item-state')
		).toContainText('verbunden', { timeout: 60_000 });

		// What this device called at the bridge (#579): by command, how often – no content.
		await openDevicesAdvanced(mac.page);
		const mine = mac.page.getByTestId('bridge-access-device').filter({ hasText: 'Dieses Gerät' });
		await mine.getByTestId('bridge-access-usage-total').click();
		await expect(mine.getByTestId('bridge-access-usage-total')).toContainText(/Aufrufe: [1-9]/, {
			timeout: 60_000
		});
		await expect(
			mine.locator('[data-testid="bridge-access-usage-item"][data-command="bridge.health"]')
		).toContainText(/[1-9]\d*× erlaubt/);

		// "Kopplung lösen": the bridge forgets its key over the stream and offers a new invitation;
		// the books move on to the next generation of the bridge's key.
		const invitationsBefore = (bridge.out().match(/web\+ucep:pair\?/g) ?? []).length;
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('unpair').click();
		await expect(mac.page.getByTestId('bridge-invitation')).toBeVisible();
		await expect.poll(() => bridge.out(), { timeout: 30_000 }).toMatch(/Unpaired by a device/);
		await expect
			.poll(() => (bridge.out().match(/web\+ucep:pair\?/g) ?? []).length, { timeout: 30_000 })
			.toBeGreaterThan(invitationsBefore);
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-item').filter({ hasText: 'Bridge' })).toHaveCount(0);
	} catch (error) {
		console.length && test.info().attach('console', { body: console.join('\n') });
		throw error;
	} finally {
		await mac.context.close();
	}
});

// Own devices meet at the relay in the own bridge (issue #148, step 2c): the
// real bridge in test mode runs its LAN relay on 127.0.0.1 (a phone would
// reach this Mac's address in the Wi-Fi). The Mac pairs the bridge, learns
// the relay's address from it, and chooses "Nur im eigenen Netz"; after the
// next unlock both devices meet there over WebRTC-Direct, connect directly,
// and sync. From then on nothing asks Aleph and no WebSocket opens (no
// public relay): checked on every request and WebSocket of both contexts.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device, samePasskey } from './devices.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const LAN_RELAY_PORT = 4998;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-device-lan-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			lanRelay: { host: '127.0.0.1', port: LAN_RELAY_PORT }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 20_000 }).toMatch(/Pairing code/);
	expect(bridgeOut).toContain(`LAN relay for own devices on 127.0.0.1, UDP ${LAN_RELAY_PORT}`);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	if (dir) await rm(dir, { recursive: true, force: true });
});

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('two devices meet at the relay in the own bridge, and sync', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	/** @type {string[]} */
	const outside = [];
	let watching = false;
	// This machine's page and bridge do not count; the relay is UDP, no request at all.
	const local = (/** @type {string} */ url) =>
		/^(data|blob):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
	/** @param {Awaited<ReturnType<typeof device>>} d */
	const watch = (d) => {
		d.context.on('request', (r) => {
			if (watching && !local(r.url())) outside.push(r.url());
		});
		d.page.on('websocket', (ws) => {
			if (watching) outside.push(`websocket ${ws.url()}`);
		});
	};
	watch(mac);
	let phone;
	try {
		// The Mac: a passkey, a booking, the bridge paired.
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Geräte LAN');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await tab(mac.page, 'Zahlungen');
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
		await tab(mac.page, 'Integrationen');
		const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
		await mac.page.getByTestId('pairing-code').fill(code);
		await mac.page.getByRole('button', { name: 'Koppeln' }).click();
		await expect(mac.page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

		// The relay's address came from the bridge: "Nur im eigenen Netz" can be chosen.
		const badge = mac.page.getByTestId('local-only');
		await badge.click();
		await expect(mac.page.getByTestId('network-mode-lan')).toBeEnabled({ timeout: 30_000 });
		await mac.page.getByTestId('network-mode-lan').check();
		await expect(mac.page.getByTestId('network-mode-pending')).toBeVisible();
		const relay = String(await mac.page.evaluate(() => localStorage.getItem('belege.lan-relay')));
		expect(relay).toMatch(
			new RegExp(`^/ip4/127\\.0\\.0\\.1/udp/${LAN_RELAY_PORT}/webrtc-direct/certhash/`)
		);

		// From the next unlock on, in the own network only.
		watching = true;
		await mac.page.reload();
		await mac.page.getByTestId('passkey-unlock').click();
		await expect(mac.page.getByTestId('own-did')).toHaveAttribute('data-did', did);

		// The phone learned mode and address from the books before (by QR, say).
		phone = await device(browser, { mode: 'lan', lanRelay: relay });
		watch(phone);
		await samePasskey(mac, phone, did);

		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-add-input').fill(macId);
		await phone.page.getByTestId('devices-add').click();
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toHaveText('verbunden · direkt', { timeout: 60_000 });

		// The books sync, both ways.
		await tab(phone.page, 'Zahlungen');
		await expect(phone.page.getByTestId('transaction')).toHaveCount(1, { timeout: 90_000 });
		await phone.page.getByTestId('add-test-transaction').click();
		await tab(mac.page, 'Zahlungen');
		await expect(mac.page.getByTestId('transaction')).toHaveCount(2, { timeout: 90_000 });

		// Nobody else was asked: no Aleph, no public relay, no WebSocket at all.
		expect(outside).toEqual([]);
	} finally {
		await mac.context.close();
		await phone?.context.close();
	}
});

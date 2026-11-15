// The bridge on this machine over a stream, with device sync off (#580): the
// device pairs by the code over HTTP, as it always did; the app then fetches
// the node's invitation (`node.invite`) and pairs the bridge's node over a
// WebSocket on 127.0.0.1 – no relay, device sync stays off. From then on every
// call goes over that stream: with every HTTP request to the bridge refused,
// the card's status still comes, and over the stream. Made-up passkey;
// nothing is real.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { viaStream, stopBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.skip(viaStream, 'device sync off is what this spec is about');

test.beforeAll(async () => {
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-bridge-loopback-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 20_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	await stopBridge(bridge);
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('paired by code, device sync off: the bridge’s node is paired over 127.0.0.1 and every call goes over the stream', async ({
	page
}) => {
	test.setTimeout(180_000);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Bridge lokal');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await openIntegration(page, 'bridge');
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	expect(code).not.toBe('');
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln', exact: true }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	// The app paired the node by its invitation, over this machine: it came back armed.
	await expect.poll(() => bridgeOut, { timeout: 60_000 }).toMatch(/node is armed/);

	// From now on no HTTP to the bridge at all.
	/** @type {string[]} */
	const blocked = [];
	await page.context().route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
		blocked.push(new URL(route.request().url()).pathname);
		return route.abort('connectionrefused');
	});
	const status = page.getByTestId('bridge-status');
	await expect
		.poll(
			async () => {
				const route = `${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
				if (route !== 'online/stream') await page.getByTestId('bridge-check').click();
				return route;
			},
			{ timeout: 90_000, intervals: [2_000] }
		)
		.toBe('online/stream');
	blocked.length = 0;
	await page.getByTestId('bridge-check').click();
	await expect(status).toHaveAttribute('data-route', 'stream');
	await expect(status).toHaveAttribute('data-state', 'online');
	expect(blocked).toEqual([]);

	// Device sync stayed off: the books' node went nowhere.
	await openIntegration(page, 'geraete');
	await expect(page.getByTestId('devices-reachable')).toHaveCount(0);
});

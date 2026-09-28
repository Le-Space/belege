// A phone uses the desktop's bridge over UCEP (issue #142): two browser
// contexts of one passkey (as in device-sync.spec.js), the real bridge in
// test mode with a fake LLM. The "Mac" is paired with the bridge and serves
// it to own devices; the "phone" may not reach 127.0.0.1 (the requests are
// aborted, as a phone cannot), so its bridge client goes through the Mac:
// the status says paired and the model the bridge uses shows. The phone's
// own token is never sent; the Mac's stays on the Mac.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const AUTHENTICATOR = {
	protocol: 'ctap2',
	ctap2Version: 'ctap2_1',
	transport: 'internal',
	hasResidentKey: true,
	hasUserVerification: true,
	isUserVerified: true,
	hasLargeBlob: true,
	hasPrf: true,
	automaticPresenceSimulation: true
};
// Made up: the answer one synced passkey gives on both devices (see device-sync.spec.js).
const PRF = Array.from({ length: 32 }, (_, i) => (i * 41 + 7) % 256);

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-device-bridge-'));
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
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{ share?: boolean, noBridge?: boolean }} how
 */
async function device(browser, { share = false, noBridge = false }) {
	const context = await browser.newContext();
	await context.addInitScript(
		({ prf, share }) => {
			/** @type {any} */ (globalThis).__belegeTestPrf = prf;
			localStorage.setItem('belege.device-sync', 'on');
			if (share) localStorage.setItem('belege.bridge-share', 'on');
		},
		{ prf: PRF, share }
	);
	/** @type {string[]} */
	const blocked = [];
	if (noBridge) {
		// A phone cannot reach the Mac's 127.0.0.1.
		await context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
			blocked.push(new URL(route.request().url()).pathname);
			return route.abort('connectionrefused');
		});
	}
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: AUTHENTICATOR
	});
	return { context, page, cdp, authenticatorId, blocked };
}

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

test('the phone reaches the bridge through the desktop', async ({ browser }) => {
	test.setTimeout(240_000);
	const mac = await device(browser, { share: true });
	const phone = await device(browser, { noBridge: true });
	try {
		// The Mac: passkey, then the bridge paired; its bridge is served from the next unlock on.
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Bridge');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = await mac.page.getByTestId('own-did').getAttribute('data-did');
		await tab(mac.page, 'Integrationen');
		const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
		await mac.page.getByTestId('pairing-code').fill(code);
		await mac.page.getByRole('button', { name: 'Koppeln' }).click();
		await expect(mac.page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
		await expect(mac.page.getByTestId('devices-bridge-served')).toBeVisible({ timeout: 30_000 });

		// The phone: the same passkey (see device-sync.spec.js for why it is copied so).
		const { credentials } = await mac.cdp.send('WebAuthn.getCredentials', {
			authenticatorId: mac.authenticatorId
		});
		await phone.cdp.send('WebAuthn.addCredential', {
			authenticatorId: phone.authenticatorId,
			credential: credentials[0]
		});
		const stored = await mac.page.evaluate(() => {
			/** @type {Record<string, string>} */
			const kept = {};
			for (let i = 0; i < localStorage.length; i++) {
				const k = String(localStorage.key(i));
				if (k === 'belege.webauthnCredential' || k.startsWith('webauthn-identity-proof:')) {
					kept[k] = String(localStorage.getItem(k));
				}
			}
			return kept;
		});
		await phone.page.goto('/robots.txt');
		await phone.page.evaluate((kept) => {
			for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
		}, stored);
		await phone.page.goto('/');
		await acceptConsent(phone.page);
		await phone.page.getByTestId('passkey-unlock').click();
		await expect(phone.page.getByTestId('own-did')).toHaveAttribute('data-did', String(did));

		// The devices meet: the Mac's id on the phone.
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
		await tab(phone.page, 'Integrationen');
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
		).toContainText('verbunden', { timeout: 60_000 });

		// The pairing replicated to the phone; its calls go through the Mac.
		await expect
			.poll(
				async () => {
					// The page reads the pairing when it opens: opened anew until it has replicated.
					await tab(phone.page, 'Home');
					await tab(phone.page, 'Integrationen');
					const status = phone.page.getByTestId('bridge-status');
					await expect(status).not.toHaveAttribute('data-state', 'checking', { timeout: 70_000 });
					return status.textContent();
				},
				{ timeout: 90_000, intervals: [2_000] }
			)
			.toContain('dieses Gerät ist gekoppelt');
		expect(phone.blocked).toContain('/health');
		// The model the bridge uses, asked through the Mac (GET /llm/status, with the Mac's token).
		await tab(phone.page, 'Home');
		await tab(phone.page, 'Integrationen');
		await expect(phone.page.getByTestId('ki-status')).toBeVisible({ timeout: 60_000 });
		expect(bridgeOut).not.toMatch(/unauthori[sz]ed/i);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});

// A language-model provider that refuses (#417): the fake LLM out of credit,
// the real bridge in test mode, and the app. "Alle neuen auslesen" stops after
// the first receipt, says why and what to do, marks no receipt as failed, and
// Home offers to continue the rest. All receipts made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	// Both models out of credit, as DeepSeek answers then.
	llm = await startFakeLlm({
		behaviour: { 'deepseek-flash': 'http402', 'deepseek-v4-pro': 'http402' }
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-refusal-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			hibiscus: {
				host: hibiscus.host,
				port: hibiscus.port,
				certSha256: hibiscus.fingerprint,
				ibanSuffixes: ['4711']
			},
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				configured: true
			}
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	if (bridge && bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await llm?.close();
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('no credit with the provider stops the run and says what to do', async ({ page }) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Guthaben');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	// Three receipts waiting to be read: mail texts without a file.
	await page.evaluate(async () => {
		const hooks = /** @type {any} */ (window).__belegeE2E;
		for (const n of [1, 2, 3]) {
			await hooks.addReceipt({
				source: 'upload',
				sourceRef: `upload:refusal-${n}`,
				subject: `Rechnung ${n}`,
				excerpt: `Anbieter: Beispiel Hosting GmbH\nSumme: ${n}0,00 EUR`,
				mime: 'text/plain',
				fileCid: null,
				status: 'neu',
				receivedAt: '2026-09-0' + n
			});
		}
	});

	await tab('Belege').click();
	const before = llm.requests.length;
	await page.getByTestId('extract-all').click();
	const stopped = page.getByTestId('extract-stopped');
	await expect(stopped).toHaveText(
		'Das Guthaben bei KI-Anbieter ist aufgebraucht. Lade es beim Anbieter auf, dann „Weitermachen“ auf Home.'.replace(
			'KI-Anbieter',
			new URL(llm.url).host
		)
	);
	// No second model after a 402, and no receipt beyond those already in flight
	// (two workers by default): the third is never sent.
	const asked = llm.requests.slice(before);
	expect(asked.length).toBeLessThanOrEqual(2);
	expect(asked.every((r) => r.model === 'deepseek-flash')).toBe(true);
	await expect(page.getByTestId('extract-note')).toHaveCount(0);
	expect(bridgeOut).toMatch(
		/LLM_NO_CREDIT: the provider's credit is used up \(deepseek-flash: HTTP 402/
	);

	// Home: the three are kept for later, with the reason.
	await tab('Home').click();
	await expect(page.getByTestId('resume-extract')).toContainText('3 Belege');
	await expect(page.getByTestId('resume-extract-why')).toContainText('aufgebraucht');
});

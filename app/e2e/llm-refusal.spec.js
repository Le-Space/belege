// A language-model provider that refuses (#417): the fake LLM out of credit,
// the real bridge in test mode, and the app. "Alle neuen auslesen" stops after
// the first receipt, says why and what to do, marks no receipt as failed, and
// Home offers to continue the rest. All receipts made up.
import { test, expect } from '@playwright/test';

import { defaultConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	// Both models out of credit, as DeepSeek answers then.
	llm = await startFakeLlm({
		behaviour: { 'deepseek-flash': 'http402', 'deepseek-v4-pro': 'http402' }
	});
	bridge = await startBridge({
		name: 'refusal',
		config: {
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
				// Told setup:llm it runs here: nothing blacked out (#423).
				redaction: 'off',
				configured: true
			}
		},
		env: { BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD, BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await llm?.close();
	await hibiscus?.close();
});

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
	await pairBridge(page, bridge);

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
	// The fake model is on 127.0.0.1, said to run here: nothing blacked out (#423), and the hint says so (#431).
	await expect(page.getByTestId('extract-all')).toHaveAttribute('title', /Ungeschwärzt/);
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
	expect(bridge.out()).toMatch(
		/LLM_NO_CREDIT: the provider's credit is used up \(deepseek-flash: HTTP 402/
	);

	// Home: the three are kept for later, with the reason.
	await tab('Home').click();
	await expect(page.getByTestId('resume-extract')).toContainText('3 Belege');
	await expect(page.getByTestId('resume-extract-why')).toContainText('aufgebraucht');
});

// "✦ Konto vorschlagen" (POST /booking/assist): the real bridge in test mode,
// the fake LLM and the app. A chart is read in, the model is asked for the
// account of a payment, names one from the chart with a reason, and "Einsetzen"
// puts it in the field – nothing is taken by itself. The model is not on this
// machine as far as the bridge knows, so the IBAN in the purpose is blacked
// out in what was sent. All data made up.
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
import { pairBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const IBAN = 'DE00 1234 5678 9012 3456 78';

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	llm = await startFakeLlm();
	llm.answers.respond = (body) =>
		String(body.messages?.[0]?.content ?? '').includes('contra account (Gegenkonto)')
			? {
					picks: [{ account: '4964', confidence: 'high', reason: 'Monatliches Software-Abo.' }]
				}
			: undefined;
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-booking-ai-'));
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
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
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

test('the model suggests an account from the chart; the person puts it in', async ({ page }) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Konto-KI');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await pairBridge(page, { code: pairingCode, out: () => bridgeOut });

	await page.getByTestId('settings-link').click();
	const chart = page.getByTestId('chart');
	await chart.getByTestId('chart-file').setInputFiles({
		name: 'kontenplan.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'Konto;Bezeichnung\n1200;Bank Konto A\n4930;Bürobedarf\n4964;Software-Abos\n'
		)
	});
	await chart.getByTestId('chart-take').click();
	await expect(chart.getByTestId('chart-current')).toContainText('3 Konten');

	await page.evaluate(
		(iban) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-10-13',
				counterparty: 'Wolkenfabrik Hosting GmbH',
				purpose: `Abo Oktober ${iban}`,
				amountCents: -1234
			}),
		IBAN
	);
	await tab('Zahlungen').click();
	await page.getByText('Wolkenfabrik Hosting GmbH').first().click();
	const booking = page.getByTestId('tx-booking');
	await expect(booking.getByTestId('tx-booking-suggestion')).toContainText('Kein Vorschlag');

	await booking.getByTestId('tx-booking-ai-ask').click();
	const picks = booking.getByTestId('tx-booking-ai-picks');
	await expect(picks).toContainText('4964 Software-Abos');
	await expect(picks).toContainText('sicher – Monatliches Software-Abo.');
	// Nothing taken by itself.
	await expect(booking).toHaveAttribute('data-confirmed', 'false');
	await expect(booking.getByTestId('tx-booking-account')).toHaveValue('');

	await booking.getByTestId('tx-booking-ai-take').click();
	await expect(booking.getByTestId('tx-booking-account')).toHaveValue('4964');
	await expect(booking.getByTestId('tx-booking-account-name')).toHaveText('Software-Abos');

	const sent = booking.getByTestId('tx-booking-ai-sent');
	await sent.locator('summary').click();
	await expect(sent).toContainText('4964: Software-Abos');
	await expect(sent).toContainText('Wolkenfabrik Hosting GmbH');
	await expect(sent).not.toContainText(IBAN);
});

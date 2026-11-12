// "✦ Reise prüfen" (#693 d), end to end: a trip by bus to Ortshausen and
// back with no lodging for its night, a model on this machine (a fake one on
// 127.0.0.1, redaction off). The button is there, the trip goes to the model
// through the real bridge in test mode, its notes come back naming the
// receipts, one is dismissed – and nothing on the trip changed. Towns and
// vendors are made up.
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
import { pairBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	// Two notes: one naming the outbound bus (L1) and a name never sent (R9).
	llm.answers.respond = (body) =>
		String(body.messages[0].content).startsWith('You help check one business trip')
			? {
					notes: [
						{ text: 'Für die Nacht in Ortshausen fehlt eine Unterkunft.', refs: ['L1', 'R9'] },
						{ text: 'Sonst passt die Reise.', refs: [] }
					]
				}
			: undefined;
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-travel-review-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				redaction: 'off',
				configured: true
			}
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
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
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a trip checked by a model on this machine: notes naming its receipts, one dismissed, nothing changed (#693 d)', async ({
	page
}) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Reise');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await tab('Integrationen').click();
	await pairBridge(page, { code, out: () => bridgeOut });

	// The bus there and back, read before; nothing for the night between.
	await page.evaluate(async () => {
		const hooks = /** @type {any} */ (window).__belegeE2E;
		/** @param {string} vendor @param {Record<string, any>} travel */
		const add = (vendor, travel) =>
			hooks.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				currency: 'EUR',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 1900,
				documentDate: travel.departure.slice(0, 10),
				extraction: { document_type: 'ticket', gross: 19, vat: [], travel }
			});
		await add('Bus Hin Beispiel', {
			kind: 'bus',
			from: 'A-Stadt',
			to: 'Ortshausen',
			from_country: 'DE',
			to_country: 'AT',
			departure: '2026-05-04T08:00',
			arrival: '2026-05-04T13:00'
		});
		await add('Bus Zurück Beispiel', {
			kind: 'bus',
			from: 'Ortshausen',
			to: 'A-Stadt',
			from_country: 'AT',
			to_country: 'DE',
			departure: '2026-05-05T09:00',
			arrival: '2026-05-05T14:00'
		});
	});

	await tab('Belege').click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('05');
	await page.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-receipt')).toHaveCount(2);

	const box = page.getByTestId('reise-review');
	await expect(box).toBeVisible();
	await expect(box).toContainText('ungeschwärzt, weil nichts den Rechner verlässt');
	const asked = llm.requests.length;
	await box.getByTestId('reise-review-run').click();
	const notes = box.getByTestId('reise-review-note');
	await expect(notes).toHaveCount(2, { timeout: 20_000 });
	await expect(notes.first()).toContainText('Für die Nacht in Ortshausen fehlt eine Unterkunft.');
	// L1 is the outbound bus; R9 was never sent and names nothing.
	await expect(notes.first().getByTestId('reise-review-about')).toHaveText(
		'betrifft: Bus Hin Beispiel (04.05.2026)'
	);
	await expect(notes.nth(1).getByTestId('reise-review-about')).toHaveCount(0);
	expect(llm.requests.length).toBe(asked + 1);
	// What went: the trip as lines, the rules' question with it.
	const sent = String(llm.requests.at(-1)?.body.messages[1].content);
	expect(sent).toContain('L1 (R1) bus A-Stadt DE → Ortshausen AT');
	expect(sent).toContain('night 2026-05-04: no accommodation');

	await notes.nth(1).getByTestId('reise-review-dismiss').click();
	await expect(notes).toHaveCount(1);
	// Nothing changed: the same two receipts, the night still asked.
	await expect(page.getByTestId('reise-receipt')).toHaveCount(2);
	await expect(page.locator('[data-testid="reise-check"][data-kind="night"]')).toHaveCount(1);

	// In the Verlauf, with its model.
	await tab('Home').click();
	await page.getByTestId('home-verlauf').click();
	const event = page.locator('[data-testid="verlauf-event"][data-kind="travel-assist"]');
	await expect(event.getByTestId('verlauf-title')).toHaveText('KI-Prüfung einer Reise');
	await expect(event.getByTestId('verlauf-text')).toContainText(
		'deepseek-flash · 2 Fahrten, 2 Belege geprüft, 2 Hinweise'
	);
});

// "✦ Belege der Reise neu auslesen" (#693): a trip's receipts, read before,
// go to the model once more with one click – the real bridge in test mode, a
// fake model on 127.0.0.1. And the trip's total cost beside what is paid
// back. All receipts, places and vendors made up.
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

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

/**
 * The bus there and back, as the model reads them now: a ticket prints its
 * day of travel, no invoice date – the trip page must show it all the same.
 *
 * @param {string} text
 */
function busAnswer(text) {
	const back = text.includes('Bus Zurück Beispiel');
	return {
		document_type: 'ticket',
		vendor: back ? 'Bus Zurück Beispiel' : 'Bus Hin Beispiel',
		currency: 'EUR',
		net: null,
		vat: [],
		gross: 19,
		summary: 'Busfahrt',
		travel: {
			kind: 'bus',
			from: back ? 'Ortshausen' : 'A-Stadt',
			to: back ? 'A-Stadt' : 'Ortshausen',
			departure: back ? '2026-05-05T15:00' : '2026-05-04T08:00',
			arrival: back ? '2026-05-05T20:00' : '2026-05-04T13:00'
		}
	};
}

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	llm = await startFakeLlm();
	llm.answers.respond = (body) => {
		const user = body.messages?.find((/** @type {any} */ m) => m.role === 'user')?.content ?? '';
		return busAnswer(user);
	};
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-reread-'));
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
				// Told setup:llm it runs here: nothing blacked out (#423).
				redaction: 'off',
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

test('a trip’s receipts read again with one click; the total beside what is paid back (#693)', async ({
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

	await tab('Integrationen').click();
	await pairBridge(page, { code: pairingCode, out: () => bridgeOut });

	// Two bus tickets read before, as texts without a file.
	await page.evaluate(async () => {
		const hooks = /** @type {any} */ (window).__belegeE2E;
		/** @param {string} vendor @param {string} dep @param {string} arr @param {string} from @param {string} to */
		const add = (vendor, dep, arr, from, to) =>
			hooks.addReceipt({
				source: 'upload',
				sourceRef: `upload:${vendor}`,
				subject: vendor,
				excerpt: `${vendor}\nSumme: 19,00 EUR`,
				mime: 'text/plain',
				fileCid: null,
				status: 'ausgelesen',
				vendor,
				currency: 'EUR',
				amountCents: 1900,
				documentDate: dep.slice(0, 10),
				extraction: {
					document_type: 'ticket',
					vendor,
					gross: 19,
					currency: 'EUR',
					vat: [],
					travel: { kind: 'bus', from, to, departure: dep, arrival: arr }
				}
			});
		await add('Bus Hin Beispiel', '2026-05-04T08:00', '2026-05-04T13:00', 'A-Stadt', 'Ortshausen');
		await add(
			'Bus Zurück Beispiel',
			'2026-05-05T15:00',
			'2026-05-05T20:00',
			'Ortshausen',
			'A-Stadt'
		);
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('05');
	await page.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-receipt')).toHaveCount(2);

	// What the trip costs: the two tickets paid privately and the allowance, all paid back.
	await expect(page.getByTestId('reise-sum-private')).toHaveText('38,00 EUR');
	// Two days with a night between: 14 + 14 EUR, and 38 EUR in tickets.
	await expect(page.getByTestId('reise-sum-back')).toHaveText('66,00 EUR');
	await expect(page.getByTestId('reise-sum-total')).toHaveText('66,00 EUR');

	const before = llm.requests.length;
	await expect(page.getByTestId('reise-reread')).toHaveText(/Belege der Reise neu auslesen \(2\)/);
	await page.getByTestId('reise-reread').click();
	await expect(page.getByTestId('reise-reread-result')).toContainText(
		'Neu ausgelesen. Nicht lesbar: 0.',
		{ timeout: 20_000 }
	);
	const asked = llm.requests.slice(before);
	expect(asked).toHaveLength(2);
	const texts = asked.map((r) => r.raw).join('\n');
	expect(texts).toContain('Bus Hin Beispiel');
	expect(texts).toContain('Bus Zurück Beispiel');
});

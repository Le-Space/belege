// "Zuerst prüfen, ob es eine eigene Umbuchung ist" (issue #109, item 3), end
// to end: a fake LLM, the real bridge in test mode, and the app. A bank
// payment to the exchange and the exchange's deposit 2 % lower – fees, no
// shared reference, so the rules leave both open as "Beleg fehlt". The run
// "KI-Vorschläge für alle" asks "own transfer?" first; the suggestion is
// linked only on the click, and the question goes. Every name and amount is
// made up.
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

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-transfer-first-'));
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

test('a run asks "own transfer?" first, and the pair is linked on the click', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.getByRole('link', { name: 'Integrationen' }).click();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await page.getByTestId('pairing-code').fill(code);
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const bank = await e2e.addAccount({
			source: 'hibiscus',
			sourceAccountId: '0033',
			ibanLast4: '0033',
			name: 'Geschäftskonto Test',
			currency: 'EUR'
		});
		const exchange = await e2e.addAccount({
			source: 'kraken',
			sourceAccountId: 'EUR',
			ibanLast4: '',
			name: 'Kraken EUR',
			currency: 'EUR',
			kind: 'exchange'
		});
		await e2e.addTransaction({
			accountId: bank.id,
			source: 'hibiscus',
			bookedOn: '2026-09-10',
			counterparty: 'Zahlungsdienst Beispiel',
			purpose: 'Auftrag 77',
			amountCents: -20000,
			currency: 'EUR',
			counterpartyIban: '',
			bookingType: 'Überweisung'
		});
		await e2e.addTransaction({
			accountId: exchange.id,
			source: 'kraken',
			bookedOn: '2026-09-11',
			counterparty: 'Einzahlung',
			purpose: 'deposit',
			amountCents: 19600,
			currency: 'EUR',
			counterpartyIban: '',
			bookingType: 'deposit'
		});
		await e2e.runMatching();
	});

	await page.getByRole('link', { name: 'Home' }).click();
	await page.getByTestId('agent-answer').click();
	const question = page.getByTestId('question').filter({
		has: page.getByTestId('question-transaction').filter({ hasText: 'Zahlungsdienst Beispiel' })
	});
	await expect(question).toHaveCount(1);

	llm.answers.respond = (/** @type {any} */ body) =>
		String(body.messages[0].content).startsWith('You help a German company')
			? { best: 1, confidence: 'medium', reason: 'Einen Tag später, 2 % Gebühr' }
			: { best: null, confidence: 'low', reason: 'Kein Beleg passt' };
	await page.getByTestId('ai-all-open').click();
	await page.getByTestId('ai-all-transfer-first').check();
	await expect(page.getByTestId('ai-all-transfer-what')).toContainText('Bei 2 dieser Zahlungen');
	await page.getByTestId('ai-all-start').click();

	const suggestion = question.getByTestId('ai-suggestion');
	await expect(suggestion).toHaveAttribute('data-kind', 'transfer');
	await expect(suggestion).toContainText('eigene Umbuchung – Einen Tag später, 2 % Gebühr');
	await expect(suggestion).toContainText('196,00');
	// Asked redacted, and never about a receipt for this booking.
	const sent = llm.requests.map((r) => String(r.body.messages[0].content));
	// Both bookings lack a receipt and each has the other close by: two questions, two asks.
	expect(sent.filter((c) => c.startsWith('You help a German company'))).toHaveLength(2);
	expect(sent.filter((c) => c.startsWith('You match a bank booking'))).toHaveLength(0);

	await suggestion.getByTestId('ai-suggestion-take-transfer').click();
	await expect(question).toHaveCount(0);
	// The other side's question went with it: the pair is an own transfer.
	await expect(page.getByTestId('question')).toHaveCount(0);
});

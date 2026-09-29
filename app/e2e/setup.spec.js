// A fresh start (issue #200): Home shows the setup checklist, a step can be put
// off and taken up again, and the bridge step guides – nothing answers, then a
// bridge that refuses this page (its appOrigins lack it), then one that lets it
// in, noticed without a click, paired with the printed code. Done is what the
// bridge says, and the list keeps what was put off across a reload.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { acceptConsent } from './consent.js';
import { addVirtualAuthenticator } from './webauthn.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {string} */ let dir;
/** @type {{ proc: import('node:child_process').ChildProcess, out: () => string } | null} */
let running = null;

/** @param {string[]} appOrigins */
async function startBridge(appOrigins) {
	const configPath = join(dir, `bridge-${Date.now()}.json`);
	await saveConfig({ ...defaultConfig(), bridge: { port: BRIDGE_PORT }, appOrigins }, configPath);
	const proc = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let out = '';
	proc.stdout?.on('data', (d) => (out += d));
	proc.stderr?.on('data', (d) => (out += d));
	running = { proc, out: () => out };
	await expect.poll(() => out, { timeout: 20_000 }).toMatch(/Pairing code/);
	return running;
}

async function stopBridge() {
	if (!running) return;
	const { proc } = running;
	running = null;
	if (proc.exitCode !== null) return;
	const exited = new Promise((r) => proc.once('exit', r));
	proc.kill('SIGTERM');
	await exited;
}

test.beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-setup-'));
});
test.afterAll(async () => {
	await stopBridge();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a fresh start: the checklist, "later", and the bridge step that guides', async ({ page }) => {
	test.setTimeout(150_000);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Einrichtung');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const card = page.getByTestId('setup-home');
	const step = (/** @type {string} */ id) =>
		card.locator(`[data-testid="setup-step"][data-step="${id}"]`);
	await expect(card).toBeVisible();
	await expect(card.getByTestId('setup-progress')).toHaveText('0 von 5 erledigt');
	await expect(step('passkey')).toHaveAttribute('data-state', 'open');
	await expect(step('passkey').getByTestId('setup-step-detail')).toBeVisible();

	// Put off: the next step unfolds, the bridge – and nothing answers yet.
	await step('passkey').getByTestId('setup-later').click();
	await expect(step('passkey')).toHaveAttribute('data-state', 'later');
	const guide = card.getByTestId('setup-bridge');
	await expect(guide).toHaveAttribute('data-diagnosis', 'unreachable');
	await expect(guide.getByTestId('setup-bridge-commands-value')).toContainText('pnpm bridge');
	await expect(guide.getByTestId('setup-bridge-diagnosis')).toContainText(
		`http://127.0.0.1:${BRIDGE_PORT}`
	);

	// A bridge that does not let this page in: named as such, not as "unreachable".
	await startBridge(['http://localhost:5173']);
	await expect(guide).toHaveAttribute('data-diagnosis', 'origin', { timeout: 20_000 });
	await expect(guide.getByTestId('setup-bridge-diagnosis')).toContainText(APP_ORIGIN);
	await stopBridge();

	// One that does: noticed by itself, then paired with the code it printed.
	const bridge = await startBridge([APP_ORIGIN]);
	await expect(guide).toHaveAttribute('data-diagnosis', 'online', { timeout: 20_000 });
	await expect(guide.getByTestId('setup-bridge-found')).toBeVisible();
	const code = /Pairing code[^:]*: (\S+)/.exec(bridge.out())?.[1] ?? '';
	await guide.getByTestId('pairing-code').fill(code);
	await guide.getByRole('button', { name: 'Koppeln' }).click();
	await expect(step('bridge')).toHaveAttribute('data-state', 'done');
	await expect(card.getByTestId('setup-progress')).toHaveText('1 von 5 erledigt');
	await expect(step('payments').getByTestId('setup-step-detail')).toBeVisible();

	// What was put off stays put off after a reload, and is taken up again.
	await page.reload();
	await page.getByTestId('passkey-unlock').click();
	await expect(step('passkey')).toHaveAttribute('data-state', 'later');
	await card.getByTestId('setup-later-list').locator('summary').click();
	await step('passkey').getByTestId('setup-resume').click();
	await expect(step('passkey')).toHaveAttribute('data-state', 'open');

	// Under Einstellungen it stays.
	await page.getByTestId('settings-link').click();
	await expect(page.getByTestId('setup-settings')).toBeVisible();
});

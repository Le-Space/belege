// Big answers as sealed blocks over Bitswap (#578): a Paperless original of
// 15 000 000 bytes – far above what a stream answer holds (1 MiB) – reaches
// the device from the bridge's own node. The node seals it, answers its CID,
// the device fetches the blocks over Bitswap through the proved connection,
// stores the receipt with the very bytes Paperless handed out (checked by
// SHA-256), and lets the blocks go: the bridge says none are waiting. HTTP to
// the bridge is refused from the start, so this runs over the stream in both
// E2E modes. The document, its vendor and its text are made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { FAKE_PAPERLESS_TOKEN, startFakePaperless } from '@belege/bridge/testing/paperless';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const SIZE = 15_000_000;

/** A scanned invoice as Paperless keeps it: a photo's first bytes, then its weight (made up; not a picture). */
function bigOriginal() {
	const out = Buffer.alloc(SIZE, 0x11);
	Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(out, 0);
	// Not all one byte: a pattern each block differs in.
	for (let i = 4; i < SIZE; i += 997) out[i] = i % 251;
	return out;
}
const ORIGINAL = bigOriginal();

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {Awaited<ReturnType<typeof startFakePaperless>>} */ let paperless;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	paperless = await startFakePaperless({
		documents: [
			{
				id: 21,
				title: 'Rechnung WF-2026-0815',
				created: '2026-09-03',
				added: '2026-09-04T08:00:00+02:00',
				correspondent: null,
				document_type: null,
				tags: [],
				original_file_name: 'scan-0815.jpg',
				mime_type: 'image/jpeg',
				content: 'Wolkenfabrik Hosting GmbH\nRechnung WF-2026-0815\nSumme 12,34 EUR',
				original: ORIGINAL,
				archive: null
			}
		]
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-bridge-blocks-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true },
			paperless: { configured: true, baseUrl: paperless.url }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY,
			BELEGE_BRIDGE_TEST_PAPERLESS_TOKEN: FAKE_PAPERLESS_TOKEN
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 20_000 }).toMatch(/web\+ucep:pair\?\S+/);
});

test.afterAll(async () => {
	if (bridge && bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await paperless?.close();
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a 15 MB Paperless original comes as sealed blocks over Bitswap, checked, and leaves the bridge empty (#578)', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const mac = await device(browser);
	const page = mac.page;
	/** @type {string[]} */
	const http = [];
	// No HTTP to the bridge but the pairing: every call goes over the stream.
	await mac.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
		http.push(new URL(route.request().url()).pathname);
		return route.abort('connectionrefused');
	});
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	try {
		await page.goto('/');
		await acceptConsent(page);
		await page.getByTestId('passkey-label').fill('E2E Bridge-Blöcke');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();
		await openIntegration(page, 'geraete');
		await expect(page.getByTestId('devices-reachable')).toContainText('über den Relay erreichbar', {
			timeout: 30_000
		});

		// Paired by the invitation the bridge printed; from then on over its node.
		const invitation = /(web\+ucep:pair\?\S+)/.exec(bridgeOut)?.[1] ?? '';
		expect(invitation).not.toBe('');
		await openIntegration(page, 'bridge');
		await page.getByTestId('bridge-invitation').fill(invitation);
		await page.getByTestId('bridge-pair-invitation').click();
		await expect.poll(() => bridgeOut, { timeout: 60_000 }).toMatch(/node is armed/);
		const status = page.getByTestId('bridge-status');
		await expect
			.poll(
				async () => {
					const route = `${await status.getAttribute('data-paired')}/${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
					if (route !== 'true/online/stream') await page.getByTestId('bridge-check').click();
					return route;
				},
				{ timeout: 120_000, intervals: [1_000, 2_000] }
			)
			.toBe('true/online/stream');

		// Opening Belege fetches from Paperless: the one big document becomes a receipt.
		http.length = 0;
		await tab('Belege').click();
		const card = page.getByTestId('paperless-card');
		await expect(card.getByTestId('paperless-result')).toContainText('neu: 1', {
			timeout: 120_000
		});
		expect(http).toEqual([]);

		// The bridge put it up as blocks, not through the stream …
		expect(bridgeOut).toMatch(
			new RegExp(`paperless\\.document over the stream: ${SIZE} bytes as blocks`)
		);
		// … and the device kept the very bytes Paperless handed out.
		const files = await page.evaluate(() => /** @type {any} */ (window).__belegeE2E.receiptFiles());
		expect(files).toEqual([
			{
				source: 'paperless',
				size: SIZE,
				sha256: createHashHex(ORIGINAL)
			}
		]);
		// Then let them go: none wait on the bridge any more.
		await expect
			.poll(() => bridgeOut, { timeout: 30_000 })
			.toMatch(/blocks\.release: 0 answer\(s\) waiting/);
	} finally {
		await mac.context.close();
	}
});

/** @param {Buffer} bytes */
function createHashHex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

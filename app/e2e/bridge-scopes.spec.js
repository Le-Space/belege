// What a device may use at the bridge's own node, ticked on the Geräte card
// (#579): the device that paired the bridge takes "Mails lesen" away from
// itself; a mail search for a trip's night is refused with a message that
// names the area – over the stream, with no other way tried – and works again
// once the box is ticked. The bridge runs in test mode against a fake mail
// server; HTTP to it is refused from the start, so this spec runs over the
// stream in both E2E modes. A device added afterwards gets what was ticked
// before it was added. Towns, vendors, mails and the device's id are made up.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	HOSTEL_BOOKING,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { acceptConsent } from './consent.js';
import { openDevicesAdvanced, openIntegration } from './integrations.js';
import { device } from './devices.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	imap = await startFakeImap({ storage: sampleMailbox({ hostelBooking: true }) });
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-bridge-scopes-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none',
				accountingAddress: ACCOUNTING
			},
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY
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
	await llm?.close();
	await imap?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a device without “Mails lesen” is refused a mail search, said as such, and searches again once ticked (#579)', async ({
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
		await page.getByTestId('passkey-label').fill('E2E Bridge-Bereiche');
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
		// Online over the stream ("Status prüfen" asks again until the node is proved), in either E2E mode.
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

		// A trip by bus with a night and no lodging: its question searches the mailbox.
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

		/** The Geräte card's access list, this device's boxes. */
		const myScopes = async () => {
			await openIntegration(page, 'geraete');
			await openDevicesAdvanced(page);
			const row = page.getByTestId('bridge-access-device').filter({ hasText: 'Dieses Gerät' });
			await expect(row.getByTestId('bridge-access-scopes')).toBeEnabled({ timeout: 60_000 });
			return row;
		};

		// The device that paired the bridge holds every area, and may change each.
		let row = await myScopes();
		const mailRead = row.locator(
			'[data-testid="bridge-access-scope"][data-scope="bridge:mail:read"]'
		);
		await expect(mailRead).toBeChecked();
		await expect(
			row.locator('[data-testid="bridge-access-scope"][data-scope="bridge:llm"]')
		).toBeChecked();
		await expect(row).toContainText('Mails lesen');
		await mailRead.uncheck();
		await expect(mailRead).not.toBeChecked();
		await expect(row).toContainText('eingeschränkt auf');
		await expect.poll(() => bridgeOut).toMatch(/device\.scopes: a device holds \d+ scope/);

		// The night's mail search: refused, the area named, nothing tried over HTTP.
		await tab('Belege').click();
		await page.getByTestId('belege-reisen').click();
		const picker = page.getByTestId('reisen-month');
		await picker.getByLabel('Monat: Jahr').selectOption('2026');
		await picker.getByLabel('Monat: Monat').selectOption('05');
		await page.getByTestId('reisen-proposal-accept').click();
		await expect(page.getByTestId('reise-receipt')).toHaveCount(2);
		const tripUrl = page.url();
		const night = page.locator('[data-testid="reise-check"][data-kind="night"]');
		http.length = 0;
		await night.getByTestId('reise-check-mail').click();
		const error = night.getByTestId('reise-mail-error');
		await expect(error).toContainText('Dieses Gerät darf an der Bridge nicht: Mails lesen');
		await expect(night.getByTestId('reise-mail-hit')).toHaveCount(0);
		expect(http).toEqual([]);
		expect(bridgeOut).toMatch(/mail\.search over the stream: refused SCOPE_MISSING/);

		// Ticked again: the same search finds the hostel's booking.
		row = await myScopes();
		await row.locator('[data-testid="bridge-access-scope"][data-scope="bridge:mail:read"]').check();
		await expect(
			row.locator('[data-testid="bridge-access-scope"][data-scope="bridge:mail:read"]')
		).toBeChecked();
		await expect(row).not.toContainText('eingeschränkt auf');
		await tab('Belege').click();
		await page.getByTestId('belege-reisen').click();
		// Back to the trip by its link (the month shown is this month again).
		await page
			.locator(`a[href="${new URL(tripUrl).pathname}"]`)
			.first()
			.click();
		await expect(page).toHaveURL(tripUrl);
		await night.getByTestId('reise-check-mail').click();
		await expect(night.getByTestId('reise-mail-hit')).toHaveCount(1, { timeout: 30_000 });
		await expect(night.getByTestId('reise-mail-hit')).toContainText(HOSTEL_BOOKING.vendor);
		await expect(night.getByTestId('reise-mail-error')).toHaveCount(0);
		expect(http).toEqual([]);

		// A device added from here gets what was ticked before it was added, not
		// every area: "Mails lesen" off, the rest on. Its id is made up; it
		// never comes online, the bridge takes it from the device list.
		const other = '12D3KooWRBy97UB99e3J6hiPesre1MZeuNQvfan4gBziswrRJsNK';
		await openIntegration(page, 'geraete');
		await openDevicesAdvanced(page);
		const fresh = page.getByTestId('devices-new-scopes');
		await expect(fresh).toBeVisible();
		await fresh
			.locator('[data-testid="devices-new-scope"][data-scope="bridge:mail:read"]')
			.uncheck();
		await page.getByTestId('devices-add-input').fill(other);
		await page.getByTestId('devices-add').click();
		const added = page
			.getByTestId('bridge-access-device')
			.filter({ hasText: `${other.slice(0, 10)}…` });
		await expect(added.getByTestId('bridge-access-scopes')).toBeVisible({ timeout: 60_000 });
		await expect(
			added.locator('[data-testid="bridge-access-scope"][data-scope="bridge:mail:read"]')
		).not.toBeChecked();
		await expect(
			added.locator('[data-testid="bridge-access-scope"][data-scope="bridge:llm"]')
		).toBeChecked();
	} finally {
		await mac.context.close();
	}
});

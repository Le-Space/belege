// The hosted bridge on Phala, started through NEAR (#696, #728): the second
// way next to Aleph (hosted-bridge.spec.js). A fake NEAR holds the bridge
// contract and the books' implicit account; a fake Phala Cloud with a KMS of
// its own provisions and "boots" the VM; dstack's guest API is a fake socket.
// Le Space's launcher is the real one (bridge/tee/launcher), and so is what
// the image runs before the bridge: dstack's env goes through sort-secrets.mjs,
// registrar.mjs makes the VM's intake key, has its quote registered and opens
// what the browser sealed to that key (@belege/bridge/testing/phala). Then the
// real bridge starts from that run directory, as the image's entrypoint
// starts it, and is reached over the stream.
//
// Not checked here: the TDX quote's Intel signature (the fake contract checks
// that the quote binds the start and the intake key, and the compose hash)
// and Phala's real KMS key (an E2E build takes the fake KMS's key the test
// names). Made-up passkey, accounts and VM; nothing is real.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	FAKE_IMAP_USER,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { startFakeNear, startFakePhala } from '@belege/bridge/testing/phala';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';

const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);

/** @type {Awaited<ReturnType<typeof startFakeNear>>} */ let near;
/** @type {Awaited<ReturnType<typeof startFakePhala>>} */ let phala;

test.beforeAll(async () => {
	near = await startFakeNear({ origin: APP_ORIGIN });
	phala = await startFakePhala({ near, origin: APP_ORIGIN });
	// The contract's owner approved the released compose.
	near.approve(phala.composeHash());
});

test.afterAll(async () => {
	await phala?.close();
	await near?.close();
});

/**
 * A new set of books on a device, with device sync online and the fakes named.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} label
 */
async function newBooks(browser, label) {
	const mac = await device(browser);
	await mac.page.addInitScript(
		(value) => localStorage.setItem('belege.e2e.near', value),
		JSON.stringify({
			rpcUrl: near.url,
			contractId: near.contractId,
			launcherUrl: phala.launcherUrl,
			kms: phala.kms
		})
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill(label);
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	return mac;
}

/**
 * On the Bridge page: the books' NEAR account is funded (a test sends it
 * NEAR), then "Starten und koppeln" runs to the end. Returns the VM.
 *
 * @param {import('@playwright/test').Page} page
 */
async function startOnPhala(page) {
	const card = page.getByTestId('near-bridge');
	await expect(card.getByTestId('near-bridge-balance')).toContainText('noch nicht', {
		timeout: 30_000
	});
	const account = (await card.getByTestId('near-bridge-account').textContent())?.trim() ?? '';
	expect(account).toMatch(/^[0-9a-f]{64}$/);
	near.fund(account);
	await card.getByRole('button', { name: 'Aktualisieren' }).click();
	await expect(card.getByTestId('near-bridge-balance')).toContainText('1.0000 NEAR');

	const before = new Set(phala.vms.keys());
	await card.getByTestId('near-bridge-start').click();
	await expect
		.poll(
			async () => {
				const error = card.getByTestId('near-bridge-error');
				if (await error.isVisible()) throw new Error(`start failed: ${await error.textContent()}`);
				return card.getByTestId('near-bridge-state').isVisible();
			},
			{ timeout: 120_000, intervals: [1_000] }
		)
		.toBe(true);
	await expect(card.getByTestId('near-bridge-state')).toContainText('läuft, attestiert');
	const [id] = [...phala.vms.keys()].filter((k) => !before.has(k));
	const vm = /** @type {any} */ (phala.vms.get(id));
	expect(vm).toBeTruthy();
	return { account, vm };
}

/**
 * What the VM got: at its start only the start itself, nothing secret; the
 * secrets only after the contract registered its quote, sealed to its key.
 *
 * @param {string} account @param {any} vm
 */
async function expectHandedOverAfterAttestation(account, vm) {
	expect(Object.keys(JSON.parse(vm.env.BELEGE_BRIDGE_SECRETS))).toEqual(['bridge_start']);
	expect(JSON.parse(JSON.parse(vm.env.BELEGE_BRIDGE_SECRETS).bridge_start).books).toBe(account);
	const { run, secrets } = await vm.ready;
	expect(secrets).toBe(true);
	const order = near.calls.filter((c) => c.books === account).map((c) => c.method);
	expect(order).toEqual(['request_start', 'register_bridge']);
	expect(vm.log.findIndex((/** @type {string} */ l) => l.startsWith('quote handed'))).toBe(0);
	expect(vm.log.some((/** @type {string} */ l) => l.startsWith('secrets received'))).toBe(true);
	return run;
}

/**
 * The bridge as the entrypoint starts it from the run directory. The ports
 * the image fixes (8765, 9097) are taken on a test machine: any free ones.
 *
 * @param {string} run
 */
async function runHostedBridge(run) {
	const configPath = join(run, 'bridge.json');
	const config = JSON.parse(await readFile(configPath, 'utf8'));
	await writeFile(
		configPath,
		JSON.stringify({
			...config,
			bridge: { ...config.bridge, port: 0 },
			node: { ...config.node, wsPort: 0 }
		})
	);
	let out = '';
	const child = spawn(process.execPath, [CLI, '--hosted', '--config', configPath], {
		env: { ...process.env, HOME: run, BELEGE_BRIDGE_SECRETS_DIR: join(run, 'secrets') },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (d) => (out += d));
	child.stderr?.on('data', (d) => (out += d));
	return { child, out: () => out };
}

/** @param {import('@playwright/test').Page} page */
async function expectOnlineOverStream(page) {
	const status = page.getByTestId('bridge-status');
	await expect
		.poll(
			async () => {
				const route = `${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
				if (route !== 'online/stream') await page.getByTestId('bridge-check').click();
				return route;
			},
			{ timeout: 120_000, intervals: [2_000] }
		)
		.toBe('online/stream');
}

/** Mail through the bridge that answers: this month's and last month's accounting mails. @param {import('@playwright/test').Page} page */
async function fetchMail(page) {
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Belege' })
		.click();
	await expect(page.getByTestId('mail-fetch')).toBeEnabled({ timeout: 30_000 });
	// The hosted bridge has no language model here: fetch only.
	await page.getByTestId('mail-read-after').uncheck();
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toHaveText(
		'6 E-Mails · neu: 6 · schon vorhanden: 0 · doppelt: 0',
		{ timeout: 60_000 }
	);
	await page.locator('[data-testid="receipt-month-pick"][data-month="all"]').click();
	await expect(page.getByTestId('receipt')).toHaveCount(6);
}

/** Stop: the contract forgets the VM, the launcher has Phala delete it. @param {import('@playwright/test').Page} page @param {string} account @param {any} vm */
async function stopOnPhala(page, account, vm) {
	await openIntegration(page, 'bridge');
	const card = page.getByTestId('near-bridge');
	await card.getByTestId('near-bridge-stop').click();
	await expect(card.getByTestId('near-bridge-start')).toBeEnabled({ timeout: 60_000 });
	await expect(card.getByTestId('near-bridge-state')).toHaveCount(0);
	await expect(card.getByTestId('near-bridge-error')).toHaveCount(0);
	expect(vm.removed).toBe(true);
	expect(near.books.get(account)).toEqual({ request: null, bridge: null });
	expect(near.calls.filter((c) => c.books === account).map((c) => c.method)).toEqual([
		'request_start',
		'register_bridge',
		'request_stop',
		'ack_request'
	]);
}

test('a device starts the hosted bridge on Phala through NEAR with mail settings typed in, fetches mail through it, and stops it (#696, #728)', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const mac = await newBooks(browser, 'E2E Phala über NEAR');
	const imap = await startFakeImap({ storage: sampleMailbox() });
	/** @type {Awaited<ReturnType<typeof runHostedBridge>> | undefined} */
	let hosted;
	try {
		await openIntegration(mac.page, 'bridge');

		// The mailbox the hosted bridge reads, typed in for it: kept sealed, never shown again.
		const settings = mac.page.getByTestId('hosted-settings');
		await settings.getByText('Mail (IMAP)').click();
		await settings.getByLabel('IMAP-Server').fill(imap.host);
		await settings.getByLabel('Port').fill(String(imap.port));
		await settings.getByLabel('Benutzer').fill(FAKE_IMAP_USER);
		await settings.getByLabel('Passwort').first().fill(FAKE_IMAP_PASSWORD);
		await settings.getByLabel('Adresse der Buchhaltung (optional)').fill(ACCOUNTING);
		await settings.getByRole('button', { name: 'Für die gehostete Bridge halten' }).first().click();
		await expect(settings.getByTestId('hosted-settings-kept')).toContainText('imap');
		expect((await mac.page.content()).includes(FAKE_IMAP_PASSWORD)).toBe(false);

		const { account, vm } = await startOnPhala(mac.page);
		const run = await expectHandedOverAfterAttestation(account, vm);

		// Sorted as the image takes it: the password as `imap`, the rest in bridge.json.
		expect(await readFile(join(run, 'secrets', 'imap'), 'utf8')).toBe(FAKE_IMAP_PASSWORD);
		const config = JSON.parse(await readFile(join(run, 'bridge.json'), 'utf8'));
		expect(config.mail).toMatchObject({
			host: imap.host,
			port: imap.port,
			user: FAKE_IMAP_USER,
			accountingAddress: ACCOUNTING
		});
		expect(config.node.devices).toContain(
			await mac.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.peerId())
		);
		// The fake mail server speaks plain IMAP; the VM would use TLS on 993.
		await writeFile(
			join(run, 'bridge.json'),
			JSON.stringify({ ...config, mail: { ...config.mail, tls: 'none' } })
		);
		hosted = await runHostedBridge(run);
		await expect
			.poll(() => hosted?.out(), { timeout: 30_000 })
			.toMatch(/HOSTED: secrets from the unlock/);

		await expectOnlineOverStream(mac.page);
		// "Welche Bridge antwortet?": the VM on Phala; this computer has none.
		await expect(mac.page.getByTestId('bridge-overall-near')).toHaveAttribute(
			'data-state',
			'answers'
		);
		await expect(mac.page.getByTestId('bridge-overall-local')).toHaveAttribute(
			'data-state',
			'none'
		);

		await fetchMail(mac.page);
		await stopOnPhala(mac.page, account, vm);
	} catch (e) {
		if (hosted) console.log(hosted.out());
		console.log(vmLogs());
		throw e;
	} finally {
		hosted?.child.kill('SIGTERM');
		await imap.close();
	}
});

test('the hosted bridge on Phala takes over the settings of the bridge on this computer, over the stream, and the computer’s bridge keeps answering (#728)', async ({
	browser
}) => {
	test.setTimeout(360_000);
	const imap = await startFakeImap({ storage: sampleMailbox() });
	const dir = await mkdtemp(join(tmpdir(), 'belege-e2e-phala-computer-'));
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
				user: FAKE_IMAP_USER,
				tls: 'none',
				accountingAddress: ACCOUNTING
			}
		},
		configPath
	);
	let computerOut = '';
	const computer = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	computer.stdout?.on('data', (d) => (computerOut += d));
	computer.stderr?.on('data', (d) => (computerOut += d));
	/** @type {Awaited<ReturnType<typeof runHostedBridge>> | undefined} */
	let hosted;
	try {
		await expect.poll(() => computerOut, { timeout: 20_000 }).toMatch(/web\+ucep:pair\?\S+/);
		const mac = await newBooks(browser, 'E2E Phala übernimmt');
		// The take-over is for the device that paired the computer's bridge, over its node only:
		// no HTTP to it from the page.
		/** @type {string[]} */
		const http = [];
		await mac.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
			http.push(new URL(route.request().url()).pathname);
			return route.abort('connectionrefused');
		});

		// The bridge on this computer, paired by its invitation, online over the stream.
		const invitation = /(web\+ucep:pair\?\S+)/.exec(computerOut)?.[1] ?? '';
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('bridge-invitation').fill(invitation);
		await mac.page.getByTestId('bridge-pair-invitation').click();
		await expect.poll(() => computerOut, { timeout: 60_000 }).toMatch(/node is armed/);
		const status = mac.page.getByTestId('bridge-status');
		await expect
			.poll(
				async () => {
					const route = `${await status.getAttribute('data-paired')}/${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
					if (route !== 'true/online/stream') await mac.page.getByTestId('bridge-check').click();
					return route;
				},
				{ timeout: 120_000, intervals: [1_000, 2_000] }
			)
			.toBe('true/online/stream');

		// "Von der Bridge auf diesem Rechner übernehmen": its mail settings, over the stream.
		const settings = mac.page.getByTestId('hosted-settings');
		await settings.getByTestId('hosted-settings-take-over').click();
		await expect(settings.getByTestId('hosted-settings-kept')).toContainText('imap', {
			timeout: 30_000
		});
		await expect(settings.getByTestId('hosted-settings-error')).toHaveCount(0);
		expect(computerOut).toMatch(/settings\.export: the settings were handed/);
		expect((await mac.page.content()).includes(FAKE_IMAP_PASSWORD)).toBe(false);

		const { account, vm } = await startOnPhala(mac.page);
		const run = await expectHandedOverAfterAttestation(account, vm);
		// What the computer's bridge holds, now the hosted one's: the mailbox and its password.
		expect(await readFile(join(run, 'secrets', 'imap'), 'utf8')).toBe(FAKE_IMAP_PASSWORD);
		const config = JSON.parse(await readFile(join(run, 'bridge.json'), 'utf8'));
		expect(config.mail).toMatchObject({
			host: imap.host,
			port: imap.port,
			user: FAKE_IMAP_USER,
			tls: 'none',
			accountingAddress: ACCOUNTING
		});
		// Not the computer's own: no paired tokens, no LAN relay, its own port.
		expect(config.pairedTokens).toBeUndefined();
		expect(config.lanRelay).toBeUndefined();

		hosted = await runHostedBridge(run);
		await expect
			.poll(() => hosted?.out(), { timeout: 30_000 })
			.toMatch(/HOSTED: secrets from the unlock/);
		await expectOnlineOverStream(mac.page);
		await expect(mac.page.getByTestId('bridge-overall-near')).toHaveAttribute(
			'data-state',
			'answers'
		);

		// Mail through the hosted bridge, with the settings it took over – not through the computer's.
		await fetchMail(mac.page);
		expect(hosted?.out()).toMatch(/listed 6 accounting mail/);
		expect(computerOut).not.toMatch(/accounting mail/);

		// The computer's bridge keeps working: running, its mail still set up, answering.
		expect(computer.exitCode).toBeNull();
		const health = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`).then((r) => r.json());
		expect(health).toMatchObject({ ok: true, mail: { configured: true } });
		expect(JSON.parse(await readFile(configPath, 'utf8')).mail.host).toBe(imap.host);

		await stopOnPhala(mac.page, account, vm);
		// The page only probes the computer's bridge over HTTP (refused); the settings and the mail went over the stream.
		expect(http.filter((p) => p !== '/health' && p !== '/lan-relay')).toEqual([]);
	} catch (e) {
		console.log(computerOut);
		if (hosted) console.log(hosted.out());
		console.log(vmLogs());
		throw e;
	} finally {
		hosted?.child.kill('SIGTERM');
		if (computer.exitCode === null) {
			const exited = new Promise((resolve) => computer.once('exit', resolve));
			computer.kill('SIGTERM');
			await exited;
		}
		await imap.close();
		await rm(dir, { recursive: true, force: true });
	}
});

/** What the fake VMs' registrars said, for a failure. */
function vmLogs() {
	return [...(phala?.vms.values() ?? [])].map((v) => `${v.id}: ${v.log.join(' | ')}`).join('\n');
}

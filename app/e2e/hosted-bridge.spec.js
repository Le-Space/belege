// The hosted bridge (#585): a device attests the bridge's confidential VM and
// unlocks it from the Bridge page, paired in the same step, with no terminal
// and no invitation. A fake Aleph holds the INSTANCE (the books' Aleph key's,
// the published image, the published measurement); a stand-in for the VM's
// attestation agent sits behind a fake attest relay's /attest
// (@belege/bridge/testing/attest-agent) and keeps what it is sent. Then the
// real bridge starts with exactly that, as the image starts it, and is a
// device of the books: listed as hosted and attested, reached over the stream.
// The AMD signature is the one thing not checked here (an E2E build takes the
// measurement the test names); relay-button's tests cover it. Made-up passkey,
// passphrase and VM; nothing is real.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	FAKE_CRN,
	FAKE_INSTANCE_CREDITS_PER_HOUR,
	startFakeAleph
} from '@belege/bridge/testing/aleph';
import {
	FAKE_POLICY,
	startFakeAttestAgent,
	startFakeAttestRelay
} from '@belege/bridge/testing/attest-agent';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	FAKE_IMAP_USER,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';

const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const IMAGE = '4ee0ab57bb64da3b516b3ed6494275356119089241ef6ab533d3ab60ae08a526';
const VM = 'a'.repeat(64);
const CRN = 'e'.repeat(64);
const PUBLISHED = '11'.repeat(48);
const published = {
	policy: FAKE_POLICY,
	measurements: [{ platform: 'sev_snp', registers: { launch: PUBLISHED } }]
};

/** @type {Record<string, any>} */
const messages = {};
/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;
/** @type {Awaited<ReturnType<typeof startFakeAttestAgent>> | undefined} */ let agent;
/** @type {Awaited<ReturnType<typeof startFakeAttestRelay>> | undefined} */ let relay;
/** @type {import('node:child_process').ChildProcess | undefined} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	aleph = await startFakeAleph({ accounts: {}, messages });
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-hosted-'));
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await relay?.close();
	await agent?.close();
	await aleph?.close?.();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('a device attests and unlocks the hosted bridge, which comes up paired: hosted, attested, over the stream', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	await mac.page.addInitScript(
		(url) => localStorage.setItem('belege.e2e.alephUrl', url),
		aleph.url
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E Gehostete Bridge');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);

	// The VM: the books' Aleph key's INSTANCE of the published image, on the published runtime.
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	expect(owner).toMatch(/^0x[0-9a-fA-F]{40}$/);
	messages[VM] = {
		type: 'INSTANCE',
		content: {
			address: owner,
			rootfs: { parent: { ref: IMAGE, use_latest: true } },
			environment: { trusted_execution: published },
			requirements: { node: { node_hash: CRN } },
			resources: { vcpus: 2 }
		}
	};
	agent = await startFakeAttestAgent({ measurement: PUBLISHED, owner });
	relay = await startFakeAttestRelay(agent);
	await mac.page.evaluate(
		([url, pins]) => {
			localStorage.setItem('belege.e2e.attestUrl', url);
			localStorage.setItem('belege.e2e.hostedPins', pins);
		},
		[relay.url, JSON.stringify(published)]
	);

	await openIntegration(mac.page, 'bridge');
	const card = mac.page.getByTestId('hosted-bridge');
	await expect(card).toBeVisible();
	await expect(mac.page.getByTestId('hackathon-band')).toContainText('NEAR Hackathon 2026');
	await mac.page.getByTestId('hosted-bridge-existing').locator('summary').click();
	await mac.page.getByTestId('hosted-bridge-instance').fill(VM);
	await mac.page.getByTestId('hosted-bridge-passphrase').fill('not-the-real-passphrase');
	await mac.page.getByTestId('hosted-bridge-unlock').click();
	await expect
		.poll(
			async () => {
				const error = mac.page.getByTestId('hosted-bridge-error');
				if (await error.isVisible()) throw new Error(`unlock failed: ${await error.textContent()}`);
				return mac.page.getByTestId('hosted-bridge-state').isVisible();
			},
			{ timeout: 60_000, intervals: [500] }
		)
		.toBe(true);
	await expect(mac.page.getByTestId('hosted-bridge-state')).toContainText('Gehostet, attestiert');
	await expect(mac.page.getByTestId('hosted-bridge-measurement')).toContainText(PUBLISHED);
	// The passphrase is gone from the form.
	await expect(mac.page.getByTestId('hosted-bridge-passphrase')).toHaveValue('');

	// What reached the VM, and only after the attestation.
	const got = agent.received;
	expect(Object.keys(got).sort()).toEqual([
		'bridge_auth',
		'bridge_config',
		'bridge_peer_key',
		'https_hostname',
		'luks_passphrase'
	]);
	expect(got.luks_passphrase).toBe('not-the-real-passphrase');
	const config = JSON.parse(got.bridge_config);
	expect(config.node.devices).toContain(
		await mac.page.evaluate(() => /** @type {any} */ (window).__belegeE2E.peerId())
	);

	// The bridge starts with that, as belege-bridge-run sorts it, and is armed and paired.
	const secretsDir = join(dir, 'secrets');
	await mkdir(join(dir, 'node'), { recursive: true });
	await mkdir(secretsDir, { recursive: true });
	await writeFile(join(secretsDir, 'bridge_auth'), got.bridge_auth);
	await writeFile(join(dir, 'node', 'peer-key'), Buffer.from(got.bridge_peer_key, 'base64'));
	await writeFile(
		join(dir, 'bridge.json'),
		JSON.stringify({ bridge: { port: 0 }, node: { ...config.node, enabled: true, wsPort: 0 } })
	);
	bridge = spawn(process.execPath, [CLI, '--hosted', '--config', join(dir, 'bridge.json')], {
		env: { ...process.env, BELEGE_BRIDGE_SECRETS_DIR: secretsDir },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect
		.poll(() => bridgeOut, { timeout: 30_000 })
		.toMatch(/HOSTED: secrets from the unlock/);
	expect(bridgeOut).not.toMatch(/web\+ucep:pair\?|Pairing code/);

	// A device of the books: hosted and attested, connected through the relay.
	await openIntegration(mac.page, 'geraete');
	const item = mac.page.getByTestId('devices-item').filter({ hasText: 'Gehostete Bridge' });
	await expect(item.getByTestId('devices-item-hosted')).toContainText('gehostet, attestiert');
	await expect(item.getByTestId('devices-item-state')).toContainText('verbunden', {
		timeout: 90_000
	});

	// Its status comes over the stream.
	await openIntegration(mac.page, 'bridge');
	const status = mac.page.getByTestId('bridge-status');
	await expect
		.poll(
			async () => {
				const route = `${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
				if (route !== 'online/stream') await mac.page.getByTestId('bridge-check').click();
				return route;
			},
			{ timeout: 90_000, intervals: [2_000] }
		)
		.toBe('online/stream');
	// "Welche Bridge antwortet?": the VM, unlocked; this computer has none.
	await expect(mac.page.getByTestId('bridge-overall-aleph')).toHaveAttribute(
		'data-state',
		'answers'
	);
	await expect(mac.page.getByTestId('bridge-overall-local')).toHaveAttribute('data-state', 'none');
});

test('a VM on another runtime gets nothing, and the card says why', async ({ browser }) => {
	test.setTimeout(120_000);
	const mac = await device(browser);
	await mac.page.addInitScript(
		(url) => localStorage.setItem('belege.e2e.alephUrl', url),
		aleph.url
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E Falsche VM');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	const other = 'b'.repeat(64);
	messages[other] = {
		type: 'INSTANCE',
		content: {
			address: owner,
			rootfs: { parent: { ref: IMAGE, use_latest: true } },
			environment: { trusted_execution: published },
			requirements: { node: { node_hash: CRN } },
			resources: { vcpus: 2 }
		}
	};
	// The VM really runs something else: its reports carry another measurement.
	const changed = await startFakeAttestAgent({ measurement: '22'.repeat(48), owner });
	const changedRelay = await startFakeAttestRelay(changed);
	try {
		await mac.page.evaluate(
			([url, pins]) => {
				localStorage.setItem('belege.e2e.attestUrl', url);
				localStorage.setItem('belege.e2e.hostedPins', pins);
			},
			[changedRelay.url, JSON.stringify(published)]
		);
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('hosted-bridge-existing').locator('summary').click();
		await mac.page.getByTestId('hosted-bridge-instance').fill(other);
		await mac.page.getByTestId('hosted-bridge-passphrase').fill('not-the-real-passphrase');
		await mac.page.getByTestId('hosted-bridge-unlock').click();
		await expect(mac.page.getByTestId('hosted-bridge-error')).toContainText('measurement', {
			timeout: 60_000
		});
		expect(changed.received).toEqual({});
		await expect(mac.page.getByTestId('hosted-bridge-state')).toHaveCount(0);
	} finally {
		await changedRelay.close();
		await changed.close();
	}
});

test('a device starts the hosted bridge on Aleph, short of credits first, fetches mail through it, and stops it again (#587, #728)', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const mac = await device(browser);
	await mac.page.addInitScript(
		(url) => localStorage.setItem('belege.e2e.alephUrl', url),
		aleph.url
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E VM starten');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	const vmAgent = await startFakeAttestAgent({ measurement: PUBLISHED, owner });
	const vmRelay = await startFakeAttestRelay(vmAgent);
	const imap = await startFakeImap({ storage: sampleMailbox() });
	/** @type {import('node:child_process').ChildProcess | undefined} */
	let hostedBridge;
	let out = '';
	try {
		await mac.page.evaluate(
			([url, pins]) => {
				localStorage.setItem('belege.e2e.attestUrl', url);
				localStorage.setItem('belege.e2e.hostedPins', pins);
			},
			[vmRelay.url, JSON.stringify(published)]
		);
		await openIntegration(mac.page, 'bridge');

		// The mailbox the hosted bridge reads, typed in for it (#728): kept sealed, never shown again.
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
		// What is not secret shows, read-only; of the password only that it is stored.
		const keptMail = settings.getByTestId('hosted-settings-view-mail');
		await expect(keptMail).toContainText(imap.host);
		await expect(keptMail).toContainText(FAKE_IMAP_USER);
		await expect(keptMail).toContainText(ACCOUNTING);
		await expect(keptMail.getByTestId('hosted-settings-view-secret')).toHaveText('gespeichert');
		expect((await mac.page.content()).includes(FAKE_IMAP_PASSWORD)).toBe(false);

		const node = mac.page.getByTestId('hosted-bridge-node');
		await expect(node).toHaveValue(FAKE_CRN);
		await expect(node).toContainText('Fake TEE node');

		// Without a day of credits Aleph would refuse the VM: the card says so, and nothing is asked for.
		await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
		await mac.page.getByTestId('hosted-bridge-start').click();
		await expect(mac.page.getByTestId('hosted-bridge-error')).toContainText('fehlen Credits', {
			timeout: 30_000
		});
		expect(aleph.instances.size).toBe(0);
		await expect(mac.page.getByTestId('hosted-bridge-start-passphrase')).toHaveValue('');

		aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
		await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
		await mac.page.getByTestId('hosted-bridge-start').click();
		await expect
			.poll(
				async () => {
					const error = mac.page.getByTestId('hosted-bridge-error');
					if (await error.isVisible())
						throw new Error(`start failed: ${await error.textContent()}`);
					return mac.page.getByTestId('hosted-bridge-state').isVisible();
				},
				{ timeout: 90_000, intervals: [500] }
			)
			.toBe(true);

		// The VM Aleph has: the books' key's, the published image and pins, on the chosen node, placed, 443 open.
		expect(aleph.instances.size).toBe(1);
		const [[instance, vm]] = [...aleph.instances];
		expect(vm.status).toBe('processed');
		expect(vm.placed).toBe(true);
		expect(vm.content.address.toLowerCase()).toBe(owner.toLowerCase());
		expect(vm.content.rootfs.parent.ref).toBe(IMAGE);
		expect(vm.content.requirements.node.node_hash).toBe(FAKE_CRN);
		expect(vm.content.environment.trusted_execution).toEqual(published);
		expect(aleph.kept.get(vm.sender)?.['port-forwarding']?.[instance]?.ports?.['443']?.tcp).toBe(
			true
		);
		await expect(mac.page.getByTestId('hosted-bridge-vm')).toContainText('VM läuft seit');
		await expect(mac.page.getByTestId('hosted-bridge-vm-hash')).toHaveText(instance);
		await expect(mac.page.getByTestId('hosted-bridge-usage')).toContainText(
			`${FAKE_INSTANCE_CREDITS_PER_HOUR.toLocaleString('de-DE')} Credits/h`
		);

		// Only after the attestation: the passphrase and what pairing needs.
		expect(vmAgent.received.luks_passphrase).toBe('not-the-real-passphrase');
		const config = JSON.parse(vmAgent.received.bridge_config);
		// …and the mailbox, as the image takes it: the password as `imap`, the rest in bridge.json.
		expect(vmAgent.received.imap).toBe(FAKE_IMAP_PASSWORD);
		expect(config.mail).toMatchObject({
			host: imap.host,
			port: imap.port,
			user: FAKE_IMAP_USER,
			accountingAddress: ACCOUNTING
		});
		const hostedDir = await mkdtemp(join(tmpdir(), 'belege-e2e-hosted-vm-'));
		const secretsDir = join(hostedDir, 'secrets');
		await mkdir(join(hostedDir, 'node'), { recursive: true });
		await mkdir(secretsDir, { recursive: true });
		await writeFile(join(secretsDir, 'bridge_auth'), vmAgent.received.bridge_auth);
		await writeFile(join(secretsDir, 'imap'), vmAgent.received.imap);
		await writeFile(
			join(hostedDir, 'node', 'peer-key'),
			Buffer.from(vmAgent.received.bridge_peer_key, 'base64')
		);
		await writeFile(
			join(hostedDir, 'bridge.json'),
			JSON.stringify({
				bridge: { port: 0 },
				// The fake mail server speaks plain IMAP; the VM would use TLS on 993.
				mail: { ...config.mail, tls: 'none' },
				node: { ...config.node, enabled: true, wsPort: 0 }
			})
		);
		hostedBridge = spawn(
			process.execPath,
			[CLI, '--hosted', '--config', join(hostedDir, 'bridge.json')],
			{
				env: { ...process.env, BELEGE_BRIDGE_SECRETS_DIR: secretsDir },
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		hostedBridge.stdout?.on('data', (d) => (out += d));
		hostedBridge.stderr?.on('data', (d) => (out += d));

		// Online: its status comes over the stream.
		const status = mac.page.getByTestId('bridge-status');
		await expect
			.poll(
				async () => {
					const route = `${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
					if (route !== 'online/stream') await mac.page.getByTestId('bridge-check').click();
					return route;
				},
				{ timeout: 90_000, intervals: [2_000] }
			)
			.toBe('online/stream');

		// The hosted bridge is the books' bridge now: taking over would ask the VM, not this
		// computer, so the button is off and says what to do instead.
		await expect(settings.getByTestId('hosted-settings-take-over')).toBeDisabled();
		await expect(settings.getByTestId('hosted-settings-take-over-hint')).toContainText(
			'Die Bridge der Bücher ist jetzt eine gehostete'
		);
		// KI: no model for the hosted bridge – not the defaults of a bridge on a computer, no
		// terminal advice, but where to enter it and that the VM has to start again.
		await openIntegration(mac.page, 'ki');
		const ki = mac.page.getByTestId('ki-card');
		await expect(ki.getByTestId('ki-hosted-no-model')).toContainText(
			'Für die gehostete Bridge ist kein Sprachmodell eingerichtet',
			{ timeout: 60_000 }
		);
		await expect(ki.getByTestId('ki-hosted-no-model')).toContainText('stoppen und wieder starten');
		await expect(ki.getByTestId('ki-provider')).toHaveCount(0);
		await expect(ki.getByTestId('ki-ollama')).toHaveCount(0);
		await expect(ki).not.toContainText('pnpm setup:llm');
		await expect(mac.page.getByTestId('integration-help-how')).toContainText(
			'Hier antwortet eine gehostete Bridge'
		);
		await expect(mac.page.getByTestId('integration-help-command')).toHaveCount(0);
		await ki.getByTestId('ki-hosted-settings-link').click();
		await expect(mac.page.getByTestId('hosted-settings')).toBeVisible();

		// Mail through the hosted bridge: this month's and last month's accounting mails.
		await mac.page
			.getByRole('navigation', { name: 'Hauptnavigation' })
			.getByRole('link', { name: 'Belege' })
			.click();
		await expect(mac.page.getByTestId('mail-fetch')).toBeEnabled({ timeout: 30_000 });
		// The hosted bridge has no language model (#251): fetch only.
		await mac.page.getByTestId('mail-read-after').uncheck();
		await mac.page.getByTestId('mail-fetch').click();
		await expect(mac.page.getByTestId('mail-result')).toHaveText(
			'6 E-Mails · neu: 6 · schon vorhanden: 0 · doppelt: 0',
			{ timeout: 60_000 }
		);
		await mac.page.locator('[data-testid="receipt-month-pick"][data-month="all"]').click();
		await expect(mac.page.getByTestId('receipt')).toHaveCount(6);

		// Stop: Aleph forgets the VM, the card says when, the bridge leaves the devices.
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('hosted-bridge-stop').click();
		await expect(mac.page.getByTestId('hosted-bridge-vm')).toContainText('Gestoppt', {
			timeout: 60_000
		});
		expect(aleph.instances.get(instance)?.status).toBe('forgotten');
		await expect(mac.page.getByTestId('hosted-bridge-start')).toBeVisible();
		// KI, with the VM stopped: no bridge answers, and the page says which one the books expect.
		await openIntegration(mac.page, 'ki');
		await expect(mac.page.getByTestId('ki-no-bridge')).toContainText(
			'Gerade antwortet keine Bridge',
			{ timeout: 60_000 }
		);
		await expect(mac.page.getByTestId('ki-no-bridge')).toHaveAttribute('data-expected', 'aleph');
		await expect(mac.page.getByTestId('ki-status')).toHaveCount(0);
		await openIntegration(mac.page, 'geraete');
		await expect(
			mac.page.getByTestId('devices-item').filter({ hasText: 'Gehostete Bridge' })
		).toHaveCount(0);
		await rm(hostedDir, { recursive: true, force: true });
	} catch (e) {
		if (out) console.log(out);
		throw e;
	} finally {
		hostedBridge?.kill('SIGTERM');
		await imap.close();
		await vmRelay.close();
		await vmAgent.close();
	}
});

/**
 * A fake Le Space Credits service for the hosted bridge: a balance in cents,
 * the bridge's plans, and the authorization of the books' key on the
 * sub-account, which it writes into the fake Aleph and funds there, as the
 * service's treasury would. Signatures are not checked here (credits.spec.js
 * covers them); the address is taken from the header.
 *
 * @param {{ sub: string, cents: number }} p
 */
async function startFakeCredits({ sub, cents }) {
	/** @type {{ id: string, hours: number, price: number } | null} */
	let plan = null;
	let balance = cents;
	/** @type {string[]} */
	const delegates = [];
	const plans = { 'bridge-s': { hours: 60, price: 700 } };
	const origin = `http://localhost:${process.env.E2E_PORT || 4391}`;
	const cors = {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'GET, POST, PUT',
		'access-control-allow-headers': 'content-type, x-ls-address, x-ls-timestamp, x-ls-signature'
	};
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			res.writeHead(status, { 'content-type': 'application/json', ...cors });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'OPTIONS') {
			res.writeHead(204, cors);
			return res.end();
		}
		let raw = '';
		for await (const chunk of req) raw += chunk;
		const body = raw ? JSON.parse(raw) : {};
		const address = String(req.headers['x-ls-address'] ?? '');
		const pkg = () =>
			plan
				? {
						id: plan.id,
						state: 'active',
						period_start: new Date().toISOString(),
						period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
						hours_left: plan.hours
					}
				: null;
		if (url.pathname === '/v1/balance' && req.method === 'GET')
			return send(200, {
				product: 'belege',
				address,
				credits: balance,
				reserved: 0,
				lines_this_month: { ki: 0, vm: 0, transfer: 0 },
				package: pkg(),
				vm: { owner: sub, delegates },
				mode: 'live'
			});
		if (url.pathname === '/v1/purchases') return send(200, { purchases: [] });
		if (url.pathname === '/v1/package' && req.method === 'PUT') {
			const chosen = plans[/** @type {'bridge-s'} */ (body.package)];
			if (!chosen) return send(400, { error: 'no such plan', code: 'PLAN' });
			if (balance < chosen.price) return send(402, { error: 'balance too low', code: 'FUNDS' });
			balance -= chosen.price;
			plan = { id: body.package, ...chosen };
			// The period's grant: the plan's hours and a day in reserve, on the sub-account.
			aleph.fund(sub, (chosen.hours + 24) * FAKE_INSTANCE_CREDITS_PER_HOUR);
			return send(200, { package: pkg() });
		}
		if (url.pathname === '/v1/vm/authorize' && req.method === 'POST') {
			if (!plan) return send(409, { error: 'no plan with a running period', code: 'NO_PLAN' });
			const delegate = body.delegate ?? address;
			aleph.authorize(sub, delegate, ['INSTANCE', 'FORGET', 'AGGREGATE'], ['port-forwarding']);
			if (!delegates.includes(delegate)) delegates.push(delegate);
			return send(200, {
				owner: sub,
				delegate,
				types: ['INSTANCE', 'FORGET', 'AGGREGATE'],
				aggregate_keys: ['port-forwarding'],
				hours_left: plan.hours,
				period_end: pkg()?.period_end,
				revoke_at: null
			});
		}
		return send(404, { error: 'not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		delegates,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}

test('Le Space pays the hosted bridge from a plan: its sub-account is the payer, the books’ key its delegate and still the owner (#587)', async ({
	browser
}) => {
	test.setTimeout(180_000);
	const SUB = '0x5555555555555555555555555555555555555555';
	const credits = await startFakeCredits({ sub: SUB, cents: 1000 });
	const mac = await device(browser);
	await mac.page.addInitScript(
		([alephUrl, creditsUrl]) => {
			localStorage.setItem('belege.e2e.alephUrl', alephUrl);
			localStorage.setItem('belege.e2e.creditsUrl', creditsUrl);
		},
		[aleph.url, credits.url]
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E Le Space zahlt');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	const vmAgent = await startFakeAttestAgent({ measurement: PUBLISHED, owner });
	const vmRelay = await startFakeAttestRelay(vmAgent);
	try {
		await mac.page.evaluate(
			([url, pins]) => {
				localStorage.setItem('belege.e2e.attestUrl', url);
				localStorage.setItem('belege.e2e.hostedPins', pins);
			},
			[vmRelay.url, JSON.stringify(published)]
		);
		// Le Space Credits on, with 10 € on the books.
		await openIntegration(mac.page, 'aleph');
		const creditsCard = mac.page.getByTestId('credits-card');
		await creditsCard.getByTestId('credits-on').click();
		await expect(creditsCard.getByTestId('credits-balance')).toHaveText(/10,00\s€/);

		await openIntegration(mac.page, 'bridge');
		await expect(mac.page.getByTestId('hosted-bridge-pays-lespace')).toBeChecked();
		const plan = mac.page.getByTestId('hosted-bridge-plan');
		await expect(plan).toContainText('Noch kein Paket');
		// No plan, no start.
		await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
		await expect(mac.page.getByTestId('hosted-bridge-start')).toBeDisabled();
		// 10 € buy the smallest plan only.
		await expect(mac.page.getByTestId('hosted-bridge-plan-bridge-m')).toBeDisabled();
		await mac.page.getByTestId('hosted-bridge-plan-bridge-s').click();
		await expect(plan).toContainText('Paket Ab und zu: noch 60 h.');

		await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
		await mac.page.getByTestId('hosted-bridge-start').click();
		await expect
			.poll(
				async () => {
					const error = mac.page.getByTestId('hosted-bridge-error');
					if (await error.isVisible())
						throw new Error(`start failed: ${await error.textContent()}`);
					return mac.page.getByTestId('hosted-bridge-state').isVisible();
				},
				{ timeout: 90_000, intervals: [500] }
			)
			.toBe(true);

		// Paid by the sub-account, sent by the books' key, measured for the books' key.
		expect(credits.delegates.map((d) => d.toLowerCase())).toEqual([owner.toLowerCase()]);
		const [instance, vm] = [...aleph.instances].find(
			([, v]) => v.address.toLowerCase() === SUB.toLowerCase()
		) ?? [null, null];
		expect(instance).toBeTruthy();
		expect(vm.status).toBe('processed');
		expect(vm.sender.toLowerCase()).toBe(owner.toLowerCase());
		expect(vm.content.environment.trusted_execution).toEqual(published);
		expect(aleph.kept.get(SUB)?.['port-forwarding']?.[instance]?.ports?.['443']?.tcp).toBe(true);
		// Only after the attestation, and only for the books' key: the passphrase.
		expect(vmAgent.received.luks_passphrase).toBe('not-the-real-passphrase');

		// Stopped by the books' key for the sub-account.
		await mac.page.getByTestId('hosted-bridge-stop').click();
		await expect(mac.page.getByTestId('hosted-bridge-vm')).toContainText('Gestoppt', {
			timeout: 60_000
		});
		expect(aleph.instances.get(instance)?.status).toBe('forgotten');
	} finally {
		await vmRelay.close();
		await vmAgent.close();
		await credits.close();
	}
});

test('a VM the node cannot bring up: the card says so and stops it (#587)', async ({ browser }) => {
	test.setTimeout(120_000);
	const mac = await device(browser);
	await mac.page.addInitScript(
		(url) => localStorage.setItem('belege.e2e.alephUrl', url),
		aleph.url
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E VM hängt');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	await mac.page.evaluate(
		(pins) => localStorage.setItem('belege.e2e.hostedPins', pins),
		JSON.stringify(published)
	);
	aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);
	aleph.failStarts(true);
	try {
		await openIntegration(mac.page, 'bridge');
		await mac.page.getByTestId('hosted-bridge-pays-books').check();
		await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
		await mac.page.getByTestId('hosted-bridge-start').click();
		await expect(mac.page.getByTestId('hosted-bridge-error')).toContainText(
			'5-mal nicht hochbekommen (startup_failed)',
			{ timeout: 60_000 }
		);
		const [instance] = [...aleph.instances].find(
			([, v]) => v.address.toLowerCase() === owner.toLowerCase() && v.failed
		) ?? [null];
		expect(instance).toBeTruthy();

		// Half started: carry on, or stop it here.
		await expect(mac.page.getByTestId('hosted-bridge-start')).toContainText('Entsperren');
		await expect(mac.page.getByTestId('hosted-bridge-locked')).toBeVisible();
		await expect(mac.page.getByTestId('bridge-overall-aleph')).toHaveAttribute(
			'data-state',
			'locked'
		);
		await mac.page.getByTestId('hosted-bridge-stop').click();
		await expect(mac.page.getByTestId('hosted-bridge-vm')).toContainText('Gestoppt', {
			timeout: 60_000
		});
		expect(aleph.instances.get(instance)?.status).toBe('forgotten');
		await expect(mac.page.getByTestId('hosted-bridge-start')).toContainText('Starten');
	} finally {
		aleph.failStarts(false);
	}
});

test('a VM that does not answer: the card says which try and why, cancels, lists the books’ VMs and stops one (#587)', async ({
	browser
}) => {
	test.setTimeout(150_000);
	const mac = await device(browser);
	await mac.page.addInitScript(
		(url) => localStorage.setItem('belege.e2e.alephUrl', url),
		aleph.url
	);
	await mac.page.goto('/');
	await acceptConsent(mac.page);
	await mac.page.getByTestId('passkey-label').fill('E2E VM antwortet nicht');
	await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(mac.page.getByTestId('own-did')).toBeVisible();
	await openIntegration(mac.page, 'geraete');
	await expect(mac.page.getByTestId('devices-reachable')).toContainText(
		'über den Relay erreichbar',
		{ timeout: 30_000 }
	);
	const owner = await mac.page.evaluate(() =>
		/** @type {any} */ (window).__belegeE2E.alephAddress()
	);
	// No agent behind this /attest: every try fails as a VM still booting does.
	await mac.page.evaluate(
		([pins]) => {
			localStorage.setItem('belege.e2e.hostedPins', pins);
			localStorage.setItem('belege.e2e.attestUrl', 'ws://127.0.0.1:9/attest');
			localStorage.setItem(
				'belege.e2e.hostedPatience',
				JSON.stringify({ tries: 20, delayMs: 3_000 })
			);
		},
		[JSON.stringify(published)]
	);
	aleph.fund(owner, 30 * FAKE_INSTANCE_CREDITS_PER_HOUR);

	await openIntegration(mac.page, 'bridge');
	await expect(mac.page.getByTestId('hosted-bridge-instances')).toContainText(
		'Aleph hält keine VM dieser Bücher'
	);
	await mac.page.getByTestId('hosted-bridge-pays-books').check();
	await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
	await mac.page.getByTestId('hosted-bridge-start').click();

	// Which try, of how many, and the last reason – without the query that names VM and node.
	const progress = mac.page.getByTestId('hosted-bridge-progress');
	await expect(progress).toContainText(
		/Versuch \d+ von 20: Die VM antwortet noch nicht – .*WebSocket/,
		{
			timeout: 60_000
		}
	);
	await expect(progress).not.toContainText('?crn=');
	await mac.page.getByTestId('hosted-bridge-cancel').click();
	await expect(mac.page.getByTestId('hosted-bridge-notice')).toContainText('Abgebrochen');
	await expect(mac.page.getByTestId('hosted-bridge-error')).toHaveCount(0);
	await expect(mac.page.getByTestId('hosted-bridge-cancel')).toHaveCount(0);

	// The VM runs on: its full hash, its node, and the books' list of VMs that names it.
	const [instance] = [...aleph.instances].find(
		([, v]) => v.address.toLowerCase() === owner.toLowerCase() && v.status === 'processed'
	) ?? [''];
	expect(instance).toMatch(/^[0-9a-f]{64}$/);
	await expect(mac.page.getByTestId('hosted-bridge-vm-hash')).toHaveText(instance);
	await expect(mac.page.getByTestId('hosted-bridge-vm-node')).toContainText('http://127.0.0.1:');
	const item = mac.page.locator(
		`[data-testid="hosted-bridge-instance-item"][data-hash="${instance}"]`
	);
	await expect(item).toContainText(instance);
	await expect(item.getByTestId('hosted-bridge-instance-known')).toContainText('Die kennt Belege');
	await expect(item).toContainText('Fake TEE node');

	// Nothing a later try changes: no relay with /attest. Said at once, not after 20 tries.
	await mac.page.evaluate(() => localStorage.removeItem('belege.e2e.attestUrl'));
	await mac.page.getByTestId('hosted-bridge-start-passphrase').fill('not-the-real-passphrase');
	await mac.page.getByTestId('hosted-bridge-start').click();
	await expect(mac.page.getByTestId('hosted-bridge-error')).toContainText('/attest', {
		timeout: 20_000
	});

	// Picked from the list into the unlock form, then stopped from the list.
	await item.getByTestId('hosted-bridge-instance-pick').click();
	await expect(mac.page.getByTestId('hosted-bridge-instance')).toHaveValue(instance);
	await expect(mac.page.getByTestId('hosted-bridge-passphrase')).toBeVisible();
	mac.page.once('dialog', (dialog) => dialog.accept());
	await item.getByTestId('hosted-bridge-instance-stop').click();
	await expect(mac.page.getByTestId('hosted-bridge-vm')).toContainText('Gestoppt', {
		timeout: 60_000
	});
	expect(aleph.instances.get(instance)?.status).toBe('forgotten');
	await expect(item).toHaveCount(0);
});

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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeAleph } from '@belege/bridge/testing/aleph';
import {
	FAKE_POLICY,
	startFakeAttestAgent,
	startFakeAttestRelay
} from '@belege/bridge/testing/attest-agent';
import { acceptConsent } from './consent.js';
import { openIntegration } from './integrations.js';
import { device } from './devices.js';

const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const IMAGE = 'c9b39dcebd0ee3f0fc009be5da21ba2219c26bb646f8554c5535a794ff6fddea';
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

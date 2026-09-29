// The relay for own devices in the own network (issue #148, step 2c): where it
// may listen, its certificate, its address across restarts, the bridge's
// /lan-relay and `pnpm setup:relay`. Made-up addresses only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';

import {
	CERT_DAYS,
	hostProblem,
	isPrivateIPv4,
	lanAddresses,
	relayCertificate,
	startLanRelay,
	udpPortFree
} from '../src/lan-relay.js';
import { defaultConfig, loadConfig, saveConfig, withDefaults } from '../src/config.js';
import { runRelaySetup } from '../src/setup-relay.js';
import { startBridge } from '../src/index.js';
import { memoryKeychain } from '../src/keychain.js';
import { request } from './support/http.js';

const RELAY_MODULE = new URL('../src/lan-relay.js', import.meta.url).href;

/** A Mac with Wi-Fi in a home network, loopback, and a VPN with a public address. */
const INTERFACES = /** @type {any} */ ({
	lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
	en0: [
		{ family: 'IPv6', address: 'fe80::1', internal: false },
		{ family: 'IPv4', address: '192.168.10.23', internal: false }
	],
	utun4: [{ family: 'IPv4', address: '203.0.113.9', internal: false }]
});

describe('where the relay may listen', () => {
	test('private IPv4 addresses only', () => {
		for (const ip of ['10.0.0.1', '172.16.5.4', '172.31.255.1', '192.168.0.10']) {
			assert.equal(isPrivateIPv4(ip), true, ip);
		}
		for (const ip of ['0.0.0.0', '127.0.0.1', '172.32.0.1', '8.8.8.8', '192.169.0.1', '::', 'x']) {
			assert.equal(isPrivateIPv4(ip), false, ip);
		}
	});

	test('an address this Mac has now; never all, never public; loopback only for tests', () => {
		assert.deepEqual(lanAddresses(INTERFACES), [{ name: 'en0', address: '192.168.10.23' }]);
		assert.equal(hostProblem('192.168.10.23', { interfaces: INTERFACES }), null);
		assert.match(
			String(hostProblem('192.168.10.99', { interfaces: INTERFACES })),
			/not an address of this Mac/
		);
		assert.match(String(hostProblem('0.0.0.0', { interfaces: INTERFACES })), /private network/);
		assert.match(String(hostProblem('203.0.113.9', { interfaces: INTERFACES })), /private network/);
		assert.match(String(hostProblem('127.0.0.1', { interfaces: INTERFACES })), /private network/);
		assert.equal(hostProblem('127.0.0.1', { interfaces: INTERFACES, allowLoopback: true }), null);
	});
});

describe('the relay', () => {
	/** @type {string} */ let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-lan-relay-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('its own P-256 certificate, for ten years, made once, key kept 0600', async () => {
		const first = await relayCertificate(dir);
		const cert = new X509Certificate(first.pem);
		assert.equal(cert.publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1');
		const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000;
		assert.ok(Math.abs(days - CERT_DAYS) < 1, `${days} days`);
		assert.match(first.certhash, /^uEi[A-Za-z0-9_-]{44}$/);
		assert.equal((await stat(join(dir, 'cert-key.pem'))).mode & 0o077, 0);
		const again = await relayCertificate(dir);
		assert.equal(again.certhash, first.certhash);
		// Expired: a new one.
		const later = await relayCertificate(
			dir,
			() => new Date(Date.now() + (CERT_DAYS + 1) * 86_400_000)
		);
		assert.notEqual(later.certhash, first.certhash);
	});

	test('listens with WebRTC-Direct on the one address; the same address after a restart', async () => {
		// Each start in a process of its own, as the bridge restarts: node-datachannel
		// keeps its UDP listener past `stop()` on Linux.
		const state = join(dir, 'state');
		const start = () =>
			new Promise((resolve, reject) => {
				execFile(
					process.execPath,
					[
						'--input-type=module',
						'-e',
						`import { startLanRelay } from ${JSON.stringify(RELAY_MODULE)};
const r = await startLanRelay({ host: '127.0.0.1', port: 4996, dir: ${JSON.stringify(state)}, allowLoopback: true });
console.log(JSON.stringify({ addr: r.addr, stats: r.stats() }));
await r.stop();
process.exit(0);`
					],
					{ timeout: 30_000 },
					(error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout.trim())))
				);
			});
		const first = /** @type {any} */ (await start());
		assert.match(
			first.addr,
			/^\/ip4\/127\.0\.0\.1\/udp\/4996\/webrtc-direct\/certhash\/uEi[\w-]+\/p2p\/12D3KooW\w+$/
		);
		const again = /** @type {any} */ (await start());
		assert.equal(again.addr, first.addr);
		assert.deepEqual(again.stats, { reservations: 0, connections: 0 });
		assert.equal((await stat(state)).mode & 0o077, 0);
	});

	test('refuses what it must not listen on, and a port in use, before libp2p is asked', async () => {
		const options = {
			host: '127.0.0.1',
			port: 4995,
			dir: join(dir, 'refused'),
			allowLoopback: true
		};
		await assert.rejects(startLanRelay({ ...options, host: '0.0.0.0' }), /private network/);
		await assert.rejects(startLanRelay({ ...options, port: 80 }), /port/);
		const busy = createSocket('udp4');
		await new Promise((resolve) => busy.bind(4995, '127.0.0.1', () => resolve(undefined)));
		try {
			assert.equal(await udpPortFree('127.0.0.1', 4995), false);
			await assert.rejects(startLanRelay(options), /UDP 4995 on 127\.0\.0\.1 is in use/);
		} finally {
			busy.close();
		}
	});
});

describe('the bridge with the relay set up', () => {
	/** @type {string} */ let dir;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string[]} */ const printed = [];
	const APP = 'http://localhost:5173';

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-bridge-relay-'));
		const configPath = join(dir, 'bridge.json');
		await saveConfig(
			{ ...defaultConfig(), appOrigins: [APP], lanRelay: { host: '127.0.0.1', port: 4997 } },
			configPath
		);
		bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			port: 0,
			lanRelayLoopback: true,
			print: (l) => printed.push(l),
			log: () => {}
		});
	});
	after(async () => {
		await bridge?.close();
		await rm(dir, { recursive: true, force: true });
	});

	test('/health says it runs; /lan-relay, with a token, gives its address', async () => {
		const port = bridge.address.port;
		const health = await request(port, '/health', { headers: { origin: APP } });
		assert.deepEqual(health.json.lanRelay, { configured: true, running: true });
		assert.equal((await request(port, '/lan-relay', { headers: { origin: APP } })).status, 401);
		const code = printed.map((l) => /Pairing code[^:]*: (\S+)/.exec(l)?.[1]).find(Boolean);
		const paired = await request(port, '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code: String(code) }
		});
		const res = await request(port, '/lan-relay', {
			headers: { origin: APP, authorization: `Bearer ${paired.json.token}` }
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.running, true);
		assert.equal(res.json.addr, bridge.lanRelay?.addr);
		assert.match(res.json.addr, /\/udp\/4997\/webrtc-direct\/certhash\//);
		assert.ok(dir && (await stat(join(dir, 'lan-relay', 'cert.pem'))));
	});
});

describe('pnpm setup:relay', () => {
	/** @type {string} */ let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'belege-setup-relay-'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('an address of this Mac and a port into bridge.json; --off clears it', async () => {
		const configPath = join(dir, 'bridge.json');
		/** @type {string[]} */
		const out = [];
		const answers = ['1', '5010'];
		const io = {
			ask: async () => answers.shift() ?? '',
			print: (/** @type {string} */ l) => out.push(l)
		};
		assert.equal(await runRelaySetup({ io, configPath, interfaces: INTERFACES }), true);
		assert.deepEqual((await loadConfig(configPath)).lanRelay, {
			host: '192.168.10.23',
			port: 5010
		});
		assert.ok(out.some((l) => l.includes('192.168.10.23 (en0)')));
		assert.ok(!out.some((l) => l.includes('203.0.113.9')), 'no public address offered');
		assert.equal(await runRelaySetup({ io, configPath, off: true }), true);
		assert.equal((await loadConfig(configPath)).lanRelay.host, null);
		assert.ok(JSON.parse(await readFile(configPath, 'utf8')).lanRelay);
	});

	test('bridge.json with a broken entry: off, default port', () => {
		assert.deepEqual(withDefaults({ lanRelay: { host: 'my-mac', port: 80 } }).lanRelay, {
			host: null,
			port: 4990
		});
	});
});

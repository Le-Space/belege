// The bridge end to end in-process: a fake Hibiscus over HTTPS, the real
// config/pairing/server wiring, a fake keychain.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../src/index.js';
import { saveConfig, defaultConfig } from '../src/config.js';
import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { memoryKeychain } from '../src/keychain.js';
import { FAKE_PASSWORD, startFakeHibiscus } from './support/fake-hibiscus.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

describe('bridge server', () => {
	/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string} */ let dir;
	/** @type {string} */ let configPath;
	/** @type {string[]} */ const printed = [];
	const keychain = memoryKeychain(FAKE_PASSWORD);
	/** @type {string} */ let token;

	before(async () => {
		hibiscus = await startFakeHibiscus();
		dir = await mkdtemp(join(tmpdir(), 'belege-bridge-'));
		configPath = join(dir, 'bridge.json');
		await saveConfig(
			{
				...defaultConfig(),
				appOrigins: [APP],
				hibiscus: {
					host: hibiscus.host,
					port: hibiscus.port,
					certSha256: hibiscus.fingerprint,
					ibanSuffixes: ['4711']
				}
			},
			configPath
		);
		bridge = await startBridge({
			configPath,
			keychain,
			port: 0,
			print: (l) => printed.push(l),
			log: () => {}
		});
	});

	after(async () => {
		await bridge?.close();
		await hibiscus?.close();
		await rm(dir, { recursive: true, force: true });
	});

	const port = () => bridge.address.port;
	const auth = () => ({ authorization: `Bearer ${token}` });

	test('listens on 127.0.0.1 and nowhere else', async () => {
		assert.equal(bridge.address.host, '127.0.0.1');
		const other = createBridgeServer({
			config: defaultConfig(),
			pairing: createPairing({ getHashes: () => [], saveHashes: async () => {} }),
			hibiscus: null
		});
		for (const host of ['0.0.0.0', '::', '192.168.1.10', 'localhost']) {
			await assert.rejects(other.listen({ host, port: 0 }), /127\.0\.0\.1 only/, host);
		}
		assert.equal(other.server.listening, false);
	});

	test('health needs no token and says it is not paired yet', async () => {
		const res = await request(port(), '/health', { headers: { origin: APP } });
		assert.equal(res.status, 200);
		assert.equal(res.json.paired, false);
		assert.equal(res.json.hibiscus.configured, true);
		assert.equal(res.headers['access-control-allow-origin'], APP);
	});

	test('everything but /health and /pair needs a token', async () => {
		for (const path of [
			'/hibiscus/accounts',
			'/hibiscus/transactions?account=1&since=2026-01-01',
			'/nothing'
		]) {
			const res = await request(port(), path, { headers: { origin: APP } });
			assert.equal(res.status, 401, path);
			const forged = await request(port(), path, {
				headers: { origin: APP, authorization: 'Bearer ' + 'A'.repeat(43) }
			});
			assert.equal(forged.status, 401, `${path} with a made-up token`);
		}
		assert.equal(hibiscus.requests.length, 0, 'nothing reached Hibiscus');
		assert.equal(keychain.reads, 0, 'the keychain was not asked');
	});

	test('pairing: wrong code refused, right code gives a token once, only its hash is stored', async () => {
		const code = printed.map((l) => /Pairing code[^:]*: (\S+)/.exec(l)?.[1]).find(Boolean);
		assert.match(String(code), /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);

		const wrong = await request(port(), '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code: 'ZZZZ-ZZZZ' }
		});
		assert.equal(wrong.status, 403);

		const res = await request(port(), '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code: String(code).toLowerCase() }
		});
		assert.equal(res.status, 200);
		token = res.json.token;
		assert.equal(Buffer.from(token, 'base64url').length, 32);

		const again = await request(port(), '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code }
		});
		assert.equal(again.status, 410, 'the code works once');

		const stored = await readFile(configPath, 'utf8');
		assert.equal(stored.includes(token), false, 'the token itself is not on disk');
		assert.equal(JSON.parse(stored).pairedTokens.length, 1);
		assert.equal((await stat(configPath)).mode & 0o777, 0o600);
		assert.equal((await request(port(), '/health')).json.paired, true);
	});

	test('CORS: a foreign origin gets 403 and no CORS headers, with or without a token', async () => {
		for (const origin of [
			'https://evil.example',
			'http://localhost:5174',
			'null',
			'http://127.0.0.1:5173'
		]) {
			for (const path of ['/health', '/hibiscus/accounts']) {
				const res = await request(port(), path, { headers: { origin, ...auth() } });
				assert.equal(res.status, 403, `${origin} ${path}`);
				assert.equal(res.headers['access-control-allow-origin'], undefined);
			}
			const preflight = await request(port(), '/hibiscus/accounts', {
				method: 'OPTIONS',
				headers: {
					origin,
					'access-control-request-method': 'GET',
					'access-control-request-headers': 'authorization'
				}
			});
			assert.equal(preflight.status, 403);
			assert.equal(preflight.headers['access-control-allow-origin'], undefined);
		}
		const ok = await request(port(), '/hibiscus/accounts', {
			method: 'OPTIONS',
			headers: {
				origin: APP,
				'access-control-request-method': 'GET',
				'access-control-request-private-network': 'true'
			}
		});
		assert.equal(ok.status, 204);
		assert.equal(ok.headers['access-control-allow-origin'], APP);
		assert.match(String(ok.headers['access-control-allow-headers']), /Authorization/);
		assert.equal(ok.headers['access-control-allow-private-network'], 'true');
	});

	test('a Host other than the loopback address is refused (DNS rebinding)', async () => {
		const res = await request(port(), '/health', { headers: { host: `evil.example:${port()}` } });
		assert.equal(res.status, 421);
	});

	test('accounts: only the allowed suffix leaves the bridge, IBAN masked', async () => {
		const res = await request(port(), '/hibiscus/accounts', {
			headers: { origin: APP, ...auth() }
		});
		assert.equal(res.status, 200);
		assert.deepEqual(
			res.json.accounts.map((/** @type {any} */ a) => [a.id, a.ibanMasked, a.ibanLast4]),
			[['1', 'DE00 **** 4711', '4711']]
		);
		assert.equal(res.json.accounts[0].balanceCents, 123456);
		for (const secret of [
			'9999',
			'Privatkonto',
			'Geheim',
			'DE00 0000 0000 0000 0047 11',
			'DE00000000000000004711'
		]) {
			assert.equal(res.text.includes(secret), false, secret);
		}
		assert.ok(keychain.reads > 0, 'the password came from the keychain');
		assert.ok(hibiscus.requests.every((r) => r.authorized));
	});

	test('transactions: normalised, since honoured, from the allowed account only', async () => {
		const res = await request(port(), '/hibiscus/transactions?account=1&since=2026-09-01', {
			headers: { origin: APP, ...auth() }
		});
		assert.equal(res.status, 200);
		const txs = res.json.transactions;
		assert.deepEqual(
			txs.map((/** @type {any} */ t) => [t.sourceId, t.date, t.amountCents]),
			[
				['101', '2026-09-22', -2242],
				['102', '2026-09-22', 143976]
			]
		);
		assert.match(txs[0].fingerprint, /^fp1:/);
		assert.equal(txs[0].counterpartyName, 'Kaffeerösterei Nordlicht GmbH');

		const all = await request(port(), '/hibiscus/transactions?account=1&since=2026-01-01', {
			headers: { origin: APP, ...auth() }
		});
		assert.equal(all.json.transactions.length, 3);
	});

	test('a filtered-out account is unknown, and its transactions are never asked for', async () => {
		const before = hibiscus.requests.length;
		const res = await request(port(), '/hibiscus/transactions?account=2&since=2026-01-01', {
			headers: { origin: APP, ...auth() }
		});
		assert.equal(res.status, 404);
		assert.equal(res.text.includes('Geheim'), false);
		const asked = hibiscus.requests.slice(before).map((r) => r.method);
		assert.deepEqual(
			asked,
			['hibiscus.xmlrpc.konto.find'],
			'only the account list, no umsatz.list'
		);
		assert.equal(
			hibiscus.requests.some(
				(r) =>
					r.method === 'hibiscus.xmlrpc.umsatz.list' && JSON.stringify(r.params).includes('"2"')
			),
			false
		);
	});

	test('bad parameters are refused before Hibiscus is asked', async () => {
		const before = hibiscus.requests.length;
		for (const path of [
			'/hibiscus/transactions?account=1',
			'/hibiscus/transactions?account=1&since=22.09.2026',
			'/hibiscus/transactions?since=2026-01-01'
		]) {
			const res = await request(port(), path, { headers: { origin: APP, ...auth() } });
			assert.equal(res.status, 400, path);
		}
		assert.equal(hibiscus.requests.length, before);
	});

	// Last on purpose: it ends the pairing the other tests use.
	test('unpair: needs the token, forgets it on the bridge and on disk', async () => {
		assert.equal(
			(await request(port(), '/unpair', { method: 'POST', headers: { origin: APP } })).status,
			401
		);
		const res = await request(port(), '/unpair', {
			method: 'POST',
			headers: { origin: APP, ...auth() }
		});
		assert.equal(res.status, 200);
		assert.equal(
			(await request(port(), '/hibiscus/accounts', { headers: { origin: APP, ...auth() } })).status,
			401,
			'the token is dead at once'
		);
		assert.equal(JSON.parse(await readFile(configPath, 'utf8')).pairedTokens.length, 0);
		assert.equal((await request(port(), '/health')).json.paired, false);
	});
});

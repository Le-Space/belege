// setup:kraken and the /kraken routes, end to end in-process against a fake
// Kraken on 127.0.0.1 and a fake keychain. All data made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../src/index.js';
import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { runKrakenSetup } from '../src/setup-kraken.js';
import { FAKE_KRAKEN_KEY, FAKE_KRAKEN_SECRET, startFakeKraken } from './support/fake-kraken.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

/** @type {string} */ let dir;
/** @type {Awaited<ReturnType<typeof startFakeKraken>>} */ let kraken;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-kraken-'));
	kraken = await startFakeKraken();
});
after(async () => {
	await kraken?.close();
	await rm(dir, { recursive: true, force: true });
});

/** @param {string[]} hidden */
function io(hidden) {
	/** @type {string[]} */ const out = [];
	return {
		out,
		io: {
			askHidden: async () => hidden.shift() ?? '',
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

describe('setup:kraken', () => {
	test('stores the key in the keychain, only the flag in the config, and prints no amount', async () => {
		const configPath = join(dir, 'setup.json');
		await saveConfig(
			{ ...defaultConfig(), kraken: { configured: false, baseUrl: kraken.url } },
			configPath
		);
		const keychain = memoryKeychain(null, 'kraken');
		const { io: prompts, out } = io([FAKE_KRAKEN_KEY, FAKE_KRAKEN_SECRET]);

		assert.equal(await runKrakenSetup({ io: prompts, keychain, configPath }), true);
		assert.deepEqual(JSON.parse(await keychain.read()), {
			key: FAKE_KRAKEN_KEY,
			secret: FAKE_KRAKEN_SECRET
		});
		const text = await readFile(configPath, 'utf8');
		assert.equal((await loadConfig(configPath)).kraken.configured, true);
		assert.doesNotMatch(text, new RegExp(FAKE_KRAKEN_KEY));
		assert.ok(out.some((l) => /5 asset\(s\)/.test(l)));
		assert.ok(
			out.every((l) => !/98\.35|0\.007/.test(l)),
			'no balance is printed'
		);
	});

	test('takes the key from .env when the person says yes, and says it can go from there', async () => {
		const configPath = join(dir, 'env.json');
		await saveConfig(
			{ ...defaultConfig(), kraken: { configured: false, baseUrl: kraken.url } },
			configPath
		);
		const keychain = memoryKeychain(null, 'kraken');
		/** @type {string[]} */ const out = [];
		let hiddenAsked = false;
		const ok = await runKrakenSetup({
			io: {
				ask: async () => '',
				askHidden: async () => {
					hiddenAsked = true;
					return '';
				},
				print: (line) => out.push(line)
			},
			keychain,
			configPath,
			env: { KRAKEN_API_KEY: FAKE_KRAKEN_KEY, KRAKEN_PRIVATE_KEY: FAKE_KRAKEN_SECRET }
		});
		assert.equal(ok, true);
		assert.equal(hiddenAsked, false);
		assert.equal(JSON.parse(await keychain.read()).key, FAKE_KRAKEN_KEY);
		assert.ok(out.some((l) => /delete KRAKEN_API_KEY/.test(l)));
		assert.ok(out.every((l) => !l.includes(FAKE_KRAKEN_KEY) && !l.includes(FAKE_KRAKEN_SECRET)));
	});

	test('a key Kraken refuses is not stored', async () => {
		const configPath = join(dir, 'refused.json');
		await saveConfig(
			{ ...defaultConfig(), kraken: { configured: false, baseUrl: kraken.url } },
			configPath
		);
		const keychain = memoryKeychain(null, 'kraken');
		const { io: prompts, out } = io(['not-the-key', FAKE_KRAKEN_SECRET]);
		assert.equal(await runKrakenSetup({ io: prompts, keychain, configPath }), false);
		await assert.rejects(keychain.read());
		assert.equal((await loadConfig(configPath)).kraken.configured, false);
		assert.ok(out.some((l) => /did not accept/.test(l)));
	});

	test('something that is no private key is refused before any call', async () => {
		const configPath = join(dir, 'malformed.json');
		await saveConfig(
			{ ...defaultConfig(), kraken: { configured: false, baseUrl: kraken.url } },
			configPath
		);
		let called = false;
		const { io: prompts } = io([FAKE_KRAKEN_KEY, 'abc']);
		const ok = await runKrakenSetup({
			io: prompts,
			keychain: memoryKeychain(null, 'kraken'),
			configPath,
			check: async () => {
				called = true;
				return 0;
			}
		});
		assert.equal(ok, false);
		assert.equal(called, false);
	});
});

describe('/kraken routes', () => {
	test('need Kraken set up, a token, and a day; answer balances and the ledger', async () => {
		const configPath = join(dir, 'bridge.json');
		await saveConfig(
			{ ...defaultConfig(), appOrigins: [APP], kraken: { configured: true, baseUrl: kraken.url } },
			configPath
		);
		/** @type {string[]} */ const printed = [];
		/** @type {string[]} */ const logged = [];
		const bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			krakenKeychain: memoryKeychain(
				JSON.stringify({ key: FAKE_KRAKEN_KEY, secret: FAKE_KRAKEN_SECRET }),
				'kraken'
			),
			coingeckoKeychain: memoryKeychain(null, 'coingecko'),
			krakenPageDelayMs: 0,
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logged.push(l)
		});
		try {
			const port = bridge.address.port;
			const health = await request(port, '/health', { headers: { origin: APP } });
			assert.equal(health.json.kraken.configured, true);

			const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
			assert.ok(code, 'a pairing code was printed');
			const paired = await request(port, '/pair', {
				method: 'POST',
				headers: { origin: APP },
				body: { code }
			});
			const auth = { origin: APP, authorization: `Bearer ${paired.json.token}` };

			assert.equal(
				(await request(port, '/kraken/balances', { headers: { origin: APP } })).status,
				401
			);
			const balances = await request(port, '/kraken/balances', { headers: auth });
			assert.equal(balances.status, 200);
			assert.equal(balances.json.balances.length, 5);

			assert.equal(
				(await request(port, '/kraken/ledgers?since=1.9.2026', { headers: auth })).status,
				400
			);
			const ledgers = await request(port, '/kraken/ledgers?since=2026-09-01', { headers: auth });
			assert.equal(ledgers.status, 200);
			assert.equal(ledgers.json.entries.length, 8 + 20);
			assert.equal(ledgers.json.transferRefs, 'ok');
			assert.ok(
				logged.every((l) => !/600\.0000|0\.01000/.test(l)),
				'no amount in the log'
			);
		} finally {
			await bridge.close();
		}
	});

	test('without setup:kraken, the routes say what to run', async () => {
		const configPath = join(dir, 'none.json');
		await saveConfig({ ...defaultConfig(), appOrigins: [APP] }, configPath);
		/** @type {string[]} */ const printed = [];
		const bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			krakenKeychain: memoryKeychain(null, 'kraken'),
			coingeckoKeychain: memoryKeychain(null, 'coingecko'),
			port: 0,
			print: (l) => printed.push(l),
			log: () => {}
		});
		try {
			const port = bridge.address.port;
			const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
			const paired = await request(port, '/pair', {
				method: 'POST',
				headers: { origin: APP },
				body: { code }
			});
			const res = await request(port, '/kraken/balances', {
				headers: { origin: APP, authorization: `Bearer ${paired.json.token}` }
			});
			assert.equal(res.status, 503);
			assert.match(res.json.error, /setup:kraken/);
		} finally {
			await bridge.close();
		}
	});
});

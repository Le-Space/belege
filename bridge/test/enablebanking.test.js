// Enable Banking, step 1 (issue #224): the signed client, the sealed key, the
// setup and /health. Against a fake that checks what the real one checks.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, withDefaults } from '../src/config.js';
import {
	createEnableBankingClient,
	EnableBankingError,
	enableBankingSecrets,
	isApplicationId,
	parsePrivateKey,
	signJwt
} from '../src/enablebanking.js';
import { memoryKeychain } from '../src/keychain.js';
import { sealedFile } from '../src/sealed-file.js';
import { runEnableBankingSetup } from '../src/setup-enablebanking.js';
import { startBridge } from '../src/index.js';
import {
	FAKE_EB_APP_ID,
	FAKE_EB_PRIVATE_KEY,
	startFakeEnableBanking
} from './support/fake-enablebanking.js';
import { request } from './support/http.js';

/** @type {Awaited<ReturnType<typeof startFakeEnableBanking>>} */ let eb;
/** @type {string} */ let dir;

before(async () => {
	eb = await startFakeEnableBanking();
	dir = await mkdtemp(join(tmpdir(), 'belege-eb-'));
});
after(async () => {
	await eb?.close();
	await rm(dir, { recursive: true, force: true });
});

const client = (
	/** @type {Partial<Parameters<typeof createEnableBankingClient>[0]>} */ over = {}
) =>
	createEnableBankingClient({
		appId: FAKE_EB_APP_ID,
		baseUrl: eb.url,
		getPrivateKey: async () => FAKE_EB_PRIVATE_KEY,
		...over
	});

test('a signed request is accepted, and the application is read', async () => {
	assert.deepEqual(await client().application(), {
		name: 'Beispiel Belege',
		environment: 'SANDBOX',
		active: true,
		redirectUrls: ['https://belege.le-space.de/integrationen/bank/verbunden']
	});
});

test('the token: RS256, the application as kid, ten minutes, Enable Banking as audience', () => {
	const jwt = signJwt({
		appId: FAKE_EB_APP_ID,
		key: parsePrivateKey(FAKE_EB_PRIVATE_KEY),
		now: 1_000_000_000
	});
	const [head, body] = jwt
		.split('.')
		.slice(0, 2)
		.map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
	assert.deepEqual(head, { typ: 'JWT', alg: 'RS256', kid: FAKE_EB_APP_ID });
	assert.deepEqual(body, {
		iss: 'enablebanking.com',
		aud: 'api.enablebanking.com',
		iat: 1_000_000,
		exp: 1_000_600
	});
});

test('another key, another application or a stale clock is refused, in plain words', async () => {
	const other = /** @type {string} */ (
		generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
			type: 'pkcs8',
			format: 'pem'
		})
	);
	for (const over of [
		{ getPrivateKey: async () => other },
		{ appId: '11111111-1111-4111-8111-111111111111' },
		{ now: () => Date.now() - 3600_000 }
	]) {
		await assert.rejects(client(over).application(), (/** @type {any} */ e) => {
			assert.ok(e instanceof EnableBankingError);
			assert.equal(e.code, 'EB_AUTH');
			assert.equal(e.status, 503);
			assert.equal(e.providerCode, 'UNAUTHORIZED');
			assert.match(e.message, /setup:enablebanking/);
			assert.doesNotMatch(e.message, /JWT refused/, 'their message is not passed on');
			return true;
		});
	}
	assert.deepEqual(eb.state.refused.slice(-3), ['signature', 'unknown application', 'expired']);
});

test('only an RSA key of 2048 bits or more signs; the error never echoes the input', () => {
	const ec = /** @type {string} */ (
		generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
			type: 'pkcs8',
			format: 'pem'
		})
	);
	assert.throws(() => parsePrivateKey(ec), /not an RSA key/);
	assert.throws(
		() => parsePrivateKey('not-a-key-but-secret-text'),
		(/** @type {any} */ e) => {
			assert.equal(e.code, 'EB_KEY');
			assert.doesNotMatch(e.message, /secret-text/);
			return true;
		}
	);
	assert.equal(isApplicationId(FAKE_EB_APP_ID), true);
	assert.equal(isApplicationId('beispiel'), false);
});

test('one host only: no redirect is followed, no other origin, no huge answer', async () => {
	await assert.rejects(client().request('GET', '/moved'), /redirect \(HTTP 302\); not followed/);
	await assert.rejects(client().request('GET', '//evil.example/x'), /Not a path/);
	await assert.rejects(client().request('GET', 'https://evil.example/x'), /Not a path/);
	await assert.rejects(client({ maxBytes: 1024 }).request('GET', '/huge'), /too large/);
});

test('a rate limit and an absent server say so', async () => {
	const limited = await startFakeEnableBanking({ rateLimit: 0 });
	try {
		await assert.rejects(client({ baseUrl: limited.url }).application(), (/** @type {any} */ e) => {
			assert.equal(e.code, 'EB_RATE_LIMIT');
			assert.equal(e.status, 429);
			return true;
		});
	} finally {
		await limited.close();
	}
	await assert.rejects(
		client({ baseUrl: 'http://127.0.0.1:1' }).application(),
		(/** @type {any} */ e) => {
			assert.equal(e.code, 'EB_UNAVAILABLE');
			return true;
		}
	);
});

test('the sealed file: opens with its key only, 0600, and not as another purpose', async () => {
	const keychain = memoryKeychain(null, 'enablebanking');
	const path = join(dir, 'sealed-test.sealed');
	const file = sealedFile({ path, keychain, label: 'enablebanking' });
	await file.write({ privateKey: 'made-up', sessions: {} });
	assert.deepEqual(await file.read(), { privateKey: 'made-up', sessions: {} });
	assert.doesNotMatch(await readFile(path, 'utf8'), /made-up/);
	if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.match(await keychain.read(), /^[0-9a-f]{64}$/);

	await assert.rejects(sealedFile({ path, keychain, label: 'other' }).read(), /does not open/);
	await assert.rejects(
		sealedFile({ path, keychain: memoryKeychain('0'.repeat(64)), label: 'enablebanking' }).read(),
		/does not open/
	);
	await file.remove();
	await assert.rejects(file.read(), (/** @type {any} */ e) => e.code === 'SEALED_MISSING');
});

/** @param {string[]} answers */
function scripted(answers) {
	/** @type {string[]} */ const out = [];
	return {
		out,
		io: {
			ask: async () => answers.shift() ?? '',
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

/** A config pointing at the fake, as a test would write it. */
async function fakeConfig(/** @type {string} */ name) {
	const configPath = join(dir, name, 'bridge.json');
	const config = withDefaults({ enablebanking: { baseUrl: eb.url } });
	const { saveConfig } = await import('../src/config.js');
	await saveConfig(config, configPath);
	return configPath;
}

test('setup: the key is checked, sealed beside the config, and never printed', async () => {
	const configPath = await fakeConfig('setup-ok');
	const keyPath = join(dir, 'app.pem');
	await writeFile(keyPath, FAKE_EB_PRIVATE_KEY);
	const keychain = memoryKeychain(null, 'enablebanking');
	const { io, out } = scripted([FAKE_EB_APP_ID, keyPath, '']);
	assert.equal(await runEnableBankingSetup({ io, keychain, configPath }), true);

	const config = await loadConfig(configPath);
	assert.deepEqual(config.enablebanking, {
		configured: true,
		appId: FAKE_EB_APP_ID,
		baseUrl: eb.url,
		redirectUrl: 'https://belege.le-space.de/integrationen/bank/verbunden',
		ibanSuffixes: []
	});
	const raw = await readFile(configPath, 'utf8');
	assert.doesNotMatch(raw, /PRIVATE KEY/);
	const sealed = await enableBankingSecrets({ configPath, keychain }).read();
	assert.equal(sealed.privateKey, FAKE_EB_PRIVATE_KEY);
	assert.deepEqual(sealed.sessions, {});
	assert.ok(
		out.some((l) => /The key works: application "Beispiel Belege", SANDBOX, active/.test(l))
	);
	assert.ok(!out.join('\n').includes('PRIVATE KEY'));
	assert.ok(!out.some((l) => /not among/.test(l)), 'the default redirect is registered');
});

test('setup: an unregistered redirect URL is saved, with a note to add it', async () => {
	const configPath = await fakeConfig('setup-redirect');
	const keychain = memoryKeychain(null, 'enablebanking');
	const { io, out } = scripted([
		FAKE_EB_APP_ID,
		'/key.pem',
		'https://belege.example/integrationen/bank/verbunden'
	]);
	assert.equal(
		await runEnableBankingSetup({
			io,
			keychain,
			configPath,
			readKeyFile: async () => FAKE_EB_PRIVATE_KEY
		}),
		true
	);
	assert.ok(out.some((l) => /is not among the application's redirect URLs/.test(l)));
});

test('setup: a wrong id, a wrong file, a refused key or a plain-http redirect change nothing', async () => {
	const other = /** @type {string} */ (
		generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
			type: 'pkcs8',
			format: 'pem'
		})
	);
	const cases = [
		{ answers: ['beispiel'], file: FAKE_EB_PRIVATE_KEY, says: /not an application id/ },
		{ answers: [FAKE_EB_APP_ID, '/key.pem'], file: 'kein Schlüssel', says: /not a private key/ },
		{
			answers: [FAKE_EB_APP_ID, '/public.crt'],
			file: '-----BEGIN CERTIFICATE-----\nMIIBbeispiel\n-----END CERTIFICATE-----\n',
			says: /That is the public certificate/
		},
		{ answers: [FAKE_EB_APP_ID, '/key.pem', ''], file: other, says: /did not accept the key/ },
		{
			answers: [FAKE_EB_APP_ID, '/key.pem', 'http://belege.example/zurueck'],
			file: FAKE_EB_PRIVATE_KEY,
			says: /redirect URL is https/
		}
	];
	for (const [i, c] of cases.entries()) {
		const configPath = await fakeConfig(`setup-no-${i}`);
		const keychain = memoryKeychain(null, 'enablebanking');
		const { io, out } = scripted([...c.answers]);
		assert.equal(
			await runEnableBankingSetup({ io, keychain, configPath, readKeyFile: async () => c.file }),
			false
		);
		assert.ok(
			out.some((l) => c.says.test(l)),
			out.join('\n')
		);
		assert.equal((await loadConfig(configPath)).enablebanking.configured, false);
		await assert.rejects(keychain.read());
	}
});

test('/health says whether Enable Banking is set up', async () => {
	const configPath = await fakeConfig('bridge');
	const keychain = memoryKeychain(null, 'enablebanking');
	const { io } = scripted([FAKE_EB_APP_ID, '/key.pem', '']);
	await runEnableBankingSetup({
		io,
		keychain,
		configPath,
		readKeyFile: async () => FAKE_EB_PRIVATE_KEY
	});

	const bridge = await startBridge({
		configPath,
		enablebankingKeychain: keychain,
		keychain: memoryKeychain(),
		mailKeychain: memoryKeychain(),
		llmKeychain: memoryKeychain(),
		krakenKeychain: memoryKeychain(),
		coingeckoKeychain: memoryKeychain(),
		bitcoinKeychain: memoryKeychain(),
		alchemyKeychain: memoryKeychain(),
		port: 0,
		print: () => {},
		log: () => {}
	});
	try {
		const health = await request(bridge.address.port, '/health');
		assert.deepEqual(health.json.enablebanking, { configured: true });
	} finally {
		await bridge.close();
	}
});

test('setup: a quoted or $HOME path is read; a missing file says where it looked', async () => {
	const configPath = await fakeConfig('setup-paths');
	const keyPath = join(dir, 'mit leerzeichen.pem');
	await writeFile(keyPath, FAKE_EB_PRIVATE_KEY);
	const quoted = scripted([FAKE_EB_APP_ID, `'${keyPath}'`, '']);
	assert.equal(
		await runEnableBankingSetup({
			io: quoted.io,
			keychain: memoryKeychain(null, 'enablebanking'),
			configPath
		}),
		true
	);
	const missing = scripted([FAKE_EB_APP_ID, join(dir, 'gibt-es-nicht.pem')]);
	assert.equal(
		await runEnableBankingSetup({
			io: missing.io,
			keychain: memoryKeychain(null, 'enablebanking'),
			configPath: await fakeConfig('setup-missing')
		}),
		false
	);
	assert.ok(missing.out.some((l) => /gibt-es-nicht\.pem: there is no file there/.test(l)));
});

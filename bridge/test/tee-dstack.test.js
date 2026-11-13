// The hosted bridge on dstack (#696): what the start sends is sorted into the
// same layout as on Aleph (#583), unknown names are dropped, the hosted
// settings win over the owner's config; the secrets reach only the VM whose
// own key is in its quote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	enclaveLlm,
	hostedConfig,
	parseSecrets,
	peerKeyFrom,
	sortSecrets,
	startFrom
} from '../tee/dstack/sort-secrets.mjs';
import { register, reportData } from '../tee/dstack/registrar.mjs';
import { intakeKey, intakeKeyFromSeed, openSecrets, sealSecrets } from '../tee/dstack/intake.mjs';

test('only the names the hosted bridge knows are kept', () => {
	const got = parseSecrets(
		JSON.stringify({
			imap: 'pw',
			portal_wolkenfabrik: 'x',
			bridge_config: '{}',
			bridge_peer_key: 'AA==',
			enablebanking_sealed: 's',
			// Kept here; written only beside a model in the enclave (sortSecrets).
			llm: 'key',
			'../etc/passwd': 'x',
			PORTAL_X: 'upper case is not a name',
			portal__x: 'not a name keychain.js takes',
			portal_x_: 'nor this',
			portal_local_shop: 'kept',
			kraken: 42
		})
	);
	assert.deepEqual(Object.keys(got).sort(), [
		'bridge_config',
		'bridge_peer_key',
		'enablebanking_sealed',
		'imap',
		'llm',
		'portal_local_shop',
		'portal_wolkenfabrik'
	]);
});

test('nothing sent, or nonsense: no secrets', () => {
	assert.deepEqual(parseSecrets(undefined), {});
	assert.deepEqual(parseSecrets(''), {});
	assert.throws(() => parseSecrets('not json'), /not JSON/);
	assert.throws(() => parseSecrets('[1]'), /not an object/);
});

test('an account over 64 KiB is dropped; the config and the sealed file may be larger', () => {
	assert.deepEqual(parseSecrets(JSON.stringify({ imap: 'x'.repeat(64 * 1024 + 1) })), {});
	const big = 'x'.repeat(200 * 1024);
	assert.deepEqual(
		Object.keys(parseSecrets(JSON.stringify({ bridge_config: big, enablebanking_sealed: big }))),
		['bridge_config', 'enablebanking_sealed']
	);
	assert.deepEqual(parseSecrets(JSON.stringify({ bridge_config: 'x'.repeat(256 * 1024 + 1) })), {});
});

test('a peer key that is not clean base64 is dropped, so the bridge makes its own', () => {
	assert.deepEqual([...(peerKeyFrom('CAESQA==') ?? [])], [8, 1, 18, 64]);
	assert.deepEqual([...(peerKeyFrom(' CAES\nQA== ') ?? [])], [8, 1, 18, 64]);
	assert.equal(peerKeyFrom('not base64!'), null);
	assert.equal(peerKeyFrom('CAESQA'), null);
	assert.equal(peerKeyFrom('CAESQB=='), null);
	assert.equal(peerKeyFrom(''), null);
});

test('the hosted settings win: fixed ports, nothing announced, no language model', () => {
	const config = hostedConfig(
		JSON.stringify({
			llm: { provider: 'x' },
			lanRelay: { enabled: true },
			pairedTokens: ['00'],
			mail: { host: 'imap.example.com' },
			bridge: { port: 1, origins: ['https://example.com'] },
			node: { wsPort: 1, announce: ['/dns4/example.com/tcp/443/tls/ws'], relays: ['r'] }
		})
	);
	assert.equal(config.llm, undefined);
	assert.equal(config.lanRelay, undefined);
	assert.equal(config.pairedTokens, undefined);
	assert.deepEqual(config.mail, { host: 'imap.example.com' });
	assert.deepEqual(config.bridge, { port: 8765, origins: ['https://example.com'] });
	assert.deepEqual(config.node, { wsPort: 9097, announce: [], relays: ['r'], enabled: true });
	assert.deepEqual(hostedConfig('not json').node, { enabled: true, wsPort: 9097, announce: [] });
	assert.deepEqual(hostedConfig('{"bridge":[1]}').bridge, { port: 8765 });
});

test('sorted into the run directory, readable by the owner only', async () => {
	const run = await mkdtemp(join(tmpdir(), 'belege-tee-'));
	try {
		const r = sortSecrets(run, {
			BELEGE_BRIDGE_SECRETS: JSON.stringify({
				imap: 'pw',
				bridge_peer_key: Buffer.from([8, 1, 18, 64]).toString('base64'),
				bridge_config: '{"node":{}}'
			})
		});
		assert.deepEqual(r, { accounts: 1, peerKey: true, config: true, start: false, llm: false });
		assert.deepEqual(await readdir(join(run, 'secrets')), ['imap']);
		assert.equal(await readFile(join(run, 'secrets', 'imap'), 'utf8'), 'pw');
		assert.deepEqual([...(await readFile(join(run, 'node', 'peer-key')))], [8, 1, 18, 64]);
		assert.equal((await stat(join(run, 'secrets', 'imap'))).mode & 0o777, 0o600);
		assert.equal((await stat(join(run, 'secrets'))).mode & 0o777, 0o700);
		assert.equal(JSON.parse(await readFile(join(run, 'bridge.json'), 'utf8')).bridge.port, 8765);
		const broken = await mkdtemp(join(tmpdir(), 'belege-tee-'));
		assert.equal(
			sortSecrets(broken, { BELEGE_BRIDGE_SECRETS: JSON.stringify({ bridge_peer_key: '%%%' }) })
				.peerKey,
			false
		);
		assert.deepEqual(await readdir(join(broken, 'node')), []);
		await rm(broken, { recursive: true, force: true });
	} finally {
		await rm(run, { recursive: true, force: true });
	}
});

// A pin as setup:llm writes it (#416), made up.
const PIN = {
	provider: 'libertai',
	itemHash: 'ab'.repeat(32),
	measurement: 'cd'.repeat(48),
	sourceCommit: null,
	pinnedAt: '2026-11-01T00:00:00.000Z'
};
const ENCLAVE = {
	baseUrl: 'https://api.libertai.io/v1',
	model: 'test-model-tee',
	retryModel: 'test-model-tee',
	redactTerms: ['Erika Mustermann'],
	redaction: 'off',
	configured: true,
	tee: PIN
};

test('a model only in LibertAI’s attested enclave, pinned (#754)', () => {
	assert.deepEqual(enclaveLlm(ENCLAVE), ENCLAVE);
	assert.equal(hostedConfig(JSON.stringify({ llm: ENCLAVE })).llm?.tee.itemHash, PIN.itemHash);
	// No pin, another provider, a broken pin, another host, plain http: no model.
	for (const llm of [
		{ ...ENCLAVE, tee: null },
		{ ...ENCLAVE, tee: { ...PIN, provider: 'other' } },
		{ ...ENCLAVE, tee: { ...PIN, itemHash: 'xyz' } },
		{ ...ENCLAVE, baseUrl: 'https://api.deepseek.com' },
		{ ...ENCLAVE, baseUrl: 'http://api.libertai.io/v1' },
		{ ...ENCLAVE, baseUrl: 'https://api.libertai.io.example.com/v1' },
		{ ...ENCLAVE, model: '' },
		'not an object'
	]) {
		assert.equal(enclaveLlm(llm), null);
		assert.equal(hostedConfig(JSON.stringify({ llm })).llm, undefined);
	}
});

test('the model’s key is written only beside a model in the enclave', async () => {
	for (const [llm, kept] of [
		[ENCLAVE, true],
		[{ ...ENCLAVE, tee: null }, false]
	]) {
		const run = await mkdtemp(join(tmpdir(), 'belege-tee-'));
		try {
			const r = sortSecrets(run, {
				BELEGE_BRIDGE_SECRETS: JSON.stringify({
					imap: 'pw',
					llm: 'key',
					bridge_config: JSON.stringify({ llm })
				})
			});
			assert.equal(r.llm, kept);
			assert.deepEqual(
				(await readdir(join(run, 'secrets'))).sort(),
				kept ? ['imap', 'llm'] : ['imap']
			);
			const config = JSON.parse(await readFile(join(run, 'bridge.json'), 'utf8'));
			assert.equal(Boolean(config.llm), kept);
		} finally {
			await rm(run, { recursive: true, force: true });
		}
	}
});

test('the start this VM answers comes with the secrets, checked', () => {
	assert.deepEqual(startFrom('{"books":"books-a.testnet","at_ms":"2000"}'), {
		books: 'books-a.testnet',
		at_ms: '2000'
	});
	assert.deepEqual(startFrom('{"books":"books-a.testnet","at_ms":2000}'), {
		books: 'books-a.testnet',
		at_ms: '2000'
	});
	assert.equal(startFrom('{"books":"Books A","at_ms":"2000"}'), null);
	assert.equal(startFrom('{"books":"books-a.testnet","at_ms":"soon"}'), null);
	assert.equal(startFrom('nonsense'), null);
	assert.equal(startFrom(undefined), null);
});

test('the report data binds the start and the intake key, as the NEAR contract expects', () => {
	// The same vector as bridge/tee/near-contract/src/tests.rs.
	assert.equal(
		reportData('books-a.testnet', 2000, '09'.repeat(32)).toString('hex'),
		'243ffdb70c9e7f9fd91e12cc544d57e50bbcc66a37c954cf12bd70a2a2d0a8a2' + '09'.repeat(32)
	);
	assert.throws(() => reportData('books-a.testnet', '2000; x', '09'.repeat(32)), /start time/);
	assert.throws(() => reportData('books-a.testnet', 2000, 'xyz'), /key hash/);
});

// The same vector as the start page's secrets.spec.js (Le-Space/belege-bridge-near).
const SEALED_VECTOR =
	'0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20333333333333333333333333381b10c951a9a43ddfb212d3be4fc963a927aa976c0faf24cc1054704d';

test('secrets are sealed to the intake key, for one start of one set of books', () => {
	const key = intakeKeyFromSeed(Buffer.alloc(32, 0x11));
	assert.equal(key.publicKey, '7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13');
	const sealed = sealSecrets('{"imap":"pw"}', key.publicKey, 'books-a.testnet', '2000', {
		ephemeralSeed: Buffer.alloc(32, 0x22),
		iv: Buffer.alloc(12, 0x33)
	});
	assert.equal(sealed, SEALED_VECTOR);
	assert.equal(openSecrets(sealed, key, 'books-a.testnet', '2000'), '{"imap":"pw"}');
	assert.throws(() => openSecrets(sealed, key, 'books-a.testnet', '2001'));
	assert.throws(() => openSecrets(sealed, key, 'books-b.testnet', '2000'));
	assert.throws(() => openSecrets(sealed, intakeKey(), 'books-a.testnet', '2000'));
	assert.throws(() => openSecrets('zz', key, 'books-a.testnet', '2000'), /not sealed/);
});

test('the registrar proves its own key, then takes the secrets sealed to it', async () => {
	const run = await mkdtemp(join(tmpdir(), 'belege-tee-'));
	const socketPath = join(run, 'dstack.sock');
	/** @type {any[]} */
	const asked = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			asked.push([req.url, JSON.parse(body)]);
			res.setHeader('content-type', 'application/json');
			res.end(
				req.url === '/GetQuote'
					? JSON.stringify({ quote: 'aa', event_log: '[]' })
					: JSON.stringify({ tcb_info: '{"mrtd":"00"}' })
			);
		});
	});
	await new Promise((r) => server.listen(socketPath, () => r(undefined)));
	try {
		sortSecrets(run, {
			BELEGE_BRIDGE_SECRETS: JSON.stringify({
				bridge_start: '{"books":"books-a.testnet","at_ms":"2000"}'
			})
		});
		/** @type {any[]} */
		const sent = [];
		let polls = 0;
		const r = await register({
			run,
			launcher: 'https://launcher.example.com',
			socketPath,
			pollMs: 1,
			fetchImpl: /** @type {any} */ (
				async (/** @type {URL} */ url, /** @type {any} */ init) => {
					sent.push([String(url), init?.body ? JSON.parse(init.body) : null]);
					if (String(url).endsWith('/v1/bridge-quote')) return new Response('{}', { status: 200 });
					if (++polls < 3) return new Response('{}', { status: 404 });
					const intake = sent[0][1].intake_key;
					const secrets = JSON.stringify({
						imap: 'imap-secret',
						bridge_config: JSON.stringify({ devices: [] })
					});
					return Response.json({
						sealed: sealSecrets(secrets, intake, 'books-a.testnet', '2000')
					});
				}
			),
			log: () => {}
		});
		assert.deepEqual(r, { quoted: true, secrets: true });
		const quoteBody = sent[0][1];
		assert.equal(sent[0][0], 'https://launcher.example.com/v1/bridge-quote');
		assert.match(quoteBody.intake_key, /^[0-9a-f]{64}$/);
		const keyHash = createHash('sha256')
			.update(Buffer.from(quoteBody.intake_key, 'hex'))
			.digest('hex');
		assert.equal(
			asked[0][1].report_data,
			'243ffdb70c9e7f9fd91e12cc544d57e50bbcc66a37c954cf12bd70a2a2d0a8a2' + keyHash
		);
		assert.equal(sent[1][0], 'https://launcher.example.com/v1/bridge-secrets/books-a.testnet/2000');
		assert.equal(await readFile(join(run, 'secrets', 'imap'), 'utf8'), 'imap-secret');
		assert.deepEqual(JSON.parse(await readFile(join(run, 'start.json'), 'utf8')), {
			books: 'books-a.testnet',
			at_ms: '2000'
		});
	} finally {
		server.close();
		await rm(run, { recursive: true, force: true });
	}
});

test('without secrets in time, the registrar gives up and the bridge starts unarmed', async () => {
	const run = await mkdtemp(join(tmpdir(), 'belege-tee-'));
	const socketPath = join(run, 'dstack.sock');
	const server = createServer((req, res) => {
		req.resume();
		req.on('end', () => res.end(JSON.stringify({ quote: 'aa', tcb_info: '{}' })));
	});
	await new Promise((r) => server.listen(socketPath, () => r(undefined)));
	try {
		sortSecrets(run, {
			BELEGE_BRIDGE_SECRETS: JSON.stringify({
				bridge_start: '{"books":"books-a.testnet","at_ms":"2000"}'
			})
		});
		const r = await register({
			run,
			launcher: 'https://launcher.example.com',
			socketPath,
			pollMs: 1,
			timeoutMs: 20,
			fetchImpl: /** @type {any} */ (
				async (/** @type {URL} */ url) =>
					String(url).endsWith('/v1/bridge-quote')
						? new Response('{}', { status: 200 })
						: Response.json({ sealed: 'ab'.repeat(80) })
			),
			log: () => {}
		});
		assert.deepEqual(r, { quoted: true, secrets: false }, 'a sealed box it cannot open is ignored');
	} finally {
		server.close();
		await rm(run, { recursive: true, force: true });
	}
});

test('no start, no registration; a launcher on plain http is refused', async () => {
	const run = await mkdtemp(join(tmpdir(), 'belege-tee-'));
	try {
		assert.equal(
			await register({ run, launcher: 'https://launcher.example.com', log: () => {} }),
			null
		);
		await assert.rejects(
			register({ run, launcher: 'http://launcher.example.com', log: () => {} }),
			/https/
		);
	} finally {
		await rm(run, { recursive: true, force: true });
	}
});

test('the compose pins the image and names where the quote goes', async () => {
	const { composeFor, LAUNCHER_URL } = await import('../tee/dstack/provision.mjs');
	const image = `ghcr.io/le-space/belege-bridge-dstack@sha256:${'a'.repeat(64)}`;
	const released = composeFor(image);
	assert.match(released, new RegExp(`image: ${image.replace(/[.]/g, '\\.')}\\n`));
	assert.ok(released.includes(`BELEGE_LAUNCHER_URL: ${LAUNCHER_URL}\n`));
	const test = composeFor(image, { launcherUrl: 'https://launcher.example.com' });
	assert.ok(test.includes('BELEGE_LAUNCHER_URL: https://launcher.example.com\n'));
	assert.notEqual(test, released, 'another launcher, another compose to approve');
	assert.throws(() => composeFor(image, { launcherUrl: 'http://launcher.example.com' }));
	assert.throws(() => composeFor(image, { launcherUrl: 'https://launcher.example.com/x' }));
	assert.throws(() => composeFor('ghcr.io/le-space/belege-bridge-dstack:latest'));
});

// The hosted bridge on dstack (#696): what the start sends is sorted into the
// same layout as on Aleph (#583), unknown names are dropped, the hosted
// settings win over the owner's config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	hostedConfig,
	parseSecrets,
	peerKeyFrom,
	sortSecrets,
	startFrom
} from '../tee/dstack/sort-secrets.mjs';
import { register, reportData } from '../tee/dstack/registrar.mjs';

test('only the names the hosted bridge knows are kept', () => {
	const got = parseSecrets(
		JSON.stringify({
			imap: 'pw',
			portal_wolkenfabrik: 'x',
			bridge_config: '{}',
			bridge_peer_key: 'AA==',
			enablebanking_sealed: 's',
			llm: 'not for a hosted bridge',
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
			bridge: { port: 1, origins: ['https://example.com'] },
			node: { wsPort: 1, announce: ['/dns4/example.com/tcp/443/tls/ws'], relays: ['r'] }
		})
	);
	assert.equal(config.llm, undefined);
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
		assert.deepEqual(r, { accounts: 1, peerKey: true, config: true, start: false });
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

test('the report data binds the start and the node key, as the NEAR contract expects', () => {
	// The same vector as bridge/tee/near-contract/src/tests.rs.
	assert.equal(
		reportData('books-a.testnet', 2000, '09'.repeat(32)).toString('hex'),
		'243ffdb70c9e7f9fd91e12cc544d57e50bbcc66a37c954cf12bd70a2a2d0a8a2' + '09'.repeat(32)
	);
	assert.throws(() => reportData('books-a.testnet', '2000; x', '09'.repeat(32)), /start time/);
	assert.throws(() => reportData('books-a.testnet', 2000, 'xyz'), /key hash/);
});

test('the registrar asks dstack for the quote and hands it to the launcher', async () => {
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
		await writeFile(join(run, 'node', 'public-key.sha256'), '09'.repeat(32) + '\n');
		/** @type {any[]} */
		const sent = [];
		const body = await register({
			run,
			launcher: 'https://launcher.example.com',
			socketPath,
			fetchImpl: /** @type {any} */ (
				async (/** @type {URL} */ url, /** @type {any} */ init) => {
					sent.push([String(url), JSON.parse(init.body)]);
					return new Response('{}', { status: 200 });
				}
			),
			log: () => {}
		});
		assert.equal(asked[0][0], '/GetQuote');
		assert.equal(
			asked[0][1].report_data,
			'243ffdb70c9e7f9fd91e12cc544d57e50bbcc66a37c954cf12bd70a2a2d0a8a2' + '09'.repeat(32)
		);
		assert.equal(sent[0][0], 'https://launcher.example.com/v1/bridge-quote');
		assert.deepEqual(sent[0][1], body);
		assert.deepEqual(
			{ books: body?.books, start_at_ms: body?.start_at_ms, quote: body?.quote },
			{ books: 'books-a.testnet', start_at_ms: '2000', quote: 'aa' }
		);
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

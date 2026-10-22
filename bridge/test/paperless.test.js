// Paperless-ngx as a receipt source (issue #318): setup:paperless, the client
// and the /paperless routes, against a fake Paperless on 127.0.0.1 and a fake
// keychain. All data made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../src/index.js';
import { defaultConfig, loadConfig, paperlessBaseUrl, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { PaperlessError, createPaperlessClient } from '../src/paperless.js';
import { runPaperlessSetup } from '../src/setup-paperless.js';
import { FAKE_PAPERLESS_TOKEN, startFakePaperless } from './support/fake-paperless.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

/** @type {string} */ let dir;
/** @type {Awaited<ReturnType<typeof startFakePaperless>>} */ let paperless;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-paperless-'));
	paperless = await startFakePaperless({ pageSizeCap: 2 });
});
after(async () => {
	await paperless?.close();
	await rm(dir, { recursive: true, force: true });
});

/** @param {string[]} answers @param {string[]} hidden */
function io(answers, hidden) {
	/** @type {string[]} */ const out = [];
	return {
		out,
		io: {
			ask: async () => answers.shift() ?? '',
			askHidden: async () => hidden.shift() ?? '',
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

describe('paperlessBaseUrl', () => {
	test('https anywhere, http only on this machine, no credentials', () => {
		assert.equal(paperlessBaseUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
		assert.equal(
			paperlessBaseUrl('http://localhost:8000/paperless/'),
			'http://localhost:8000/paperless'
		);
		assert.equal(
			paperlessBaseUrl('https://paperless.example.org'),
			'https://paperless.example.org'
		);
		assert.equal(paperlessBaseUrl('http://192.168.1.20:8000'), null);
		assert.equal(paperlessBaseUrl('http://nas.local:8000'), null);
		assert.equal(paperlessBaseUrl('https://user:pw@paperless.example.org'), null);
		assert.equal(paperlessBaseUrl('ftp://127.0.0.1'), null);
	});
});

describe('the client', () => {
	const client = () =>
		createPaperlessClient({ baseUrl: paperless.url, getToken: async () => FAKE_PAPERLESS_TOKEN });

	test('lists every page itself, with names and the OCR text, never following `next`', async () => {
		const docs = await client().documents();
		assert.deepEqual(
			docs.map((d) => d.id),
			[11, 12, 13, 14]
		);
		const [invoice, scan] = docs;
		assert.equal(invoice.correspondent, 'Beispiel Hosting GmbH');
		assert.equal(invoice.documentType, 'Rechnung');
		assert.deepEqual(invoice.tags, ['Rechnung', 'aus-Mail']);
		assert.equal(invoice.created, '2026-09-03');
		assert.equal(invoice.originalFileName, 'RE-2026-0042.pdf');
		assert.match(scan.content, /SUMME EUR 4,99/);
		assert.equal(scan.correspondent, null);
		// Pages of two (the fake's cap): page 2 was asked of this host.
		assert.ok(paperless.seen.some((p) => p.startsWith('/api/documents/') && /page=2/.test(p)));
		assert.ok(paperless.authHeaders.every((h) => h === `Token ${FAKE_PAPERLESS_TOKEN}`));
	});

	test('only what was added after `since`', async () => {
		const docs = await client().documents({ since: '2026-09-11T09:30:00+02:00' });
		assert.deepEqual(
			docs.map((d) => d.id),
			[13, 14]
		);
	});

	test('the original when it is a PDF or an image, else the archive PDF, else refused', async () => {
		const pdf = await client().document(11);
		assert.equal(pdf.variant, 'original');
		assert.equal(pdf.mime, 'application/pdf');
		const jpeg = await client().document(12);
		assert.deepEqual([jpeg.variant, jpeg.mime], ['original', 'image/jpeg']);
		const mail = await client().document(13);
		assert.deepEqual([mail.variant, mail.mime], ['archive', 'application/pdf']);
		await assert.rejects(client().document(14), { code: 'PAPERLESS_NOT_A_RECEIPT' });
		await assert.rejects(client().document(0), { code: 'PAPERLESS_BAD_ID' });
	});

	test('follows no redirect, takes nothing over 15 MB, names a refused token', async () => {
		await assert.rejects(client().document(98), { code: 'PAPERLESS_UNREACHABLE' });
		await assert.rejects(client().document(99), { code: 'PAPERLESS_TOO_LARGE' });
		const wrong = createPaperlessClient({ baseUrl: paperless.url, getToken: async () => 'nope' });
		await assert.rejects(wrong.documents(), (/** @type {any} */ e) => {
			assert.ok(e instanceof PaperlessError);
			assert.equal(e.code, 'PAPERLESS_AUTH');
			assert.ok(!e.message.includes('nope'));
			return true;
		});
	});
});

describe('setup:paperless', () => {
	test('stores the token in the keychain, only the address and a flag in the config', async () => {
		const configPath = join(dir, 'setup.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(null, 'paperless');
		const { io: prompts, out } = io([paperless.url], [FAKE_PAPERLESS_TOKEN]);
		assert.equal(await runPaperlessSetup({ io: prompts, keychain, configPath }), true);
		assert.equal(await keychain.read(), FAKE_PAPERLESS_TOKEN);
		const saved = await loadConfig(configPath);
		assert.deepEqual(saved.paperless, { configured: true, baseUrl: paperless.url });
		assert.doesNotMatch(await readFile(configPath, 'utf8'), new RegExp(FAKE_PAPERLESS_TOKEN));
		assert.ok(out.some((l) => /4 document\(s\)/.test(l)));
		assert.ok(out.every((l) => !l.includes(FAKE_PAPERLESS_TOKEN) && !/RE-2026|Hosting/.test(l)));
	});

	test('a LAN address over http is refused before any token is asked', async () => {
		const configPath = join(dir, 'lan.json');
		await saveConfig(defaultConfig(), configPath);
		let asked = false;
		const ok = await runPaperlessSetup({
			io: {
				ask: async () => 'http://192.168.1.20:8000',
				askHidden: async () => {
					asked = true;
					return FAKE_PAPERLESS_TOKEN;
				},
				print: () => {}
			},
			keychain: memoryKeychain(null, 'paperless'),
			configPath
		});
		assert.equal(ok, false);
		assert.equal(asked, false);
		assert.equal((await loadConfig(configPath)).paperless.configured, false);
	});

	test('a token Paperless refuses is not stored', async () => {
		const configPath = join(dir, 'refused.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(null, 'paperless');
		const { io: prompts, out } = io([paperless.url], ['not-the-token']);
		assert.equal(await runPaperlessSetup({ io: prompts, keychain, configPath }), false);
		await assert.rejects(keychain.read());
		assert.ok(out.some((l) => /did not accept/.test(l)));
		assert.ok(out.every((l) => !l.includes('not-the-token')));
	});
});

describe('/paperless routes', () => {
	/** @param {boolean} configured */
	async function bridgeWith(configured) {
		const configPath = join(dir, `bridge-${configured}.json`);
		await saveConfig(
			{ ...defaultConfig(), appOrigins: [APP], paperless: { configured, baseUrl: paperless.url } },
			configPath
		);
		/** @type {string[]} */ const printed = [];
		/** @type {string[]} */ const logged = [];
		const bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			paperlessKeychain: memoryKeychain(FAKE_PAPERLESS_TOKEN, 'paperless'),
			coingeckoKeychain: memoryKeychain(null, 'coingecko'),
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logged.push(l)
		});
		const port = bridge.address.port;
		const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
		const paired = await request(port, '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code }
		});
		return {
			bridge,
			port,
			logged,
			auth: { origin: APP, authorization: `Bearer ${paired.json.token}` }
		};
	}

	test('need a token; list documents and hand out bytes; log neither text nor token', async () => {
		const { bridge, port, logged, auth } = await bridgeWith(true);
		try {
			const health = await request(port, '/health', { headers: { origin: APP } });
			assert.equal(health.json.paperless.configured, true);

			assert.equal(
				(await request(port, '/paperless/documents', { headers: { origin: APP } })).status,
				401
			);
			const foreign = await request(port, '/paperless/documents', {
				headers: { ...auth, origin: 'https://evil.example' }
			});
			assert.equal(foreign.status, 403);

			const list = await request(port, '/paperless/documents', { headers: auth });
			assert.equal(list.status, 200);
			assert.equal(list.json.documents.length, 4);
			assert.equal(list.json.documents[0].title, 'Rechnung RE-2026-0042');

			const since = await request(
				port,
				`/paperless/documents?since=${encodeURIComponent('2026-09-11T09:30:00+02:00')}`,
				{ headers: auth }
			);
			assert.deepEqual(
				since.json.documents.map((/** @type {any} */ d) => d.id),
				[13, 14]
			);
			assert.equal(
				(await request(port, '/paperless/documents?since=gestern', { headers: auth })).status,
				400
			);

			const file = await request(port, '/paperless/document?id=11', { headers: auth });
			assert.equal(file.status, 200);
			assert.equal(file.headers['content-type'], 'application/pdf');
			assert.ok(file.text.startsWith('%PDF-'));
			assert.equal(
				(await request(port, '/paperless/document?id=14', { headers: auth })).json.code,
				'PAPERLESS_NOT_A_RECEIPT'
			);
			assert.equal(
				(await request(port, '/paperless/document?id=500', { headers: auth })).status,
				404
			);

			const log = logged.join('\n');
			assert.ok(!log.includes(FAKE_PAPERLESS_TOKEN));
			assert.ok(!/RE-2026|SUMME|Hosting/.test(log), 'no document text or name in the log');
		} finally {
			await bridge.close();
		}
	});

	test('search: Paperless full text, no OCR text out, the words never in the log', async () => {
		const { bridge, port, logged, auth } = await bridgeWith(true);
		try {
			assert.equal(
				(await request(port, '/paperless/search?query=Baumarkt', { headers: { origin: APP } }))
					.status,
				401
			);
			const hit = await request(port, '/paperless/search?query=Schrauben', { headers: auth });
			assert.equal(hit.status, 200);
			assert.deepEqual(
				hit.json.documents.map((/** @type {any} */ d) => d.title),
				['Kassenbon Baumarkt']
			);
			assert.equal('content' in hit.json.documents[0], false);
			const none = await request(port, '/paperless/search?query=Nirgendwo', { headers: auth });
			assert.deepEqual(none.json.documents, []);
			const empty = await request(port, '/paperless/search?query=', { headers: auth });
			assert.equal(empty.status, 400);
			assert.equal(
				logged.some((l) => l.includes('Schrauben')),
				false
			);
			assert.ok(logged.some((l) => l === 'paperless: search, 1 document(s)'));
		} finally {
			await bridge.close();
		}
	});

	test('without setup:paperless, a 503 that says what to run', async () => {
		const { bridge, port, auth } = await bridgeWith(false);
		try {
			const res = await request(port, '/paperless/documents', { headers: auth });
			assert.equal(res.status, 503);
			assert.equal(res.json.code, 'PAPERLESS_NOT_SET_UP');
		} finally {
			await bridge.close();
		}
	});
});

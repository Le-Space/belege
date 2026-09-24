// POST /extract end to end in-process: the real server, extractor and mail
// client, against a fake OpenAI-compatible API and a fake IMAP server. Proves
// what leaves the bridge: redacted text only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createMailClient } from '../src/mail/imap.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	SECRETS,
	invoiceLines,
	startFakeImap
} from './support/fake-imap.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
const w = RECEIPTS.wolkenfabrik;
const INVOICE_TEXT = invoiceLines({
	...w,
	date: '2026-08-15',
	net: '100,00',
	vat: '19,00',
	gross: '119,00'
}).join('\n');

describe('/extract', () => {
	/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
	/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	/** @type {any[]} */ let mails = [];
	/** @type {string[]} */ const logged = [];
	/** Every response body this suite saw, to prove the key is in none of them. */
	/** @type {string[]} */ const responses = [];
	let keyReads = 0;

	before(async () => {
		llm = await startFakeLlm();
		imap = await startFakeImap();
		const config = {
			...defaultConfig(),
			appOrigins: [APP],
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: /** @type {const} */ ('none')
			},
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				redactTerms: [SECRETS.customerName, 'Beispielkund'],
				configured: true
			}
		};
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		const mail = createMailClient({
			config: config.mail,
			getPassword: async () => FAKE_IMAP_PASSWORD
		});
		const extractor = createExtractor({
			config: config.llm,
			getKey: async () => {
				keyReads++;
				return FAKE_LLM_KEY;
			},
			ownDomains: ['le-space.de']
		});
		bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			mail,
			llm: extractor,
			llmKeyPresent: async () => true,
			log: (l) => logged.push(l)
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
		const since = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
		mails = (
			await request(port, `/mail/messages?since=${since}`, {
				headers: { origin: APP, authorization: `Bearer ${token}` }
			})
		).json.messages;
	});

	after(async () => {
		await bridge?.close();
		await llm?.close();
		await imap?.close();
	});

	/** @param {unknown} body */
	const post = async (body) => {
		const res = await request(port, '/extract', {
			method: 'POST',
			headers: { origin: APP, authorization: `Bearer ${token}` },
			body
		});
		responses.push(res.text);
		return res;
	};

	/** @param {Record<string, string>} behaviour */
	function script(behaviour) {
		for (const k of Object.keys(llm.behaviour)) delete llm.behaviour[k];
		Object.assign(llm.behaviour, behaviour);
	}

	test('needs a token; the key is not read without one', async () => {
		const res = await request(port, '/extract', {
			method: 'POST',
			headers: { origin: APP },
			body: { text: INVOICE_TEXT }
		});
		assert.equal(res.status, 401);
		assert.equal(keyReads, 0);
		assert.equal(llm.requests.length, 0);
	});

	test('flash answers; the fields come back, with the model and the usage', async () => {
		script({});
		const before = llm.requests.length;
		const res = await post({
			text: INVOICE_TEXT,
			hints: { subject: `Ihre Rechnung ${w.invoice}`, from: 'rechnung@wolkenfabrik.example' }
		});
		assert.equal(res.status, 200, res.text);
		assert.equal(res.json.model, 'deepseek-flash');
		assert.equal(res.json.extraction.vendor, w.vendor);
		assert.equal(res.json.extraction.gross, 119);
		assert.equal(res.json.extraction.invoice_number, w.invoice);
		assert.equal(res.json.extraction.invoice_date, '2026-08-15');
		assert.equal(res.json.extraction.iban_last4, '4455', 'the last four digits survive redaction');
		assert.deepEqual(res.json.usage, {
			prompt: res.json.usage.prompt,
			completion: 321,
			reasoning: 200
		});
		assert.equal(res.json.attempts.length, 1);
		assert.equal(res.json.attempts[0].ms >= 0, true);
		assert.deepEqual(res.json.fallback, { used: false, reason: null });
		assert.equal(typeof res.json.ms, 'number');
		// Name, IBAN, street, postcode + town, own e-mail: each counted where it was.
		const r = res.json.redactions;
		assert.ok(r.terms >= 1, 'the name');
		assert.equal(r.iban, 1);
		assert.ok(r.email >= 1, 'the own address');
		assert.ok(r.street >= 1);
		assert.ok(r.postcode >= 1);
		assert.equal(r.total, r.terms + r.iban + r.email + r.street + r.postcode);
		const sent = llm.requests.slice(before);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].authorized, true, 'the key from the keychain');
		assert.equal(sent[0].body.max_tokens, 6000);
		assert.deepEqual(sent[0].body.response_format, { type: 'json_object' });
		// What the app stores as "An die KI gesendet" is exactly what the provider got.
		const user = sent[0].body.messages.find((/** @type {any} */ m) => m.role === 'user');
		assert.equal(res.json.sentText, user.content);
		assert.ok(res.json.sentText.includes('[NAME]'));
		assert.equal(res.json.sentText.includes(SECRETS.customerName), false);
		assert.equal(res.json.sentText.includes(SECRETS.iban), false);
	});

	test('redaction: the LLM never receives the name, IBAN, street, postcode or own e-mail', async () => {
		assert.ok(llm.requests.length > 0);
		const everything = llm.requests.map((r) => r.raw).join('\n');
		for (const secret of [
			SECRETS.customerName,
			'Beispielkund',
			SECRETS.iban,
			SECRETS.iban.replace(/\s/g, ''),
			'1111 2222',
			SECRETS.street,
			SECRETS.postcode,
			'12345',
			SECRETS.ownMail
		]) {
			assert.equal(everything.includes(secret), false, `${secret} left the bridge`);
		}
		// What the receipt is about still arrives.
		assert.ok(everything.includes(w.vendor));
		assert.ok(everything.includes(w.invoice));
		assert.ok(everything.includes('[IBAN …4455]'));
		assert.ok(everything.includes('[STRASSE]'));
		assert.ok(everything.includes('[NAME]'));
	});

	test('an answer that does not add up is retried with the second model', async () => {
		script({ 'deepseek-flash': 'invalid' });
		const before = llm.requests.length;
		const res = await post({ text: INVOICE_TEXT });
		assert.equal(res.status, 200);
		assert.equal(res.json.model, 'deepseek-v4-pro');
		assert.deepEqual(
			res.json.attempts.map((/** @type {any} */ a) => [a.model, a.ok, a.reason]),
			[
				['deepseek-flash', false, 'checks failed: net + VAT is not gross'],
				['deepseek-v4-pro', true, 'ok']
			]
		);
		assert.deepEqual(
			llm.requests.slice(before).map((r) => r.model),
			['deepseek-flash', 'deepseek-v4-pro']
		);
		assert.deepEqual(res.json.fallback, {
			used: true,
			reason: 'checks failed: net + VAT is not gross'
		});
		// The failed attempt's tokens are counted too: they were billed.
		assert.equal(res.json.attempts[0].usage.completion, 321);
		assert.equal(res.json.usage.completion, 321);
	});

	test('finish_reason length is a failure, never a half answer', async () => {
		script({ 'deepseek-flash': 'length' });
		const res = await post({ text: INVOICE_TEXT });
		assert.equal(res.status, 200);
		assert.equal(res.json.model, 'deepseek-v4-pro');
		assert.equal(res.json.attempts[0].reason, 'stopped early: length');
	});

	test('both models fail: 502 with the reasons, and no text in them', async () => {
		script({ 'deepseek-flash': 'length', 'deepseek-v4-pro': 'garbage' });
		const res = await post({ text: INVOICE_TEXT });
		assert.equal(res.status, 502);
		assert.equal(res.json.code, 'EXTRACT_FAILED');
		assert.deepEqual(
			res.json.attempts.map((/** @type {any} */ a) => a.reason),
			['stopped early: length', 'content is not JSON']
		);
		assert.equal(res.text.includes(w.vendor), false);
		script({ 'deepseek-flash': 'http500', 'deepseek-v4-pro': 'http500' });
		const down = await post({ text: INVOICE_TEXT });
		assert.equal(down.status, 502);
		assert.deepEqual(
			down.json.attempts.map((/** @type {any} */ a) => a.reason),
			['HTTP 500', 'HTTP 500']
		);
	});

	test('a wrong key is not retried with the other model', async () => {
		script({ 'deepseek-flash': 'http401' });
		const before = llm.requests.length;
		const res = await post({ text: INVOICE_TEXT });
		assert.equal(res.status, 502);
		assert.equal(llm.requests.length - before, 1);
		script({});
	});

	test('a mail whose sender failed DKIM/SPF is refused, unless the user confirmed it', async () => {
		const phish = mails.find((m) => m.auth.verdict === 'fail');
		assert.ok(phish, 'the phishing sample is listed');
		const before = llm.requests.length;
		const refused = await post({ text: INVOICE_TEXT, source: { mailId: phish.id } });
		assert.equal(refused.status, 403);
		assert.equal(refused.json.code, 'SENDER_UNVERIFIED');
		assert.equal(refused.json.verdict, 'fail');
		assert.equal(llm.requests.length, before, 'nothing went to the LLM');
		const forced = await post({
			text: INVOICE_TEXT,
			source: { mailId: phish.id },
			confirmedByUser: 'yes'
		});
		assert.equal(forced.status, 403, 'only the literal true counts');
		const confirmed = await post({
			text: INVOICE_TEXT,
			source: { mailId: phish.id },
			confirmedByUser: true
		});
		assert.equal(confirmed.status, 200);
	});

	test('a verified sender and our own forward (Sent) go through without a question', async () => {
		const good = mails.find((m) => m.auth.verdict === 'pass' && m.attachments.length);
		const own = mails.find((m) => m.outgoing);
		assert.equal((await post({ text: INVOICE_TEXT, source: { mailId: good.id } })).status, 200);
		assert.equal((await post({ text: INVOICE_TEXT, source: { mailId: own.id } })).status, 200);
	});

	test('the verdict is read from the mail itself when the bridge has not listed it', async () => {
		const phish = mails.find((m) => m.auth.verdict === 'fail');
		// A fresh mail client: no verdict cached.
		const fresh = createMailClient({
			config: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none'
			},
			getPassword: async () => FAKE_IMAP_PASSWORD
		});
		assert.deepEqual(await fresh.verdictOf(phish.id), { verdict: 'fail', outgoing: false });
		const own = mails.find((m) => m.outgoing);
		assert.deepEqual(await fresh.verdictOf(own.id), { verdict: 'none', outgoing: true });
	});

	test('bad bodies: no text, too little text, a made-up mail id', async () => {
		assert.equal((await post({})).status, 400);
		assert.equal((await post({ text: '   ' })).status, 400);
		const short = await post({ text: 'zu kurz' });
		assert.equal(short.status, 422);
		assert.equal((await post({ text: INVOICE_TEXT, source: { mailId: 'x' } })).status, 400);
	});

	test('GET /llm/status: needs a token; host, models, key present, a count of terms – never the key', async () => {
		const anon = await request(port, '/llm/status', { headers: { origin: APP } });
		assert.equal(anon.status, 401);
		const res = await request(port, '/llm/status', {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		responses.push(res.text);
		assert.equal(res.status, 200);
		assert.deepEqual(res.json, {
			configured: true,
			provider: new URL(llm.url).host,
			models: { primary: 'deepseek-flash', fallback: 'deepseek-v4-pro' },
			keyConfigured: true,
			redactTerms: 2,
			mail: { authServId: null }
		});
		// The terms themselves stay on the bridge.
		assert.equal(res.text.includes(SECRETS.customerName), false);
		assert.equal(res.text.includes('Beispielkund'), false);
	});

	test('the API key is in no response the bridge gave', async () => {
		const health = await request(port, '/health', { headers: { origin: APP } });
		responses.push(health.text);
		assert.ok(responses.length > 5);
		for (const text of responses) assert.equal(text.includes(FAKE_LLM_KEY), false);
		assert.equal(logged.join('\n').includes(FAKE_LLM_KEY), false);
	});

	test('the receipt text is never logged', () => {
		const text = logged.join('\n');
		for (const s of [w.vendor, w.invoice, SECRETS.customerName, 'Brutto']) {
			assert.equal(text.includes(s), false, s);
		}
	});
});

test('/llm/status without an LLM: not configured, no key, the host of the configured URL only', async () => {
	const config = {
		...defaultConfig(),
		appOrigins: [APP],
		llm: {
			...defaultConfig().llm,
			baseUrl: 'https://user:secret-in-url@api.example.test:8443/v1?key=nope'
		},
		mail: { ...defaultConfig().mail, authServId: 'mx.example.test' }
	};
	/** @type {{ hash: string, createdAt: string }[]} */
	let hashes = [];
	const pairing = createPairing({
		getHashes: () => hashes,
		saveHashes: async (h) => {
			hashes = h;
		}
	});
	const bridge = createBridgeServer({ config, pairing, hibiscus: null });
	const { port } = await bridge.listen({ port: 0 });
	try {
		const token = await pairing.pair(pairing.issueCode());
		const res = await request(port, '/llm/status', {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.configured, false);
		assert.equal(res.json.keyConfigured, false);
		assert.equal(res.json.provider, 'api.example.test:8443');
		assert.equal(res.json.mail.authServId, 'mx.example.test');
		for (const leak of ['secret-in-url', 'user:', 'key=nope', '/v1']) {
			assert.equal(res.text.includes(leak), false, leak);
		}
	} finally {
		await bridge.close();
	}
});

test('the extractor refuses a base URL without https (except on this machine)', () => {
	const config = { ...defaultConfig().llm, configured: true };
	assert.throws(
		() =>
			createExtractor({
				config: { ...config, baseUrl: 'http://api.example' },
				getKey: async () => 'k'
			}),
		/https/
	);
	assert.doesNotThrow(() =>
		createExtractor({
			config: { ...config, baseUrl: 'http://127.0.0.1:9' },
			getKey: async () => 'k'
		})
	);
});

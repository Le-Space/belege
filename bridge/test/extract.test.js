// POST /extract end to end in-process: the real server, extractor and mail
// client, against a fake OpenAI-compatible API and a fake IMAP server. Proves
// what leaves the bridge: redacted text only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig, redactionOff, withDefaults } from '../src/config.js';
import { createMailClient } from '../src/mail/imap.js';
import { checkExtraction, createExtractor, normalizeTravelFields } from '../src/llm/extract.js';
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
				// The fake on 127.0.0.1 stands in for a provider elsewhere: text is blacked out.
				redaction: 'on',
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
			reasoning: 200,
			cached: Math.min(64, res.json.usage.prompt)
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
		// Both limited by the provider: 429, so the app's queue slows down instead of failing.
		script({ 'deepseek-flash': 'http429', 'deepseek-v4-pro': 'http429' });
		const limited = await post({ text: INVOICE_TEXT });
		assert.equal(limited.status, 429);
		assert.equal(limited.json.code, 'LLM_RATE_LIMIT');
		// One limited, the other failing otherwise: a plain failure.
		script({ 'deepseek-flash': 'http429', 'deepseek-v4-pro': 'http500' });
		assert.equal((await post({ text: INVOICE_TEXT })).status, 502);
		script({});
	});

	test('a wrong key is not retried with the other model', async () => {
		script({ 'deepseek-flash': 'http401' });
		const before = llm.requests.length;
		const res = await post({ text: INVOICE_TEXT });
		assert.equal(res.status, 502);
		assert.equal(res.json.code, 'LLM_AUTH');
		assert.equal(llm.requests.length - before, 1);
		script({});
	});

	test('the provider refusing is named, so the app stops its run (#417)', async () => {
		// No credit: once, not again with the other model; 402 with the provider's host.
		script({ 'deepseek-flash': 'http402' });
		let before = llm.requests.length;
		const broke = await post({ text: INVOICE_TEXT });
		assert.equal(broke.status, 402);
		assert.equal(broke.json.code, 'LLM_NO_CREDIT');
		assert.equal(broke.json.provider, new URL(llm.url).host);
		assert.equal(llm.requests.length - before, 1);
		assert.deepEqual(
			broke.json.attempts.map((/** @type {any} */ a) => a.reason),
			['HTTP 402']
		);
		// A model the provider does not know: by 404, or by a 400 that says so.
		script({ 'deepseek-flash': 'http404', 'deepseek-v4-pro': 'http400model' });
		const unknown = await post({ text: INVOICE_TEXT });
		assert.equal(unknown.json.code, 'LLM_MODEL');
		// Any other 400, or one model refused and the other answering badly: this text failed.
		script({ 'deepseek-flash': 'http400', 'deepseek-v4-pro': 'http400' });
		assert.equal((await post({ text: INVOICE_TEXT })).json.code, 'EXTRACT_FAILED');
		script({ 'deepseek-flash': 'http402', 'deepseek-v4-pro': 'garbage' });
		before = llm.requests.length;
		assert.equal((await post({ text: INVOICE_TEXT })).json.code, 'LLM_NO_CREDIT');
		assert.equal(llm.requests.length - before, 1, 'no second model after a 402');
		// A mix is no refusal: the first model unknown, the second answering.
		script({ 'deepseek-flash': 'http404' });
		const mixed = await post({ text: INVOICE_TEXT });
		assert.equal(mixed.status, 200);
		assert.equal(mixed.json.model, 'deepseek-v4-pro');
		// The status page remembers the last refusal.
		const status = await request(port, '/llm/status', {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.equal(status.json.lastRefusal.code, 'LLM_NO_CREDIT');
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
		const { lastRefusal, ...rest } = res.json;
		// The tests before left a refusal behind: its code and when, nothing else.
		assert.deepEqual(Object.keys(lastRefusal ?? { code: 0, at: 0 }).sort(), ['at', 'code']);
		assert.deepEqual(rest, {
			configured: true,
			provider: new URL(llm.url).host,
			models: { primary: 'deepseek-flash', fallback: 'deepseek-v4-pro' },
			keyConfigured: true,
			redactTerms: 2,
			redaction: { mode: 'on', active: true, local: false, enclave: false },
			mail: { authServId: null },
			tee: null
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
	test('a receipt in another language: the prompt says any language, the traveller goes, the stations and travel fields come back (#366)', async () => {
		script({});
		const before = llm.requests.length;
		// A made-up Russian ticket, and the model's answer to it.
		const text = `Электронный билет № 7012345678901 · Железные дороги Пример
Пассажир: Иванова Мария Петровна
Паспорт: 45 12 345678
Москва Казанская 21:30 → Казань Пассажирская 07:45
Стоимость 4 512,30 руб., в т.ч. НДС 20 % 752,05 руб.`;
		llm.answers.respond = () => ({
			document_type: 'ticket',
			vendor: 'Железные дороги Пример',
			invoice_number: '7012345678901',
			invoice_date: '2026-03-02',
			currency: 'RUB',
			net: 3760.25,
			vat: [{ rate: 20, amount: 752.05, category: 'standard' }],
			gross: 4512.3,
			vendor_country: 'RU',
			reverse_charge: false,
			travel: {
				kind: 'train',
				from: 'Москва Казанская',
				to: 'Казань Пассажирская',
				departure: '2026-03-04T21:30',
				arrival: '2026-03-05T07:45'
			},
			summary: 'Bahnfahrt Moskau–Kasan',
			line_items: null,
			no_payment_request: false
		});
		try {
			const res = await post({ text });
			assert.equal(res.status, 200, res.text);
			const sent = llm.requests.slice(before)[0].body.messages;
			const system = sent.find((/** @type {any} */ m) => m.role === 'system').content;
			assert.match(system, /receipts in any language/);
			assert.match(system, /RUB/);
			const user = sent.find((/** @type {any} */ m) => m.role === 'user').content;
			assert.ok(
				!user.includes('Иванова') && !user.includes('45 12 345678'),
				'the traveller stays home'
			);
			assert.ok(user.includes('Казань Пассажирская'), 'the stations go');
			const e = res.json.extraction;
			assert.equal(e.currency, 'RUB');
			assert.equal(e.gross, 4512.3);
			assert.deepEqual(
				[e.travel.kind, e.travel.from, e.travel.to, e.travel.departure, e.travel.arrival],
				['train', 'Москва Казанская', 'Казань Пассажирская', '2026-03-04T21:30', '2026-03-05T07:45']
			);
			// Fields the answer left out come back as null, not missing.
			assert.equal(e.travel.breakfast_included, null);
		} finally {
			delete llm.answers.respond;
		}
	});

	test('an Arabic hotel invoice: the guest goes, the hotel fields come back (#366)', async () => {
		script({});
		const before = llm.requests.length;
		const text = `فندق المثال · فاتورة رقم 2026-118
الضيف: محمد أحمد
جواز السفر: P1234567
الوصول 10/03/2026 · المغادرة 12/03/2026 · ليلتان مع الإفطار
المجموع 950,00 درهم`;
		llm.answers.respond = () => ({
			document_type: 'invoice',
			vendor: 'فندق المثال',
			invoice_number: '2026-118',
			invoice_date: '2026-03-12',
			currency: 'AED',
			net: null,
			vat: [],
			gross: 950,
			reverse_charge: false,
			travel: {
				kind: 'hotel',
				place: 'دبي',
				check_in: '2026-03-10',
				check_out: '2026-03-12',
				nights: 2,
				breakfast_included: true
			},
			summary: 'Hotel, zwei Nächte mit Frühstück',
			line_items: null,
			no_payment_request: false
		});
		try {
			const res = await post({ text });
			assert.equal(res.status, 200, res.text);
			const user = llm.requests
				.slice(before)[0]
				.body.messages.find((/** @type {any} */ m) => m.role === 'user').content;
			assert.ok(!user.includes('محمد أحمد') && !user.includes('P1234567'), 'the guest stays home');
			assert.ok(user.includes('فندق المثال'), 'the hotel goes');
			const t = res.json.extraction.travel;
			assert.deepEqual(
				[t.kind, t.check_in, t.check_out, t.nights, t.breakfast_included],
				['hotel', '2026-03-10', '2026-03-12', 2, true]
			);
			assert.equal(res.json.extraction.vendor, 'فندق المثال');
		} finally {
			delete llm.answers.respond;
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

test('tax fields made exact: countries, VAT IDs, a category per VAT line (#354)', () => {
	const data = {
		document_type: 'invoice',
		vendor: 'Alpen Beispiel GmbH',
		vendor_vat_id: 'atu 000 000 00',
		vendor_country: 'at',
		customer_vat_id: 'de 999 999 999',
		customer_country: 'Germany',
		currency: 'EUR',
		net: 100,
		vat: [
			{ rate: 0, amount: 0, category: 'intra_eu' },
			{ rate: 0, amount: 0, category: 'vielleicht' }
		],
		gross: 100
	};
	assert.deepEqual(checkExtraction(data), []);
	assert.equal(data.vendor_vat_id, 'ATU00000000');
	assert.equal(data.vendor_country, 'AT');
	assert.equal(data.customer_vat_id, 'DE999999999');
	assert.equal(data.customer_country, null, 'a country name is no ISO code');
	assert.deepEqual(
		data.vat.map((v) => v.category),
		['intra_eu', null]
	);
	const word = { document_type: 'none', customer_vat_id: 'keine' };
	checkExtraction(word);
	assert.equal(word.customer_vat_id, null);
});

test('travel fields made exact: a kind, times, days, nights; what does not fit is null (#213)', () => {
	const ticket = {
		document_type: 'ticket',
		vendor: 'Bahn Beispiel AG',
		currency: 'EUR',
		gross: 89.9,
		vat: [],
		travel: {
			kind: 'train',
			from: ' Beispielstadt Hbf ',
			to: 'Musterstadt Hbf',
			departure: '2026-03-04T07:12',
			arrival: '2026-03-04T10:48',
			return_departure: '2026-03-05T17:10',
			return_arrival: '2026-03-05T25:00',
			extra: 'dropped'
		}
	};
	assert.deepEqual(checkExtraction(ticket), []);
	assert.deepEqual(ticket.travel, {
		kind: 'train',
		from: 'Beispielstadt Hbf',
		to: 'Musterstadt Hbf',
		departure: '2026-03-04T07:12',
		arrival: '2026-03-04T10:48',
		return_departure: '2026-03-05T17:10',
		return_arrival: null,
		place: null,
		check_in: null,
		check_out: null,
		nights: null,
		breakfast_included: null
	});

	const hotel = normalizeTravelFields({
		travel: {
			kind: 'Hotel',
			place: 'Musterstadt',
			check_in: '2026-03-04',
			check_out: '2026-02-30',
			nights: 1.5,
			breakfast_included: 'yes'
		}
	}).travel;
	assert.equal(hotel.kind, null, 'a kind is one of the list, as written');
	assert.equal(hotel.check_in, '2026-03-04');
	assert.equal(hotel.check_out, null, 'no 30 February');
	assert.equal(hotel.nights, null);
	assert.equal(hotel.breakfast_included, null);

	// An answer in the older shape keeps its route and departure.
	const old = normalizeTravelFields({
		travel: { from: 'A-Stadt', to: 'B-Dorf', departure: '2025-11-02T06:30' }
	}).travel;
	assert.equal(old.kind, null);
	assert.equal(old.departure, '2025-11-02T06:30');
	assert.equal(normalizeTravelFields({ travel: 'Bahn' }).travel, null);
	assert.equal(normalizeTravelFields({}).travel, null);
});

test('a provider that cannot be reached is named, a slow answer is not (#417)', async () => {
	const config = {
		...defaultConfig().llm,
		baseUrl: 'http://127.0.0.1:11434/v1',
		model: 'local-a',
		retryModel: 'local-b',
		configured: true
	};
	/** @type {string[]} */
	const asked = [];
	const refused = createExtractor({
		config,
		getKey: async () => 'none',
		fetch: async (url) => {
			asked.push(String(url));
			throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
		}
	});
	await assert.rejects(refused.extract({ text: 'Rechnung über 23,80 EUR von Beispiel GmbH' }), {
		code: 'LLM_UNREACHABLE',
		status: 502
	});
	assert.equal(asked.length, 1, 'the second model is not asked when nobody answers');
	assert.equal(refused.lastRefusal()?.code, 'LLM_UNREACHABLE');

	const slow = createExtractor({
		config,
		getKey: async () => 'none',
		fetch: async () => {
			throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		}
	});
	await assert.rejects(
		slow.extract({ text: 'Rechnung über 23,80 EUR von Beispiel GmbH' }),
		(/** @type {any} */ e) => {
			assert.equal(e.code, 'EXTRACT_FAILED');
			// A model on this machine gets ten minutes: on a CPU one receipt takes minutes.
			assert.deepEqual(
				e.attempts.map((/** @type {any} */ a) => a.reason),
				['no answer within 600 s', 'no answer within 600 s']
			);
			return true;
		}
	);
	assert.equal(slow.lastRefusal(), null);
	const remote = createExtractor({
		config: { ...config, baseUrl: 'https://api.deepseek.example/v1', retryModel: 'local-a' },
		getKey: async () => 'none',
		fetch: async () => {
			throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		}
	});
	await assert.rejects(
		remote.extract({ text: 'Rechnung über 23,80 EUR von Beispiel GmbH' }),
		(/** @type {any} */ e) => {
			assert.equal(e.attempts[0].reason, 'no answer within 180 s');
			return true;
		}
	);
});

test('a model on this machine gets the text as it is; a provider elsewhere does not (#423)', async () => {
	const text = 'Rechnung an Erika Beispielkund, IBAN DE89 3704 0044 0532 0130 00, Summe 23,80 EUR';
	/** @type {string[]} */
	const sent = [];
	/** @param {Partial<import('../src/config.js').LlmConfig>} over */
	const extractor = (over) =>
		createExtractor({
			config: {
				...defaultConfig().llm,
				redactTerms: ['Erika Beispielkund'],
				configured: true,
				...over
			},
			getKey: async () => 'none',
			fetch: async (_url, /** @type {any} */ init) => {
				sent.push(JSON.parse(init.body).messages[1].content);
				throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
			}
		});
	const run = (/** @type {any} */ e) => e.extract({ text }).catch(() => null);

	await run(extractor({ baseUrl: 'http://127.0.0.1:11434/v1', redaction: 'off' }));
	assert.ok(sent.at(-1)?.includes('Erika Beispielkund'), 'local: the name goes as it is');
	assert.ok(sent.at(-1)?.includes('DE89 3704 0044 0532 0130 00'), 'local: the IBAN goes as it is');

	await run(extractor({ baseUrl: 'http://127.0.0.1:4000/v1', redaction: 'on' }));
	assert.equal(sent.at(-1)?.includes('Erika Beispielkund'), false, 'a proxy said so: blacked out');

	await run(extractor({ baseUrl: 'https://api.deepseek.example/v1', redaction: 'auto' }));
	assert.equal(sent.at(-1)?.includes('DE89 3704'), false, 'elsewhere: blacked out');

	// A loopback config from before #423, never asked: blacked out (it may be a proxy).
	await run(extractor({ baseUrl: 'http://127.0.0.1:4000/v1', redaction: 'auto' }));
	assert.equal(sent.at(-1)?.includes('Erika Beispielkund'), false, 'not asked: blacked out');
});

test('redactionOff: only `off` on a loopback URL; auto and anything else black out (#423)', () => {
	assert.equal(redactionOff({ baseUrl: 'http://127.0.0.1:11434/v1', redaction: 'off' }), true);
	assert.equal(redactionOff({ baseUrl: 'http://localhost:1234/v1', redaction: 'off' }), true);
	assert.equal(redactionOff({ baseUrl: 'http://127.0.0.1:11434/v1', redaction: 'auto' }), false);
	assert.equal(redactionOff({ baseUrl: 'https://api.deepseek.com', redaction: 'auto' }), false);
	assert.equal(redactionOff({ baseUrl: 'http://127.0.0.1:4000/v1', redaction: 'on' }), false);
	// `off` by hand with a provider on the internet: blacked out all the same.
	assert.equal(redactionOff({ baseUrl: 'https://api.deepseek.com', redaction: 'off' }), false);
	assert.equal(
		redactionOff({ baseUrl: 'http://127.0.0.1.nip.io:11434/v1', redaction: 'off' }),
		false
	);
	assert.equal(withDefaults({ llm: { redaction: 'nie' } }).llm.redaction, 'auto');
	assert.equal(withDefaults({}).llm.redaction, 'auto');
});

test('the model request follows no redirect: the text would go along (#431)', async () => {
	/** @type {any[]} */
	const inits = [];
	const extractor = createExtractor({
		config: {
			...defaultConfig().llm,
			baseUrl: 'http://127.0.0.1:11434/v1',
			redaction: 'off',
			configured: true
		},
		getKey: async () => 'none',
		fetch: async (_url, /** @type {any} */ init) => {
			inits.push(init);
			throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		}
	});
	await extractor.extract({ text: 'Rechnung 2026-1, Beispiel GmbH, 10,00 EUR' }).catch(() => null);
	assert.ok(inits.length > 0);
	assert.ok(inits.every((i) => i.redirect === 'error'));
});

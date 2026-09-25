// "Mit KI weitersuchen" end to end in-process: the real server, mail client and
// LLM client against a fake IMAP server and a fake chat API. Proves what
// leaves the bridge: the booking's names and the hits' metadata, redacted – no
// mail text, no address but a domain.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createMailClient } from '../src/mail/imap.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	PICK_SYSTEM,
	TERMS_SYSTEM,
	checkPick,
	cleanTerms,
	createMailAssist
} from '../src/llm/assist.js';
import { FAKE_IMAP_PASSWORD, RECEIPTS, isoDay, startFakeImap } from './support/fake-imap.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
const w = RECEIPTS.wolkenfabrik;

test('cleanTerms: plain words, no digit runs, domains that are domains, capped', () => {
	assert.deepEqual(
		cleanTerms(
			{
				vendor: 'Wolkenfabrik',
				terms: [
					'Wolkenfabrik',
					'WOLKENFAB 4029357733',
					'a"b',
					'Hosting',
					'Cloud',
					'Server',
					'Extra'
				],
				domains: ['@Wolkenfabrik.example', 'not a domain', 'stripe.com']
			},
			['known.example']
		),
		{
			vendor: 'Wolkenfabrik',
			terms: ['Wolkenfabrik', 'Hosting', 'Cloud', 'Server'],
			domains: ['known.example', 'wolkenfabrik.example', 'stripe.com']
		}
	);
});

test('checkPick: a candidate number or null, a confidence, a reason', () => {
	assert.deepEqual(checkPick({ best: 2, confidence: 'high', reason: 'x' }, 3), []);
	assert.deepEqual(checkPick({ best: null, confidence: 'low', reason: '' }, 3), []);
	assert.deepEqual(checkPick({ best: 4, confidence: 'sure', reason: 'x' }, 3), [
		'best is not a candidate',
		'confidence is not high/medium/low'
	]);
});

describe('/mail/assist and /mail/search?from=', () => {
	/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
	/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	/** @type {string[]} */ const logged = [];

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
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
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
			getKey: async () => FAKE_LLM_KEY,
			ownDomains: ['le-space.de']
		});
		bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			mail,
			llm: extractor,
			assist: createMailAssist({
				llm: extractor,
				mail,
				redaction: { terms: [], ownDomains: ['le-space.de'] }
			}),
			log: (l) => logged.push(l)
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
	});

	after(async () => {
		await bridge?.close();
		await llm?.close();
		await imap?.close();
	});

	const auth = () => ({ origin: APP, authorization: `Bearer ${token}` });

	test('search by sender domain', async () => {
		const res = await request(
			port,
			`/mail/search?from=wolkenfabrik.example&around=${isoDay(new Date())}&days=14`,
			{ headers: auth() }
		);
		assert.equal(res.status, 200);
		const hit = res.json.messages.find((/** @type {any} */ m) => m.subject.includes(w.invoice));
		assert.deepEqual(hit.matched, ['@wolkenfabrik.example']);
		assert.equal(
			(await request(port, '/mail/search?from=not_a_domain', { headers: auth() })).status,
			400
		);
	});

	test('terms, searches, a pick – and only names and metadata went to the LLM', async () => {
		llm.requests.length = 0;
		llm.answers.respond = (body) => {
			const system = body.messages[0].content;
			const user = body.messages[1].content;
			if (system === TERMS_SYSTEM) {
				return {
					vendor: 'Wolkenfabrik',
					terms: ['Wolkenfabrik', 'WOLKENFAB 4029357733'],
					domains: ['wolkenfabrik.example']
				};
			}
			if (system === PICK_SYSTEM) {
				const line = user.split('\n').find((/** @type {string} */ l) => l.includes(w.invoice));
				return {
					best: Number(line.split('.')[0]),
					confidence: 'high',
					reason: 'Rechnung als PDF vom Anbieter'
				};
			}
			return undefined;
		};
		try {
			const res = await request(port, '/mail/assist', {
				method: 'POST',
				headers: auth(),
				body: {
					counterparty: 'PAYPAL *WOLKENFAB 4029357733',
					purpose: 'PP.1234.PP . WOLKENFAB, Ihr Einkauf bei WOLKENFAB',
					amount: '119,00',
					around: isoDay(new Date()),
					days: 14
				}
			});
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.terms, ['Wolkenfabrik']);
			assert.deepEqual(res.json.domains, ['wolkenfabrik.example']);
			const bill = res.json.messages.find((/** @type {any} */ m) => m.subject.includes(w.invoice));
			assert.deepEqual([...bill.matched].sort(), ['"Wolkenfabrik"', '@wolkenfabrik.example']);
			assert.deepEqual(res.json.pick, {
				id: bill.id,
				confidence: 'high',
				reason: 'Rechnung als PDF vom Anbieter'
			});
			assert.equal(res.json.llm.calls.length, 2);

			// What left: exactly the two user messages returned as `sent`.
			const sent = llm.requests.map((r) => r.body.messages[1].content);
			assert.deepEqual(sent, res.json.llm.sent);
			const all = sent.join('\n');
			assert.ok(all.includes('Absender-Domain: wolkenfabrik.example'));
			for (const secret of [
				'im Anhang finden Sie',
				'rechnung@wolkenfabrik.example',
				'@le-space.de'
			]) {
				assert.equal(all.includes(secret), false, secret);
			}
			// And the log names counts only.
			const log = logged.join('\n');
			assert.ok(log.includes('assisted search: 1 term(s), 1 domain(s)'));
			assert.equal(log.includes('Wolkenfabrik'), false);
			assert.equal(log.includes(w.invoice), false);
		} finally {
			delete llm.answers.respond;
		}
	});

	test('bad bodies are refused before anything is asked', async () => {
		const before = llm.requests.length;
		for (const body of [
			{},
			{ counterparty: 'x' },
			{ counterparty: 'Wolkenfabrik', amount: '12;DROP' },
			{ counterparty: 'Wolkenfabrik', around: '20.09.2026' },
			{ counterparty: 'Wolkenfabrik', days: 365 },
			{ counterparty: 'Wolkenfabrik', knownDomains: ['a b'] }
		]) {
			const res = await request(port, '/mail/assist', { method: 'POST', headers: auth(), body });
			assert.equal(res.status, 400, JSON.stringify(body));
		}
		assert.equal(llm.requests.length, before);
		const noToken = await request(port, '/mail/assist', {
			method: 'POST',
			headers: { origin: APP },
			body: { counterparty: 'Wolkenfabrik' }
		});
		assert.equal(noToken.status, 401);
	});
});

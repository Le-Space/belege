// "✦ KI-Vorschlag" under "Beleg zuordnen" end to end in-process: the real
// server and LLM client against a fake chat API. Proves the pick and what
// left the bridge: the booking and the receipts' read fields, redacted.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	RECEIPT_PICK_SYSTEM,
	checkReceiptPick,
	createMatchAssist
} from '../src/llm/match-assist.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

test('checkReceiptPick: a number in range or null, a confidence, a reason', () => {
	assert.deepEqual(checkReceiptPick({ best: 1, confidence: 'high', reason: 'x' }, 2), []);
	assert.deepEqual(checkReceiptPick({ best: 3, confidence: 'sure' }, 2), [
		'best is not a candidate',
		'confidence is not high/medium/low',
		'reason missing'
	]);
});

describe('/match/assist', () => {
	/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	/** @type {string[]} */ const logged = [];

	before(async () => {
		llm = await startFakeLlm();
		const config = {
			...defaultConfig(),
			appOrigins: [APP],
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				redactTerms: ['Maria Beispiel'],
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
		const extractor = createExtractor({
			config: config.llm,
			getKey: async () => FAKE_LLM_KEY,
			ownDomains: ['le-space.de']
		});
		bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			llm: extractor,
			matchAssist: createMatchAssist({
				llm: extractor,
				redaction: { terms: config.llm.redactTerms, ownDomains: ['le-space.de'] }
			}),
			log: (l) => logged.push(l)
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
	});

	after(async () => {
		await bridge?.close();
		await llm?.close();
	});

	const post = (/** @type {unknown} */ body, auth = true) =>
		request(port, '/match/assist', {
			method: 'POST',
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
			body
		});

	const booking = {
		counterparty: 'PAYPAL *WOLKENFAB',
		purpose: 'Ihr Einkauf bei Maria Beispiel, IBAN DE00123456781234567890',
		amount: '-19,99',
		day: '2026-09-20'
	};
	const candidates = [
		{
			id: 'R1',
			vendor: 'Stromwerk Test AG',
			amount: '52,59',
			currency: 'EUR',
			date: '2026-09-02',
			number: 'SW-1'
		},
		{
			id: 'R2',
			vendor: 'Wolkenfabrik Hosting GmbH',
			amount: '19,99',
			currency: 'EUR',
			date: '2026-09-19',
			number: 'WF-2026-0919',
			summary: 'Hosting September'
		}
	];

	test('the pick among the candidates, and only redacted fields went out', async () => {
		llm.requests.length = 0;
		llm.answers.respond = (body) => {
			if (body.messages[0].content !== RECEIPT_PICK_SYSTEM) return undefined;
			const line = body.messages[1].content
				.split('\n')
				.find((/** @type {string} */ l) => l.includes('Wolkenfabrik'));
			return {
				best: Number(line.split('.')[0]),
				confidence: 'high',
				reason: 'Gleicher Betrag, Anbieter passt'
			};
		};
		try {
			const res = await post({ booking, candidates });
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.pick, {
				id: 'R2',
				confidence: 'high',
				reason: 'Gleicher Betrag, Anbieter passt'
			});
			const sent = llm.requests.map((r) => r.body.messages[1].content);
			assert.deepEqual(sent, res.json.llm.sent);
			assert.equal(sent[0].includes('Maria Beispiel'), false, 'terms redacted');
			assert.equal(sent[0].includes('DE00123456781234567890'), false, 'IBAN redacted');
			assert.ok(sent[0].includes('[IBAN …7890]'));
			assert.equal(logged.join('\n').includes('Wolkenfabrik'), false, 'log has counts only');
		} finally {
			delete llm.answers.respond;
		}
	});

	test('bad bodies are refused before anything is asked; a token is needed', async () => {
		const before = llm.requests.length;
		for (const body of [
			{},
			{ booking },
			{ booking, candidates: [] },
			{ booking, candidates: [{ vendor: 'x' }] },
			{ booking: 'x', candidates }
		]) {
			assert.equal((await post(body)).status, 400, JSON.stringify(body));
		}
		assert.equal(llm.requests.length, before);
		assert.equal((await post({ booking, candidates }, false)).status, 401);
	});
});

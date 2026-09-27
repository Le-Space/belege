// "✦ KI-Vorschlag" under "Als Gegenbuchung verknüpfen …" end to end
// in-process: the real server and LLM client against a fake chat API. Proves
// the pick, and that no address, hash, IBAN or redacted term left the bridge.
// Made-up bookings only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	TRANSFER_PICK_SYSTEM,
	checkTransferPick,
	createTransferAssist,
	stripChainIds
} from '../src/llm/transfer-assist.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
const EVM = `0x${'ab'.repeat(20)}`;
const HASH = `0x${'cd'.repeat(32)}`;
const COSMOS_HASH = 'EF'.repeat(32);
const BECH = `akash1${'qpzry9x8gf'.repeat(4)}`;

test('checkTransferPick: a number in range or null, a confidence, a reason', () => {
	assert.deepEqual(checkTransferPick({ best: null, confidence: 'low', reason: 'x' }, 2), []);
	assert.deepEqual(checkTransferPick({ best: 0, confidence: 'sure' }, 2), [
		'best is not a candidate',
		'confidence is not high/medium/low',
		'reason missing'
	]);
});

test('stripChainIds: addresses and hashes of every kind go', () => {
	const text = stripChainIds(`an ${EVM} tx ${HASH} cosmos ${COSMOS_HASH} ${BECH} Rechnung 2026-07`);
	for (const s of [EVM, HASH, COSMOS_HASH, BECH]) assert.equal(text.includes(s), false, s);
	assert.ok(text.includes('Rechnung 2026-07'));
});

describe('/transfer/assist', () => {
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
			transferAssist: createTransferAssist({
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
		request(port, '/transfer/assist', {
			method: 'POST',
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
			body
		});

	const booking = {
		direction: 'in',
		amount: '480,00',
		day: '2026-07-14',
		account: 'Bank',
		counterparty: 'Payward Test Ltd',
		purpose: `Auszahlung Maria Beispiel ref ${HASH}`
	};
	const candidates = [
		{
			id: 'T1',
			direction: 'out',
			amount: '-22,42',
			day: '2026-07-13',
			account: 'Bank',
			counterparty: 'Kaffeerösterei Test',
			purpose: 'Kartenzahlung'
		},
		{
			id: 'T2',
			direction: 'out',
			amount: '-485,00',
			day: '2026-07-12',
			account: 'Börse Kraken',
			counterparty: 'Kraken',
			purpose: `withdrawal to ${EVM} IBAN DE00123456781234567890`
		}
	];

	test('the pick, and nothing identifying went out', async () => {
		llm.requests.length = 0;
		llm.answers.respond = (body) => {
			if (body.messages[0].content !== TRANSFER_PICK_SYSTEM) return undefined;
			const line = body.messages[1].content
				.split('\n')
				.find((/** @type {string} */ l) => l.includes('Kraken'));
			return {
				best: Number(line.split('.')[0]),
				confidence: 'medium',
				reason: 'Auszahlung der Börse'
			};
		};
		try {
			const res = await post({ booking, candidates });
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.pick, {
				id: 'T2',
				confidence: 'medium',
				reason: 'Auszahlung der Börse'
			});
			const sent = llm.requests.map((r) => r.body.messages[1].content).join('\n');
			for (const secret of ['Maria Beispiel', 'DE00123456781234567890', EVM, HASH]) {
				assert.equal(sent.includes(secret), false, secret);
			}
			assert.ok(sent.includes('Eingang') && sent.includes('Ausgang'));
			assert.equal(logged.join('\n').includes('Kraken'), false, 'log has counts only');
		} finally {
			delete llm.answers.respond;
		}
	});

	test('bad bodies are refused before anything is asked; a token is needed', async () => {
		const before = llm.requests.length;
		const many = Array.from({ length: 9 }, (_, i) => ({ ...candidates[0], id: `T${i}` }));
		for (const body of [
			{},
			{ booking },
			{ booking, candidates: [] },
			{ booking, candidates: many },
			{ booking, candidates: [{ amount: '1' }] },
			{ booking: { ...booking, direction: 'sideways' }, candidates }
		]) {
			assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
		}
		assert.equal(llm.requests.length, before);
		assert.equal((await post({ booking, candidates }, false)).status, 401);
	});
});

// "✦ Konto vorschlagen" (POST /booking/assist): the model names accounts of the
// chart that was sent, an account outside it is refused, IBANs stay home
// unless the model is local or attested. Made-up data only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	BOOKING_SYSTEM,
	bookingMessage,
	checkPicks,
	createBookingAssist
} from '../src/llm/booking-assist.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

const accounts = [
	{ number: '4930', name: 'Bürobedarf' },
	{ number: '4964', name: 'Software-Abos' },
	{ number: '12000', name: 'Bank Konto A' }
];
const input = {
	booking: {
		direction: /** @type {const} */ ('out'),
		amount: '12,34',
		day: '2026-10-13',
		account: 'Konto A',
		counterparty: 'Wolkenfabrik Hosting GmbH',
		purpose: 'Rechnung 10/2026 DE00 1234 5678 9012 3456 78'
	},
	receipt: { vendor: 'Wolkenfabrik Hosting GmbH', kind: 'invoice', items: ['Server S, Oktober'] },
	learned: [{ vendor: 'Stromwerk Test AG', account: '4240' }],
	accounts
};

test('checkPicks: only accounts that were sent', () => {
	const numbers = new Set(['4930', '4964']);
	assert.deepEqual(checkPicks({ picks: [] }, numbers), []);
	assert.deepEqual(
		checkPicks({ picks: [{ account: '4964', confidence: 'high', reason: 'Abo' }] }, numbers),
		[]
	);
	assert.deepEqual(
		checkPicks({ picks: [{ account: '4100', confidence: 'high', reason: 'x' }] }, numbers),
		['an account is not in the chart']
	);
	assert.deepEqual(checkPicks({}, numbers), ['picks missing']);
});

test('the message: chart as "number: name", IBAN blacked out unless off', () => {
	const red = bookingMessage(input, { terms: [] }).text;
	assert.ok(red.includes('12000: Bank Konto A'), 'a five-digit account survives the redaction');
	assert.ok(red.includes('Stromwerk Test AG → 4240'));
	assert.equal(red.includes('DE00 1234 5678 9012 3456 78'), false);
	const plain = bookingMessage(input, { terms: [], off: true }).text;
	assert.ok(plain.includes('DE00 1234 5678 9012 3456 78'));
});

describe('/booking/assist', () => {
	/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;

	before(async () => {
		llm = await startFakeLlm();
		const config = {
			...defaultConfig(),
			appOrigins: [APP],
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
		const extractor = createExtractor({
			config: config.llm,
			getKey: async () => FAKE_LLM_KEY,
			ownDomains: []
		});
		bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			llm: extractor,
			bookingAssist: createBookingAssist({
				llm: extractor,
				redaction: { terms: [], ownDomains: [] }
			})
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
	});
	after(async () => {
		await bridge?.close();
		await llm?.close();
	});

	test('picks come back, at most two, each from the chart', async () => {
		llm.answers.respond = (body) =>
			body.messages[0].content === BOOKING_SYSTEM
				? {
						picks: [
							{ account: '4964', confidence: 'high', reason: 'Monatliches Server-Abo.' },
							{ account: '4930', confidence: 'low', reason: 'Sonst Bürobedarf.' },
							{ account: '4964', confidence: 'low', reason: 'doppelt' }
						]
					}
				: undefined;
		try {
			const res = await request(port, '/booking/assist', {
				method: 'POST',
				headers: { origin: APP, authorization: `Bearer ${token}` },
				body: input
			});
			assert.equal(res.status, 200);
			assert.deepEqual(
				res.json.picks.map((/** @type {any} */ p) => p.account),
				['4964', '4930']
			);
			assert.equal(res.json.llm.sent[0].includes('DE00 1234 5678 9012 3456 78'), false);
		} finally {
			delete llm.answers.respond;
		}
	});

	test('a bad body is refused before anything is asked', async () => {
		const before = llm.requests.length;
		for (const body of [
			{ ...input, accounts: [] },
			{ ...input, accounts: [{ number: '12', name: 'zu kurz' }] },
			{ ...input, booking: { ...input.booking, direction: 'sideways' } }
		]) {
			const res = await request(port, '/booking/assist', {
				method: 'POST',
				headers: { origin: APP, authorization: `Bearer ${token}` },
				body
			});
			assert.equal(res.status, 400);
		}
		assert.equal(llm.requests.length, before);
	});
});

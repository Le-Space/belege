// "✦ Ungereimtheiten erklären" (issue #121) and the new extraction fields:
// the notes come back, and no phone, customer or invoice number leaves.
// Made-up data only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { checkExtraction, createExtractor } from '../src/llm/extract.js';
import {
	VENDOR_EXPLAIN_SYSTEM,
	checkVendorNotes,
	createVendorAssist
} from '../src/llm/vendor-assist.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

test('extraction: positions and "no payment request" are checked', () => {
	const base = { document_type: 'invoice', gross: 1.98, currency: 'EUR', vat: [] };
	assert.deepEqual(
		checkExtraction({
			...base,
			line_items: [{ description: 'Anrufe', amount: 1.98 }],
			no_payment_request: true
		}),
		[]
	);
	assert.deepEqual(checkExtraction({ ...base, line_items: 'x' }), ['line_items is not a list']);
	assert.deepEqual(checkExtraction({ ...base, line_items: [{ amount: 'x' }] }), [
		'a line item is not a description with an amount'
	]);
	assert.deepEqual(checkVendorNotes({ notes: ['ok'] }), []);
	assert.deepEqual(checkVendorNotes({}), ['notes missing']);
});

describe('/vendor/assist', () => {
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
			vendorAssist: createVendorAssist({ llm: extractor, redaction: { terms: [], ownDomains: [] } })
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
	});
	after(async () => {
		await bridge?.close();
		await llm?.close();
	});

	const timeline = {
		vendor: 'Funkmobil Prepaid GmbH',
		from: '2026-01-01',
		until: '2026-12-31',
		opening: null,
		closing: '25,85',
		rows: [
			{ date: '2026-05-02', kind: 'payment', topUp: '15,00', balance: '15,00' },
			{
				date: '2026-06-15',
				kind: 'receipt',
				usage: '1,98',
				balance: '13,02',
				period: { from: '2026-05-01', to: '2026-05-31' },
				items: [{ description: 'Rufnummer 01701234567, Kunde C-0012345678', amount: '1,98' }]
			}
		],
		findings: ['Für 07/2026 gibt es keinen Beleg.']
	};

	test('notes come back; numbers that identify stay home', async () => {
		llm.answers.respond = (body) =>
			body.messages[0].content === VENDOR_EXPLAIN_SYSTEM
				? { notes: ['Für Juli fehlt die Abrechnung.'] }
				: undefined;
		try {
			const res = await request(port, '/vendor/assist', {
				method: 'POST',
				headers: { origin: APP, authorization: `Bearer ${token}` },
				body: timeline
			});
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.notes, ['Für Juli fehlt die Abrechnung.']);
			const sent = res.json.llm.sent[0];
			for (const secret of ['01701234567', '0012345678'])
				assert.equal(sent.includes(secret), false, secret);
			assert.ok(sent.includes('2026-05-01 bis 2026-05-31'));
		} finally {
			delete llm.answers.respond;
		}
	});

	test('a bad body is refused before anything is asked', async () => {
		const before = llm.requests.length;
		const res = await request(port, '/vendor/assist', {
			method: 'POST',
			headers: { origin: APP, authorization: `Bearer ${token}` },
			body: { ...timeline, rows: [] }
		});
		assert.equal(res.status, 400);
		assert.equal(llm.requests.length, before);
	});
});

// "✦ Reise prüfen" (#693 d): unredacted, so only with a model on this machine
// (or in the enclave) and redaction off; notes come back naming only the legs
// and receipts sent. Made-up trip, towns and vendors only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createExtractor } from '../src/llm/extract.js';
import {
	checkTravelNotes,
	createTravelAssist,
	travelMessage,
	travelSystem
} from '../src/llm/travel-assist.js';
import { FAKE_LLM_KEY, startFakeLlm } from './support/fake-llm.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

const TRIP = {
	lang: 'de',
	trip: {
		start: '2026-05-04T07:30',
		end: '2026-05-06T18:00',
		destination: 'Ortshausen',
		country: 'DE',
		overnight: true,
		stops: [{ at: '2026-05-04T13:00', country: 'AT', city: null }],
		flatNights: []
	},
	legs: [
		{
			ref: 'L1',
			receipt: 'R1',
			kind: 'bus',
			from: 'A-Stadt',
			to: 'Ortshausen',
			dep: '2026-05-04T08:00',
			arr: '2026-05-04T13:00'
		}
	],
	receipts: [
		{ ref: 'R1', kind: 'bus', vendor: 'Fernbus Beispiel', date: '2026-05-04' },
		{ ref: 'R2', kind: 'restaurant', vendor: 'Gasthaus Muster', date: '2026-05-05' }
	],
	questions: ['night 2026-05-04: no accommodation', 'night 2026-05-05: no accommodation']
};

test('the answer is checked, and the message carries the trip as lines', () => {
	assert.deepEqual(checkTravelNotes({ notes: [{ text: 'ok', refs: ['L1'] }] }), []);
	assert.deepEqual(checkTravelNotes({ notes: ['ok'] }), ['a note is not text']);
	assert.deepEqual(checkTravelNotes({}), ['notes missing']);
	const m = travelMessage(/** @type {any} */ (TRIP));
	assert.match(m, /L1 \(R1\) bus A-Stadt → Ortshausen \| ab 2026-05-04T08:00/);
	assert.match(m, /R2 kind: restaurant \| vendor: Gasthaus Muster/);
	assert.match(m, /Grenzübertritte: 2026-05-04T13:00 AT/);
	assert.match(travelSystem('en'), /English sentences/);
});

test('the assist refuses by itself when the text would go out redacted', async () => {
	let asked = false;
	const assist = createTravelAssist({
		llm: {
			json: async () => {
				asked = true;
				throw new Error('not to be asked');
			}
		},
		unredacted: () => false
	});
	await assert.rejects(assist.review(/** @type {any} */ (TRIP)), { code: 'REDACTION_ON' });
	assert.equal(asked, false);
});

describe('/travel/assist', () => {
	/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
	/** @param {'off' | 'auto'} redaction */
	async function start(redaction) {
		const config = {
			...defaultConfig(),
			appOrigins: [APP],
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true, redaction }
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
		const bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			llm: extractor,
			travelAssist: createTravelAssist({
				llm: extractor,
				unredacted: () => redaction === 'off'
			})
		});
		const port = (await bridge.listen({ port: 0 })).port;
		const token = await pairing.pair(pairing.issueCode());
		/** @param {unknown} body */
		const post = (body) =>
			request(port, '/travel/assist', {
				method: 'POST',
				headers: { origin: APP, authorization: `Bearer ${token}` },
				body
			});
		return { bridge, post };
	}

	before(async () => {
		llm = await startFakeLlm();
	});
	after(async () => {
		await llm?.close();
	});

	test('notes come back; a name the trip did not send is dropped', async () => {
		const { bridge, post } = await start('off');
		llm.answers.respond = (body) =>
			body.messages[0].content === travelSystem('de')
				? {
						notes: [
							{ text: 'Für beide Nächte in Ortshausen fehlt die Unterkunft.', refs: ['L1', 'R9'] },
							{ text: 'Die Rückfahrt fehlt.', refs: [] }
						]
					}
				: undefined;
		try {
			const res = await post(TRIP);
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.notes, [
				{ text: 'Für beide Nächte in Ortshausen fehlt die Unterkunft.', refs: ['L1'] },
				{ text: 'Die Rückfahrt fehlt.', refs: [] }
			]);
			// Unredacted: the vendor goes as it is.
			assert.ok(res.json.llm.sent[0].includes('Gasthaus Muster'));
			assert.ok(res.json.llm.calls[0].model);
		} finally {
			delete llm.answers.respond;
			await bridge.close();
		}
	});

	test('a bad body is refused before anything is asked', async () => {
		const { bridge, post } = await start('off');
		const before = llm.requests.length;
		try {
			for (const body of [
				{ ...TRIP, lang: 'fr' },
				{ ...TRIP, legs: [{ ...TRIP.legs[0], ref: 'X1' }] },
				{ ...TRIP, receipts: [{ ...TRIP.receipts[0], amount: '12,34' }] },
				{ ...TRIP, redactTerms: ['Beispiel GmbH'] },
				{ ...TRIP, questions: ['x'.repeat(301)] }
			]) {
				const res = await post(body);
				assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
			}
			assert.equal(llm.requests.length, before);
		} finally {
			await bridge.close();
		}
	});

	test('with redaction on, refused: a whole trip is not sent to be blacked out', async () => {
		const { bridge, post } = await start('auto');
		const before = llm.requests.length;
		try {
			const res = await post(TRIP);
			assert.equal(res.status, 403);
			assert.equal(res.json.code, 'REDACTION_ON');
			assert.equal(llm.requests.length, before);
		} finally {
			await bridge.close();
		}
	});
});

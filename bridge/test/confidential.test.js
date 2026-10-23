// LibertAI confidential inference (#416, llm/confidential.js): requests to the
// configured base URL go to the pinned enclave, attested, or fail with
// LLM_ATTESTATION_FAILED – never anywhere else. Against a fake `connect`;
// every hash, address and answer is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTESTATION_FAILED, createConfidentialFetch } from '../src/llm/confidential.js';
import { createExtractor } from '../src/llm/extract.js';

const PIN = {
	provider: /** @type {const} */ ('libertai'),
	itemHash: 'a'.repeat(64),
	measurement: 'b'.repeat(96),
	sourceCommit: '8cd7b12',
	pinnedAt: '2026-10-23T10:00:00.000Z'
};
const BASE = 'https://api.libertai.io/v1';
const ENCLAVE = 'https://203.0.113.7:26334/v1';

/** A fake connect: the deployment it proves, and the requests its fetch got. */
function fakeConnect({ measurement = PIN.measurement, answer = () => new Response('{}') } = {}) {
	/** @type {{ url: string, init: any }[]} */ const requests = [];
	/** @type {any[]} */ const calls = [];
	const connect = async (/** @type {any} */ opts) => {
		calls.push(opts);
		return {
			baseURL: ENCLAVE,
			itemHash: opts.itemHash,
			measurement,
			sourceCommit: '8cd7b12',
			fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
				requests.push({ url, init });
				return answer();
			}
		};
	};
	return { connect, requests, calls };
}

test('a request to the base URL goes to the pinned enclave, path and all', async () => {
	const fake = fakeConnect();
	const tee = createConfidentialFetch({ pin: PIN, baseUrl: BASE, connect: fake.connect });
	const res = await tee.fetch(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
	assert.equal(res.status, 200);
	assert.deepEqual(
		fake.requests.map((r) => r.url),
		[`${ENCLAVE}/chat/completions`]
	);
	assert.equal(fake.calls[0].itemHash, PIN.itemHash, 'the pin, never a lookup by model');
	const status = tee.status();
	assert.equal(status.itemHash, PIN.itemHash);
	assert.match(String(status.verifiedAt), /^\d{4}-/);
	assert.equal(status.error, null);
	// Proved once, then the enclave's own fetch re-proves each new connection.
	await tee.fetch(`${BASE}/chat/completions`, { method: 'POST', body: '{}' });
	assert.equal(fake.calls.length, 1);
});

test('another measurement, a failed proof, another address: refused, nothing sent', async () => {
	const changed = fakeConnect({ measurement: 'c'.repeat(96) });
	const tee = createConfidentialFetch({ pin: PIN, baseUrl: BASE, connect: changed.connect });
	await assert.rejects(tee.fetch(`${BASE}/chat/completions`, {}), (/** @type {any} */ e) => {
		assert.equal(e.code, ATTESTATION_FAILED);
		assert.match(e.message, /not the pinned one/);
		return true;
	});
	assert.equal(changed.requests.length, 0);
	assert.match(String(tee.status().error), /not the pinned one/);

	const failing = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: async () => {
			throw new Error('report does not bind the TLS key the peer served');
		}
	});
	await assert.rejects(failing.fetch(`${BASE}/chat/completions`, {}), { code: ATTESTATION_FAILED });

	const elsewhere = fakeConnect();
	const strict = createConfidentialFetch({ pin: PIN, baseUrl: BASE, connect: elsewhere.connect });
	await assert.rejects(strict.fetch('https://api.deepseek.com/chat/completions', {}), {
		code: ATTESTATION_FAILED
	});
	assert.equal(elsewhere.requests.length, 0);
});

test('the extractor reads a receipt through the enclave, and stops the run when the proof fails', async () => {
	const answer = () =>
		Response.json({
			model: 'qwen3.8-27b-tee',
			choices: [
				{
					finish_reason: 'stop',
					message: {
						content: JSON.stringify({
							vendor: 'Beispiel Baumarkt',
							invoice_number: 'R-1',
							invoice_date: '2026-10-21',
							gross: 23.8,
							currency: 'EUR'
						})
					}
				}
			],
			usage: { prompt_tokens: 10, completion_tokens: 10 }
		});
	const fake = fakeConnect({ answer });
	const tee = createConfidentialFetch({ pin: PIN, baseUrl: BASE, connect: fake.connect });
	const extractor = createExtractor({
		config: {
			baseUrl: BASE,
			model: 'qwen3.8-27b-tee',
			retryModel: 'qwen3.8-27b-tee',
			redactTerms: [],
			redaction: 'on',
			configured: true,
			tee: PIN
		},
		getKey: async () => 'lt-made-up-key',
		fetch: tee.fetch
	});
	const read = await extractor.extract({ text: 'Beispiel Baumarkt, Summe 23,80 EUR, 21.10.2026' });
	assert.equal(
		/** @type {any} */ (read).extraction?.vendor ?? /** @type {any} */ (read).data?.vendor,
		'Beispiel Baumarkt'
	);
	assert.equal(fake.requests[0].url, `${ENCLAVE}/chat/completions`);
	assert.equal(fake.requests[0].init.headers.Authorization, 'Bearer lt-made-up-key');

	const broken = createExtractor({
		config: {
			baseUrl: BASE,
			model: 'qwen3.8-27b-tee',
			retryModel: 'qwen3.8-27b-tee',
			redactTerms: [],
			redaction: 'on',
			configured: true,
			tee: PIN
		},
		getKey: async () => 'lt-made-up-key',
		fetch: createConfidentialFetch({
			pin: PIN,
			baseUrl: BASE,
			connect: fakeConnect({ measurement: 'c'.repeat(96) }).connect
		}).fetch
	});
	await assert.rejects(
		broken.extract({ text: 'Beispiel Baumarkt, Summe 23,80 EUR, 21.10.2026' }),
		(/** @type {any} */ e) => {
			assert.match(`${e.message} ${JSON.stringify(e)}`, /LLM_ATTESTATION_FAILED/);
			return true;
		}
	);
});

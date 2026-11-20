// LibertAI confidential inference (#416, llm/confidential.js): requests to the
// configured base URL go to the pinned enclave, attested, or fail with
// LLM_ATTESTATION_FAILED – never anywhere else. Against a fake `connect`;
// every hash, address and answer is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ATTESTATION_FAILED,
	ENCLAVE_UNREACHABLE,
	createConfidentialFetch,
	reachOf,
	unreachedOrigins
} from '../src/llm/confidential.js';
import { errorJson } from '../src/commands.js';
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
	// Without the model's "thinking": six times faster, as right (#416).
	assert.deepEqual(JSON.parse(fake.requests[0].init.body).chat_template_kwargs, {
		enable_thinking: false
	});

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

test('without a TEE the request is as before: no thinking switch for other providers', async () => {
	/** @type {any[]} */ const bodies = [];
	const extractor = createExtractor({
		config: {
			baseUrl: 'https://api.deepseek.example',
			model: 'deepseek-flash',
			retryModel: 'deepseek-flash',
			redactTerms: [],
			redaction: 'on',
			configured: true,
			tee: null
		},
		getKey: async () => 'sk-made-up',
		fetch: /** @type {any} */ (
			async (/** @type {string} */ _url, /** @type {any} */ init) => {
				bodies.push(JSON.parse(init.body));
				return new Response('{}', { status: 500 });
			}
		)
	});
	await extractor
		.extract({ text: 'Beispiel Baumarkt, Summe 23,80 EUR, 21.10.2026' })
		.catch(() => null);
	assert.ok(bodies.length > 0);
	assert.equal(
		bodies.some((b) => 'chat_template_kwargs' in b),
		false
	);
});

test('in the attested enclave nothing is blacked out, unless setup:llm was told to', async () => {
	const { redactionOff, redactionOffForEnclave } = await import('../src/config.js');
	const base = { baseUrl: BASE, redaction: /** @type {const} */ ('off') };
	assert.equal(redactionOff({ ...base, tee: PIN }), true);
	assert.equal(redactionOffForEnclave({ ...base, tee: PIN }), true);
	// The same answer without a pinned enclave: a provider elsewhere is always blacked out.
	assert.equal(redactionOff({ ...base, tee: null }), false);
	assert.equal(redactionOff({ ...base, redaction: 'on', tee: PIN }), false);

	/** @type {string[]} */ const sent = [];
	const fake = fakeConnect({
		answer: () =>
			Response.json({
				choices: [
					{
						finish_reason: 'stop',
						message: {
							content: JSON.stringify({ gross: 23.8, currency: 'EUR', invoice_date: '2026-10-21' })
						}
					}
				]
			})
	});
	const tee = createConfidentialFetch({ pin: PIN, baseUrl: BASE, connect: fake.connect });
	const extractor = createExtractor({
		config: {
			baseUrl: BASE,
			model: 'qwen3.8-27b-tee',
			retryModel: 'qwen3.8-27b-tee',
			redactTerms: ['Erika Beispielkund'],
			redaction: 'off',
			configured: true,
			tee: PIN
		},
		getKey: async () => 'lt-made-up-key',
		fetch: /** @type {any} */ (
			async (/** @type {string} */ url, /** @type {any} */ init) => {
				sent.push(JSON.parse(init.body).messages[1].content);
				return tee.fetch(url, init);
			}
		)
	});
	await extractor.extract({
		text: 'Rechnung an Erika Beispielkund, IBAN DE89 3704 0044 0532 0130 00, Summe 23,80 EUR, 21.10.2026'
	});
	assert.match(sent[0], /Erika Beispielkund/);
	assert.match(sent[0], /DE89 3704 0044 0532 0130 00/);
});

// An enclave that is not reached is not a failed proof (the bridge looks itself).
const refusedPort = () =>
	Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

test('a port that takes no connection while the node answers: said as a blocked port', async () => {
	/** @type {string[]} */ const probed = [];
	const fake = fakeConnect({
		answer: () => {
			throw refusedPort();
		}
	});
	const tee = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: fake.connect,
		probe: async (host, port) => {
			probed.push(`${host}:${port}`);
			return port === 443 ? null : 'ECONNREFUSED';
		}
	});
	await assert.rejects(tee.fetch(`${BASE}/chat/completions`, {}), (/** @type {any} */ e) => {
		assert.equal(e.code, ENCLAVE_UNREACHABLE);
		assert.deepEqual(e.reach, { kind: 'port', port: 26334, code: 'ECONNREFUSED' });
		assert.match(e.message, /port 26334.*answers on 443.*VPN/);
		return true;
	});
	assert.deepEqual(probed, ['203.0.113.7:443'], 'only the node, and nothing but a connection');
	assert.equal(tee.status().error, null, 'not reached is not a failed proof');
	// The node may have given the enclave another port: looked up afresh.
	await assert.rejects(tee.fetch(`${BASE}/chat/completions`, {}), { code: ENCLAVE_UNREACHABLE });
	assert.equal(fake.calls.length, 2);
});

test('the node silent too, an address that cannot be cross-checked, a slow answer', async () => {
	const fake = fakeConnect({
		answer: () => {
			throw refusedPort();
		}
	});
	const gone = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: fake.connect,
		probe: async () => 'ETIMEDOUT'
	});
	await assert.rejects(gone.fetch(`${BASE}/chat/completions`, {}), (/** @type {any} */ e) => {
		assert.equal(e.reach.kind, 'host');
		return true;
	});

	// The enclave's own IPv6 address, a private address: nothing to compare with, nothing probed.
	for (const origin of ['https://[2001:db8::7]:8443', 'https://10.0.0.7:26334']) {
		const reach = await reachOf(origin, {
			code: 'ECONNREFUSED',
			probe: async () => assert.fail('no probe')
		});
		assert.equal(reach.kind, 'unknown');
	}

	const slow = fakeConnect({
		answer: () => {
			throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		}
	});
	const waiting = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: slow.connect,
		probe: async () => assert.fail('no probe')
	});
	await assert.rejects(waiting.fetch(`${BASE}/chat/completions`, {}), { name: 'TimeoutError' });
});

test('found but no address connects at the first proof: unreachable, not a failed proof', async () => {
	const message = [
		'no deployment could be verified and reached:',
		'  https://203.0.113.7:26334: fetch failed',
		'  https://[2001:db8::7]:8443: 2001:db8::7 did not answer in time'
	].join('\n');
	assert.deepEqual(unreachedOrigins(message), [
		'https://203.0.113.7:26334',
		'https://[2001:db8::7]:8443'
	]);
	assert.deepEqual(
		unreachedOrigins(`${message}\n  https://203.0.113.8:26334: measurement is not allowed`),
		[],
		'one failed proof and it is a failed proof'
	);
	const tee = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: async () => {
			throw new Error(message);
		},
		probe: async (_host, port) => (port === 443 ? null : 'ECONNREFUSED')
	});
	await assert.rejects(tee.fetch(`${BASE}/chat/completions`, {}), (/** @type {any} */ e) => {
		assert.equal(e.code, ENCLAVE_UNREACHABLE);
		assert.deepEqual(e.reach, { kind: 'port', port: 26334, code: 'ECONNREFUSED' });
		return true;
	});
	assert.equal(tee.status().error, null);
});

test('the extractor hands the reason on: a blocked port, a failed proof', async () => {
	const config = {
		baseUrl: BASE,
		model: 'qwen3.8-27b-tee',
		retryModel: '',
		redactTerms: [],
		redaction: 'on',
		tee: PIN,
		configured: true
	};
	const text = 'Rechnung über 23,80 EUR von Beispiel GmbH';
	const blocked = fakeConnect({
		answer: () => {
			throw refusedPort();
		}
	});
	const tee = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: blocked.connect,
		probe: async (_host, port) => (port === 443 ? null : 'ECONNREFUSED')
	});
	const extractor = createExtractor({
		config: /** @type {any} */ (config),
		getKey: async () => 'k',
		fetch: tee.fetch
	});
	await assert.rejects(extractor.extract({ text }), (/** @type {any} */ e) => {
		assert.equal(e.code, 'LLM_UNREACHABLE');
		assert.deepEqual(e.reach, { kind: 'port', port: 26334, code: 'ECONNREFUSED' });
		assert.match(e.message, /port 26334/);
		assert.equal(e.attempts[0].reason, 'unreachable: ECONNREFUSED');
		const { json, line } = errorJson(e);
		assert.deepEqual(json.reach, e.reach);
		assert.match(line, /blocks the port/);
		return true;
	});

	const unproved = createConfidentialFetch({
		pin: PIN,
		baseUrl: BASE,
		connect: fakeConnect({ measurement: 'c'.repeat(96) }).connect
	});
	const strict = createExtractor({
		config: /** @type {any} */ (config),
		getKey: async () => 'k',
		fetch: unproved.fetch
	});
	await assert.rejects(strict.extract({ text }), (/** @type {any} */ e) => {
		assert.equal(e.code, 'LLM_UNREACHABLE');
		assert.deepEqual(e.reach, { kind: 'proof' });
		assert.match(e.message, /could not be verified/);
		return true;
	});
});

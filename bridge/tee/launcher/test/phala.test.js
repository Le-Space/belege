// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phalaClient } from '../src/phala.js';

/** @param {number} status @param {string} body */
const answering = (status, body) =>
	/** @type {typeof fetch} */ (async () => new Response(body, { status }));

const provisionError = async (/** @type {number} */ status, /** @type {string} */ body) => {
	const phala = phalaClient({ apiKey: 'test', fetchImpl: answering(status, body) });
	return phala.provision({ name: 'x' }).then(
		() => assert.fail('provision should throw'),
		(e) => /** @type {Error} */ (e).message
	);
};

test('a refusal names Phala’s code, message and fields', async () => {
	const message = await provisionError(
		400,
		JSON.stringify({
			error_code: 'ERR-02-009',
			message: 'Failed to get app env encrypt pubkey for abc from KMS cluster: ',
			details: [
				{ field: null, value: null, message: 'again' },
				{ field: 'kms_id', value: 'kms_qaj3xMeb', message: null }
			],
			suggestions: ['Try a different combination of parameters']
		})
	);
	assert.equal(
		message,
		'Phala POST /cvms/provision: HTTP 400 (ERR-02-009, Failed to get app env encrypt pubkey for abc from KMS cluster:, kms_id=kms_qaj3xMeb)'
	);
});

test('a refusal without a body is the status alone', async () => {
	assert.equal(await provisionError(502, ''), 'Phala POST /cvms/provision: HTTP 502');
});

test('a page instead of JSON is cut short and stripped of markup', async () => {
	const message = await provisionError(
		503,
		`<html><body><h1>Service Unavailable</h1>${'x'.repeat(500)}</body></html>`
	);
	assert.match(message, /^Phala POST \/cvms\/provision: HTTP 503 \(Service Unavailable x+\)$/);
	assert.ok(message.length < 220);
});

test('odd fields and control characters stay out of the log', async () => {
	const message = await provisionError(
		400,
		JSON.stringify({
			error_code: 'not a code\n',
			message: 'line one\nline two\u0007',
			details: [{ field: 'kms_id', value: 'a b; rm -rf /' }]
		})
	);
	assert.equal(message, 'Phala POST /cvms/provision: HTTP 400 (line one line two)');
});

test('a 422 names the fields FastAPI refused', async () => {
	const message = await provisionError(
		422,
		JSON.stringify({
			detail: [
				{ loc: ['body', 'image'], msg: 'field required', type: 'missing' },
				{ loc: ['body', 'instance_type'], msg: 'not a known type', type: 'value_error' }
			]
		})
	);
	assert.equal(
		message,
		'Phala POST /cvms/provision: HTTP 422 (body.image: field required; body.instance_type: not a known type)'
	);
});

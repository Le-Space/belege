// `request` onto the command table (stream.js, #574), without libp2p: the
// dispatch, the limits, the answer's shape, and the same status as HTTP for
// every command offered. Made-up config; nothing is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIMITS } from '@le-space/ucep';

import { statusOf } from '../src/commands.js';
import { HTTP_ONLY, answerRequest, offered } from '../src/stream.js';
import { emptyCommands } from './support/commands.js';

const commands = emptyCommands();
/** @param {Record<string, unknown>} args @param {boolean} [limited] */
const ask = (args, limited = false) => answerRequest({ commands, args, limited });
/** @param {Record<string, unknown>} args @param {string} code */
const refused = (args, code, limited = false) =>
	assert.rejects(ask(args, limited), (/** @type {any} */ e) => e.code === code);

test('the arguments: a method the bridge has, a path with a query', async () => {
	await refused({ method: 'PUT', path: '/health' }, 'INVALID_ARGUMENTS');
	await refused({ path: '/health' }, 'INVALID_ARGUMENTS');
	await refused({ method: 'GET', path: 'health' }, 'INVALID_ARGUMENTS');
	await refused({ method: 'GET', path: '//evil.example/health' }, 'INVALID_ARGUMENTS');
	await refused({ method: 'GET', path: `/health?${'a'.repeat(9000)}` }, 'INVALID_ARGUMENTS');
	await refused(null, 'INVALID_ARGUMENTS');
	const ok = await ask({ method: 'GET', path: '/health/' });
	assert.equal(ok.status, 200);
	assert.match(ok.contentType, /json/);
	assert.equal(/** @type {any} */ (ok.json).service, 'belege-bridge');
});

test('unknown paths answer 404 like HTTP; a share by its id is not for a device', async () => {
	assert.equal((await ask({ method: 'GET', path: '/nope' })).status, 404);
	assert.equal((await ask({ method: 'POST', path: '/health' })).status, 404);
	assert.equal((await ask({ method: 'GET', path: `/share/${'A'.repeat(22)}` })).status, 404);
});

test('pairing, shares and bytes-bodied commands stay off the stream', async () => {
	for (const c of commands) {
		assert.equal(offered(c), !HTTP_ONLY.has(c.name) && c.body !== 'bytes', c.name);
	}
	await refused({ method: 'POST', path: '/pair', body: { code: '000000' } }, 'INVALID_ARGUMENTS');
	await refused({ method: 'GET', path: '/share' }, 'INVALID_ARGUMENTS');
	await refused({ method: 'POST', path: '/backup/aleph?name=x' }, 'INVALID_ARGUMENTS');
	await refused({ method: 'POST', path: '/unpair' }, 'INVALID_ARGUMENTS');
});

test('the body limit of the command holds, and an error answers as over HTTP', async () => {
	const big = await ask({ method: 'POST', path: '/mail/trash', body: { id: 'x'.repeat(3000) } });
	assert.equal(big.status, 413);
	assert.deepEqual(big.json, { error: 'Body too large', code: null });
	const notSetUp = await ask({ method: 'GET', path: '/mail/messages?since=2026-01-01' });
	assert.equal(notSetUp.status, 503);
	assert.match(String(/** @type {any} */ (notSetUp.json).error), /Mail is not set up/);
	const bad = await ask({ method: 'GET', path: '/mail/messages' });
	assert.equal(bad.status, 400);
});

test('bytes go base64 while they fit; above UCEP’s limit they are refused before encoding', async () => {
	const small = new Uint8Array(1000).fill(1);
	const fake = /** @type {any} */ ([
		{
			name: 'mail.attachment',
			method: 'GET',
			path: '/mail/attachment',
			scope: 'bridge:mail:read',
			run: () => ({ status: 200, bytes: small, mime: 'application/pdf' })
		},
		{
			name: 'paperless.document',
			method: 'GET',
			path: '/paperless/document',
			scope: 'bridge:paperless:read',
			run: () => ({
				status: 200,
				bytes: new Uint8Array(LIMITS.limitedResponse),
				mime: 'application/pdf'
			})
		}
	]);
	const got = await answerRequest({
		commands: fake,
		args: { method: 'GET', path: '/mail/attachment?id=a&part=1' },
		limited: true
	});
	assert.equal(got.contentType, 'application/pdf');
	assert.equal(got.base64, Buffer.from(small).toString('base64'));
	// 64 KiB of bytes: fine on a direct connection, too big relayed.
	const direct = await answerRequest({
		commands: fake,
		args: { method: 'GET', path: '/paperless/document?id=1' },
		limited: false
	});
	assert.equal(direct.status, 200);
	await assert.rejects(
		answerRequest({
			commands: fake,
			args: { method: 'GET', path: '/paperless/document?id=1' },
			limited: true
		}),
		(/** @type {any} */ e) => e.code === 'TOO_LARGE' && /direct connection/.test(e.message)
	);
});

test('every command offered answers over the stream with the status it answers over HTTP', async () => {
	/** The matcher paths, with a made-up parameter each. */
	const paths = {
		'enablebanking.unlink': '/enablebanking/links/0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f'
	};
	let seen = 0;
	for (const c of commands.filter(offered)) {
		const path = typeof c.path === 'string' ? c.path : /** @type {any} */ (paths)[c.name];
		if (!path) continue; // `chains.wallet` matches no chain without a wallet service
		const params = typeof c.path === 'string' ? {} : /** @type {any} */ (c.path(path));
		const input = { query: new URLSearchParams(), params, body: {}, token: null };
		const expected = await Promise.resolve()
			.then(() => c.run(input))
			.then(
				(a) => a.status,
				(e) => statusOf(e)
			);
		const over = await ask({ method: c.method, path, ...(c.method === 'GET' ? {} : { body: {} }) });
		assert.equal(over.status, expected, c.name);
		seen += 1;
	}
	assert.ok(seen >= 30, `${seen} commands over the stream`);
});

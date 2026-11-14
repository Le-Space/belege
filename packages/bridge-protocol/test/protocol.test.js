// SPDX-License-Identifier: AGPL-3.0-or-later
// The catalogue, the schema check and the HTTP mapping. Made-up data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	COMMANDS,
	DEVICE_SCOPES,
	check,
	checkAnswer,
	checkArgs,
	command,
	commandInput,
	httpRequest
} from '../src/index.js';

test('every command is named area.verb, once, with a route of its own', () => {
	const names = new Set();
	const routes = new Set();
	for (const c of COMMANDS) {
		assert.match(c.name, /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/, c.name);
		assert.ok(!names.has(c.name), `${c.name} twice`);
		names.add(c.name);
		const route = `${c.method} ${c.path}`;
		assert.ok(!routes.has(route), `${route} twice`);
		routes.add(route);
		assert.ok(c.version >= 1);
		assert.ok(['both', 'http', 'stream'].includes(c.via));
		assert.ok(c.description.length > 0);
		if (c.method === 'GET') assert.notEqual(c.args, 'json', `${c.name}: a GET has no body`);
		if (c.answer === 'json') assert.ok(c.response, `${c.name}: an answer's shape`);
	}
	assert.equal(command('nope.nope'), undefined);
});

test('check: types, limits, patterns, required and unexpected keys', () => {
	const schema = {
		type: 'object',
		properties: {
			day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
			days: { type: 'integer', minimum: 0, maximum: 60 },
			terms: {
				type: 'array',
				maxItems: 2,
				items: { type: 'string', maxLength: 5 }
			},
			kind: { enum: ['in', 'out'] }
		},
		required: ['day'],
		additionalProperties: false
	};
	assert.deepEqual(check(schema, { day: '2026-10-13', days: 14, terms: ['abc'], kind: 'in' }), []);
	assert.deepEqual(check(schema, {}), ['day: required']);
	assert.deepEqual(check(schema, { day: '13.10.2026' }), ['day: not in the expected form']);
	assert.deepEqual(check(schema, { day: '2026-10-13', days: 1.5 }), ['days: must be integer']);
	assert.deepEqual(check(schema, { day: '2026-10-13', days: 61 }), ['days: at most 60']);
	assert.deepEqual(check(schema, { day: '2026-10-13', terms: ['abcdef'] }), [
		'terms[0]: at most 5 characters'
	]);
	assert.deepEqual(check(schema, { day: '2026-10-13', terms: ['a', 'b', 'c'] }), [
		'terms: at most 2 entries'
	]);
	assert.deepEqual(check(schema, { day: '2026-10-13', kind: 'sideways' }), [
		'kind: must be one of "in", "out"'
	]);
	assert.deepEqual(check(schema, { day: '2026-10-13', extra: 1 }), ['extra: not expected']);
	assert.deepEqual(check(schema, []), ['the arguments: must be object']);
	// The value itself never appears in a problem: problems may be logged.
	const secret = 'DE00 1234 5678 9012 3456 78';
	assert.ok(!check(schema, { day: secret }).join().includes(secret));
});

test('check refuses a value nested too deep', () => {
	/** @type {import('../src/schema.js').Schema} */
	const schema = { type: 'object' };
	schema.additionalProperties = schema;
	/** @type {Record<string, unknown>} */
	const root = {};
	let at = root;
	for (let i = 0; i < 40; i++) at = /** @type {Record<string, unknown>} */ (at.a = {});
	const problems = check(schema, root);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /: nested too deep$/);
});

test('checkArgs: the calls the app makes fit, bad ones do not', () => {
	assert.deepEqual(checkArgs('bank.transactions', { account: 'a1', since: '2026-10-01' }), []);
	assert.deepEqual(checkArgs('bank.transactions', { account: 'a1' }), ['since: required']);
	assert.deepEqual(
		checkArgs('mail.search', {
			text: 'Rechnung',
			term: ['Abo', 'Server'],
			days: 14
		}),
		[]
	);
	assert.deepEqual(
		checkArgs('llm.booking', {
			booking: {
				direction: 'out',
				amount: '12,34',
				day: '2026-10-13',
				counterparty: 'Wolkenfabrik Hosting GmbH'
			},
			receipt: null,
			learned: [{ vendor: 'Stromwerk Test AG', account: '4240' }],
			accounts: [{ number: '4964', name: 'Software-Abos' }],
			redactTerms: ['Beispiel GmbH']
		}),
		[]
	);
	assert.deepEqual(
		checkArgs('llm.booking', {
			booking: { direction: 'sideways', amount: '1', day: '2026-10-13' },
			accounts: []
		}),
		['booking.direction: must be one of "in", "out"', 'accounts: at least 1 entries']
	);
	assert.deepEqual(
		checkArgs('rates.rate', {
			asset: 'AKT',
			date: '2026-09-01',
			prefer: 'kraken'
		}),
		[]
	);
	assert.deepEqual(checkArgs('chains.wallet', { chain: 'akash', address: 'akash1example' }), []);
	assert.deepEqual(checkArgs('bridge.health', { anything: 1 }), ['anything: not expected']);
	assert.deepEqual(checkArgs('nope.nope', {}), ['unknown command nope.nope']);
});

test('checkAnswer: the outer shape of a JSON answer', () => {
	assert.deepEqual(checkAnswer('bank.accounts', { accounts: [] }), []);
	assert.deepEqual(checkAnswer('bank.accounts', { error: 'x' }), ['accounts: required']);
	assert.deepEqual(checkAnswer('mail.raw', null), []);
});

test('httpRequest: path, query and body as the bridge reads them today', () => {
	assert.deepEqual(httpRequest('bank.transactions', { account: 'a 1', since: '2026-10-01' }), {
		method: 'GET',
		path: '/hibiscus/transactions?account=a+1&since=2026-10-01',
		body: null
	});
	assert.deepEqual(
		httpRequest('mail.search', {
			text: 'Abo',
			term: ['a', 'b'],
			days: 14,
			amount: null
		}),
		{
			method: 'GET',
			path: '/mail/search?text=Abo&term=a&term=b&days=14',
			body: null
		}
	);
	assert.deepEqual(httpRequest('bank.accounts'), {
		method: 'GET',
		path: '/hibiscus/accounts',
		body: null
	});
	assert.deepEqual(httpRequest('mail.trash', { id: 'abcdefgh' }), {
		method: 'POST',
		path: '/mail/trash',
		body: '{"id":"abcdefgh"}'
	});
	assert.deepEqual(httpRequest('chains.wallet', { chain: 'akash', address: 'akash1example' }), {
		method: 'POST',
		path: '/akash/wallet',
		body: '{"address":"akash1example"}'
	});
	assert.deepEqual(
		httpRequest('enablebanking.unlink', {
			id: '00000000-0000-0000-0000-000000000000'
		}),
		{
			method: 'DELETE',
			path: '/enablebanking/links/00000000-0000-0000-0000-000000000000',
			body: null
		}
	);
	assert.throws(() => httpRequest('chains.wallet', {}), /chain is required/);
	assert.throws(() => httpRequest('nope.nope'), /unknown bridge command/);
});

test('commandInput: a call by name reads as HTTP would have given it', () => {
	const q = commandInput('mail.search', {
		text: 'Abo',
		term: ['a', 'b'],
		days: 14
	});
	assert.equal(q.query.get('text'), 'Abo');
	assert.deepEqual(q.query.getAll('term'), ['a', 'b']);
	assert.equal(q.query.get('days'), '14');
	assert.deepEqual(q.body, {});
	const w = commandInput('chains.wallet', {
		chain: 'akash',
		address: 'akash1example'
	});
	assert.deepEqual(w.params, { chain: 'akash' });
	assert.deepEqual(w.body, { address: 'akash1example' });
	assert.deepEqual(commandInput('bank.accounts').params, {});
});

test('device.scopes: a peer id and scope names, nothing else; DEVICE_SCOPES leaves the holder’s own out (#579)', () => {
	const peerId = '12D3KooWGzN9EoHWJ3u4ZyiDpm7DVpNcwRVaUPfYzCgxGmnpHsGp';
	assert.deepEqual(checkArgs('device.scopes', { peerId, scopes: ['bridge:mail:read'] }), []);
	assert.notDeepEqual(checkArgs('device.scopes', { peerId, scopes: ['../x'] }), []);
	assert.notDeepEqual(checkArgs('device.scopes', { peerId: 'nope', scopes: [] }), []);
	assert.notDeepEqual(checkArgs('device.scopes', { peerId, scopes: [], holder: true }), []);
	assert.notDeepEqual(
		checkArgs('device.scopes', { peerId, scopes: new Array(33).fill('bridge:llm') }),
		[]
	);
	assert.ok(DEVICE_SCOPES.includes('bridge:mail:read'));
	assert.ok(DEVICE_SCOPES.includes('bridge:chains:read'));
	assert.ok(!DEVICE_SCOPES.includes('bridge:grants:manage'));
	assert.ok(!DEVICE_SCOPES.includes('bridge:settings:export'));
	assert.ok(!DEVICE_SCOPES.includes(''));
});

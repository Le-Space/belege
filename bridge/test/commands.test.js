// The command table (commands.js, #574): what the HTTP front door and, next,
// the libp2p front door dispatch on. Made-up config; nothing is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommands, findCommand } from '../src/commands.js';

/** The bridge with nothing set up: every optional dependency null. */
function commandsOf() {
	return createCommands({
		config: /** @type {any} */ ({
			appOrigins: [],
			hibiscus: { ibanSuffixes: [] },
			mail: { accountingAddress: null, authServId: null },
			llm: { baseUrl: '', model: '', retryModel: '', redactTerms: [], redaction: 'on' }
		}),
		pairing: /** @type {any} */ ({ isPaired: () => false, hasPendingCode: () => false }),
		hibiscus: null,
		mail: null,
		llm: null,
		llmKeyPresent: async () => false,
		llmTee: null,
		assist: null,
		matchAssist: null,
		transferAssist: null,
		vendorAssist: null,
		shares: /** @type {any} */ ({ read: () => null, list: () => [], revoke: () => false }),
		rates: null,
		kraken: null,
		paperless: null,
		enablebanking: null,
		enablebankingLinks: null,
		wallets: null,
		aleph: null,
		alephLoopback: false,
		alephApi: 'https://api2.aleph.im',
		alephBackup: null,
		lanRelay: null,
		log: () => {}
	});
}

test('every command has a unique name, a method, a path and a scope or is public', () => {
	const commands = commandsOf();
	const names = commands.map((c) => c.name);
	assert.equal(new Set(names).size, names.length, 'names are unique');
	for (const c of commands) {
		assert.match(c.name, /^[a-zA-Z]+\.[a-zA-Z]+$/, `${c.name}: area.verb`);
		assert.ok(['GET', 'POST', 'DELETE'].includes(c.method), `${c.name}: method`);
		assert.ok(typeof c.path === 'string' || typeof c.path === 'function', `${c.name}: path`);
		assert.ok(c.public || c.scope || c.name === 'session.unpair', `${c.name}: a scope, or public`);
		if (c.scope) assert.match(c.scope, /^bridge:[a-z]+(:[a-z]+)?$/, `${c.name}: scope name`);
		if (c.method === 'GET') assert.notEqual(c.body, 'json', `${c.name}: a GET reads no JSON`);
	}
	// The fixed paths are unique per method.
	const fixed = commands
		.filter((c) => typeof c.path === 'string')
		.map((c) => `${c.method} ${c.path}`);
	assert.equal(new Set(fixed).size, fixed.length);
});

test('the public commands are health, pairing and a share read by its id', () => {
	const open = commandsOf()
		.filter((c) => c.public)
		.map((c) => c.name)
		.sort();
	assert.deepEqual(open, ['bridge.health', 'session.pair', 'share.read']);
});

test('findCommand: fixed paths, parameters, and a share read only without a token', () => {
	const commands = commandsOf();
	const find = (/** @type {string} */ method, /** @type {string} */ path, hasToken = true) =>
		findCommand(commands, { method, path, hasToken })?.command.name ?? null;
	assert.equal(find('GET', '/health', false), 'bridge.health');
	assert.equal(find('POST', '/health', false), null);
	const id = 'A'.repeat(22);
	const read = findCommand(commands, { method: 'GET', path: `/share/${id}`, hasToken: false });
	assert.equal(read?.command.name, 'share.read');
	assert.deepEqual(read?.params, { id });
	// With a token the read is not offered: the token's owner lists shares instead.
	assert.equal(find('GET', `/share/${id}`), null);
	assert.equal(find('DELETE', `/share/${id}`), 'share.revoke');
	assert.equal(find('GET', '/share/short', false), null);
	assert.equal(
		find('DELETE', '/enablebanking/links/0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f'),
		'enablebanking.unlink'
	);
	// A chain's wallet only for a chain the wallet service has: none here.
	assert.equal(find('POST', '/bitcoin/wallet'), null);
	assert.equal(find('GET', '/nope'), null);
});

test('a command without its service answers 503, with the code the app knows', async () => {
	const commands = commandsOf();
	const by = (/** @type {string} */ name) =>
		/** @type {any} */ (commands.find((c) => c.name === name));
	const input = { query: new URLSearchParams(), params: {}, body: {}, token: null };
	assert.equal((await by('paperless.documents').run(input)).json.code, 'PAPERLESS_NOT_SET_UP');
	assert.equal((await by('enablebanking.links').run(input)).json.code, 'EB_NOT_SET_UP');
	assert.equal((await by('backup.list').run(input)).json.code, 'ALEPH_BACKUP_NOT_SET_UP');
	assert.equal((await by('backup.status').run(input)).json.aleph.configured, false);
	assert.equal((await by('kraken.balances').run(input)).status, 503);
	assert.equal((await by('chains.list').run(input)).status, 503);
	await assert.rejects(
		by('mail.messages').run({ ...input, query: new URLSearchParams('since=2026-01-01') }),
		/Mail is not set up/
	);
	await assert.rejects(by('bank.accounts').run(input), /Hibiscus is not set up/);
	const health = await by('bridge.health').run(input);
	assert.equal(health.status, 200);
	assert.equal(health.json.service, 'belege-bridge');
});

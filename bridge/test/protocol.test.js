// The bridge's command table against the shared catalogue
// (@le-space/bridge-protocol, #577), and a command called by its name over
// the stream (stream.js answerNamed). Made-up config; nothing is called.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMMANDS, command as specOf } from '@le-space/bridge-protocol';

import { createCommands } from '../src/commands.js';
import { HTTP_ONLY, answerNamed, answerRequest, offered } from '../src/stream.js';
import { emptyCommands } from './support/commands.js';

/** The table with every command there is: settings.export comes with a hosted bridge's settings. */
function fullTable() {
	const empty = emptyCommands();
	const withExport = createCommands({
		.../** @type {any} */ ({
			config: {
				appOrigins: [],
				hibiscus: { ibanSuffixes: [] },
				mail: { accountingAddress: null, authServId: null },
				llm: { baseUrl: '', model: '', retryModel: '', redactTerms: [], redaction: 'on' }
			},
			pairing: { isPaired: () => false, hasPendingCode: () => false },
			shares: { read: () => null, list: () => [], revoke: () => false },
			// A wallet service with one chain, so `/{chain}/wallet` matches.
			wallets: { has: (/** @type {string} */ c) => c === 'akash' },
			settingsExport: async () => ({ config: {}, secrets: {} }),
			llmKeyPresent: async () => false,
			log: () => {}
		})
	});
	return { empty, full: withExport };
}

/** A fixed path, or the catalogue's path with made-up parameters, as the table's matcher sees it. */
const SAMPLE = { id: 'A'.repeat(22), chain: 'akash' };
/** @param {string} path @param {string} name */
function filled(path, name) {
	return path.replace(/\{([a-zA-Z]+)\}/g, (_, k) =>
		name === 'enablebanking.unlink' ? '0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f' : SAMPLE[k]
	);
}

test('the bridge has every command of the catalogue, and the catalogue every command of the bridge', () => {
	const { full } = fullTable();
	assert.deepEqual(
		full.map((c) => c.name).sort(),
		COMMANDS.map((c) => c.name).sort(),
		'add a command to both: commands.js and packages/bridge-protocol'
	);
});

test('method, path, scope, arguments and transport agree with the catalogue', () => {
	const { full } = fullTable();
	for (const c of full) {
		const spec = specOf(c.name);
		assert.ok(spec, c.name);
		assert.equal(c.method, spec.method, `${c.name}: method`);
		assert.equal(c.scope, spec.scope, `${c.name}: scope`);
		if (typeof c.path === 'string') assert.equal(c.path, spec.path, `${c.name}: path`);
		else assert.ok(c.path(filled(spec.path, c.name)), `${c.name}: ${spec.path} matches`);
		const kind = c.body ?? (c.method === 'GET' ? 'none' : 'json');
		// A DELETE reads no body, though the table does not say so.
		if (kind === 'json' && c.method !== 'DELETE')
			assert.equal(spec.args, 'json', `${c.name}: a JSON body`);
		if (kind === 'bytes') assert.equal(spec.args, 'bytes', `${c.name}: bytes`);
		if (kind === 'none') assert.ok(['none', 'query'].includes(spec.args), `${c.name}: no body`);
		const via = c.streamOnly ? 'stream' : offered(c) ? 'both' : 'http';
		assert.equal(spec.via, via, `${c.name}: via`);
		if (spec.via === 'http') assert.ok(HTTP_ONLY.has(c.name) || c.body === 'bytes', c.name);
	}
});

const table = emptyCommands();
/** @param {string} name */
const by = (name) => /** @type {any} */ (table.find((c) => c.name === name));
/** @param {string} name @param {unknown} args */
const call = (name, args) => answerNamed({ command: by(name), args, limited: false });

test('by name: the same answer as `request` with a path', async () => {
	const named = await call('bridge.health', {});
	const pathed = await answerRequest({
		commands: table,
		args: { method: 'GET', path: '/health' },
		limited: false
	});
	assert.equal(named.status, 200);
	assert.deepEqual(named.json, pathed.json);
	const notSetUp = await call('mail.messages', { since: '2026-01-01' });
	assert.equal(notSetUp.status, 503);
	assert.match(String(/** @type {any} */ (notSetUp.json).error), /Mail is not set up/);
	const backup = await call('backup.status', undefined);
	assert.equal(/** @type {any} */ (backup.json).aleph.configured, false);
});

test('by name: arguments outside the schema are refused before the command runs', async () => {
	let ran = false;
	const command = {
		...by('mail.messages'),
		run: async () => ((ran = true), { status: 200, json: {} })
	};
	for (const args of [
		{},
		{ since: '01.01.2026' },
		{ since: '2026-01-01', scope: 'all' },
		{ since: '2026-01-01', extra: 1 },
		'since=2026-01-01'
	]) {
		await assert.rejects(
			answerNamed({ command, args, limited: false }),
			(/** @type {any} */ e) => e.code === 'INVALID_ARGUMENTS',
			JSON.stringify(args)
		);
	}
	assert.equal(ran, false);
	// The refusal names the field, never the value.
	await assert.rejects(
		call('bank.transactions', { account: 'a1', since: 'DE00 1234' }),
		(/** @type {any} */ e) => /since/.test(e.message) && !e.message.includes('DE00')
	);
});

test('by name: the query and the path’s parameters reach the command as over HTTP', async () => {
	/** @type {any} */
	let seen = null;
	const capture = async (/** @type {any} */ input) => ((seen = input), { status: 200, json: {} });
	await answerNamed({
		command: { ...by('mail.search'), run: capture },
		args: { text: 'Rechnung', term: ['Abo', 'Server'], days: 14 },
		limited: false
	});
	assert.equal(seen.query.get('text'), 'Rechnung');
	assert.deepEqual(seen.query.getAll('term'), ['Abo', 'Server']);
	assert.equal(seen.query.get('days'), '14');

	const { full } = fullTable();
	const wallet = /** @type {any} */ (full.find((c) => c.name === 'chains.wallet'));
	await answerNamed({
		command: { ...wallet, run: capture },
		args: { chain: 'akash', address: 'akash1example' },
		limited: false
	});
	assert.deepEqual(seen.params, { chain: 'akash' });
	assert.deepEqual(seen.body, { address: 'akash1example' });
	// A chain the wallet service does not have is not found, as over HTTP.
	const unknown = await answerNamed({
		command: { ...wallet, run: capture },
		args: { chain: 'nochain', address: 'x' },
		limited: false
	});
	assert.equal(unknown.status, 404);
});

test('by name: the scope is checked, and the body limit holds', async () => {
	await assert.rejects(
		answerNamed({
			command: by('bank.accounts'),
			args: {},
			limited: false,
			authorize: async () => {
				const { UcepError } = await import('@le-space/ucep');
				throw new UcepError('PERMISSION_DENIED', 'BRIDGE_SCOPE_MISSING');
			}
		}),
		(/** @type {any} */ e) => e.code === 'PERMISSION_DENIED'
	);
	const tooBig = await call('llm.mail', {
		counterparty: 'Wolkenfabrik Hosting GmbH',
		purpose: 'x'.repeat(1000),
		knownDomains: [],
		redactTerms: Array(20).fill('y'.repeat(200))
	});
	assert.equal(tooBig.status, 413);
});

// Paired devices on the command line: list, revoke one, revoke all – and never
// while a bridge is running, which would write the old list back.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { managePairings } from '../src/pairings.js';
import { createPairing } from '../src/pairing.js';

/** @type {string} */ let dir;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-pairings-'));
});
after(() => rm(dir, { recursive: true, force: true }));

const three = [
	{ hash: 'a'.repeat(64), createdAt: '2026-09-01T00:00:00.000Z' },
	{ hash: 'b'.repeat(64), createdAt: '2026-09-02T00:00:00.000Z' },
	{ hash: 'c'.repeat(64), createdAt: '2026-09-03T00:00:00.000Z' }
];

/** @param {string} name */
async function configWithThree(name) {
	const path = join(dir, `${name}.json`);
	await saveConfig({ ...defaultConfig(), pairedTokens: structuredClone(three) }, path);
	return path;
}

const notRunning = async () => false;

test('lists paired devices without the full hash', async () => {
	const lines = [];
	const code = await managePairings({
		configPath: await configWithThree('list'),
		action: 'list',
		print: (l) => lines.push(l)
	});
	assert.equal(code, 0);
	assert.equal(lines.length, 3);
	assert.match(lines[1], /^2\. paired 2026-09-02/);
	assert.ok(!lines.join('\n').includes('b'.repeat(64)));
});

test('revokes one device by its number', async () => {
	const path = await configWithThree('one');
	const code = await managePairings({
		configPath: path,
		action: 'revoke',
		index: 2,
		isRunning: notRunning,
		print: () => {}
	});
	assert.equal(code, 0);
	assert.deepEqual(
		(await loadConfig(path)).pairedTokens.map((e) => e.hash[0]),
		['a', 'c']
	);
});

test('refuses a number outside the list, and changes nothing', async () => {
	const path = await configWithThree('bad');
	for (const index of [0, 4, NaN]) {
		const code = await managePairings({
			configPath: path,
			action: 'revoke',
			index,
			isRunning: notRunning,
			print: () => {}
		});
		assert.equal(code, 1);
	}
	assert.equal((await loadConfig(path)).pairedTokens.length, 3);
});

test('revokes all devices', async () => {
	const path = await configWithThree('all');
	assert.equal(
		await managePairings({
			configPath: path,
			action: 'revoke-all',
			isRunning: notRunning,
			print: () => {}
		}),
		0
	);
	assert.equal((await loadConfig(path)).pairedTokens.length, 0);
});

test('refuses to change anything while a bridge is running', async () => {
	const path = await configWithThree('running');
	const lines = [];
	const code = await managePairings({
		configPath: path,
		action: 'revoke-all',
		isRunning: async () => true,
		print: (l) => lines.push(l)
	});
	assert.equal(code, 1);
	assert.match(lines[0], /Stop it first/);
	assert.equal((await loadConfig(path)).pairedTokens.length, 3);
});

test('a revoked token no longer verifies, and revoking twice is harmless', async () => {
	/** @type {{ hash: string, createdAt: string }[]} */
	let hashes = [];
	const pairing = createPairing({
		getHashes: () => hashes,
		saveHashes: async (h) => void (hashes = h)
	});
	const token = await pairing.pair(pairing.issueCode());
	const other = await pairing.pair(pairing.issueCode());
	assert.ok(pairing.verify(token));
	assert.equal(await pairing.revoke(token), true);
	assert.equal(pairing.verify(token), false);
	assert.ok(pairing.verify(other), 'the other device stays paired');
	assert.equal(await pairing.revoke(token), false);
	assert.equal(await pairing.revoke(null), false);
});

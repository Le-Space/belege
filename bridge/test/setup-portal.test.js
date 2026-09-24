// setup:portal, with scripted answers and a fake keychain.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPortalSetup } from '../src/setup-portal.js';
import { memoryKeychain } from '../src/keychain.js';
import { loadConfig } from '../src/config.js';

/** @type {string} */ let dir;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-setup-portal-'));
});
after(async () => {
	await rm(dir, { recursive: true, force: true });
});

/** @param {string[]} answers @param {string[]} hidden */
function scripted(answers, hidden = []) {
	/** @type {string[]} */ const out = [];
	return {
		out,
		io: {
			ask: async (/** @type {string} */ q) => {
				out.push(q);
				return answers.shift() ?? '';
			},
			askHidden: async (/** @type {string} */ q) => {
				out.push(q);
				return hidden.shift() ?? '';
			},
			print: (/** @type {string} */ line) => out.push(line)
		}
	};
}

test('setup:portal keeps the user name in bridge.json and the password in the keychain only', async () => {
	const configPath = join(dir, 'bridge.json');
	const keychain = memoryKeychain(null, 'portal:vodafone');
	const password = 'Geheim-Portal-9!';
	const { io, out } = scripted(['kunde@example.test', 'y'], [password]);
	assert.equal(await runPortalSetup({ portal: 'vodafone', io, keychain, configPath }), true);
	assert.equal(await keychain.read(), password);
	const text = await readFile(configPath, 'utf8');
	assert.equal(text.includes(password), false);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	assert.deepEqual((await loadConfig(configPath)).portals.vodafone, {
		username: 'kunde@example.test',
		passwordStored: true
	});
	assert.equal(out.join('\n').includes(password), false);
	assert.ok(out.some((l) => /account portal:vodafone/.test(l)));
});

test('setup:portal without a password: the user types it at every login', async () => {
	const configPath = join(dir, 'nopass.json');
	const keychain = memoryKeychain(null, 'portal:vodafone');
	const { io } = scripted(['kunde@example.test', 'n']);
	assert.equal(await runPortalSetup({ portal: 'vodafone', io, keychain, configPath }), true);
	assert.equal((await loadConfig(configPath)).portals.vodafone.passwordStored, false);
	await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
});

test('setup:portal refuses an unknown portal and an empty user name', async () => {
	const configPath = join(dir, 'refused.json');
	const keychain = memoryKeychain(null);
	assert.equal(
		await runPortalSetup({ portal: 'telekom', io: scripted([]).io, keychain, configPath }),
		false
	);
	assert.equal(
		await runPortalSetup({ portal: 'vodafone', io: scripted(['']).io, keychain, configPath }),
		false
	);
});

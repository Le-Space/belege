// "Zugangsdaten speichern" from the app: the app sends a user name, the
// bridge asks for the password in a native macOS dialog (here: a fake, so no
// dialog ever opens) and stores it in the keychain (here: in memory). Stored,
// cancelled, empty, deleted; the password is in no response and no log line;
// the dialog gets the portal's name and host as argv, never inside the script.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	PASSWORD_DIALOG_SCRIPT,
	macosPasswordDialog,
	validUsername
} from '../src/portals/credentials.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { FAKE_PORTAL_PASSWORD, FAKE_PORTAL_USER, startFakePortal } from './support/fake-portal.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

describe('the native password dialog', () => {
	/**
	 * A fake execFile that records its arguments and answers `stdout`.
	 *
	 * @param {string} stdout
	 * @param {any} [error]
	 */
	const fakeRun = (stdout, error = null) => {
		/** @type {{ file: string, args: string[] }[]} */
		const calls = [];
		const run = /** @type {any} */ (
			(/** @type {string} */ file, /** @type {string[]} */ args, _o, /** @type {any} */ cb) => {
				calls.push({ file, args });
				cb(error, stdout);
			}
		);
		return { run, calls };
	};

	test('name and host go in as argv after "--", never into the script', async () => {
		const { run, calls } = fakeRun('ok:geheim\n');
		const ask = macosPasswordDialog({ platform: 'darwin', run });
		const name = 'Evil" & (do shell script "id") & "';
		assert.equal(await ask({ id: 'local-evil', name, host: 'evil.example' }), 'geheim');
		const [{ file, args }] = calls;
		assert.equal(file, '/usr/bin/osascript');
		assert.deepEqual(args.slice(-3), ['--', name, 'evil.example']);
		const script = args.slice(0, -3);
		assert.deepEqual(
			script.filter((_, i) => i % 2 === 0),
			PASSWORD_DIALOG_SCRIPT.map(() => '-e')
		);
		assert.deepEqual(
			script.filter((_, i) => i % 2 === 1),
			PASSWORD_DIALOG_SCRIPT
		);
		assert.ok(!script.join('\n').includes('evil'), 'nothing of the portal is in the script');
		assert.ok(PASSWORD_DIALOG_SCRIPT.join('\n').includes('with hidden answer'));
		assert.ok(PASSWORD_DIALOG_SCRIPT.join('\n').includes('with title "Le Space Belege"'));
	});

	test('cancel is null, an empty answer is "", a password keeps its spaces', async () => {
		const ask = (/** @type {string} */ out) =>
			macosPasswordDialog({ platform: 'darwin', run: fakeRun(out).run })({
				id: 'vodafone',
				name: 'Vodafone MeinKabel',
				host: 'www.vodafone.de'
			});
		assert.equal(await ask('cancel\n'), null);
		assert.equal(await ask('ok:\n'), '');
		assert.equal(await ask('ok: a b \n'), ' a b ');
		assert.equal(await ask('ok:Grüße€\n'), 'Grüße€');
		await assert.rejects(ask('something else\n'), { code: 'PORTAL_CREDENTIALS_DIALOG' });
	});

	test('a failing osascript says so without its output; elsewhere than macOS: setup:portal', async () => {
		const failing = macosPasswordDialog({
			platform: 'darwin',
			run: fakeRun('ok:geheim', Object.assign(new Error('boom ok:geheim'), { code: 1 })).run
		});
		await assert.rejects(
			failing({ id: 'vodafone', name: 'V', host: 'h' }),
			(/** @type {any} */ e) =>
				e.code === 'PORTAL_CREDENTIALS_DIALOG' && !e.message.includes('geheim')
		);
		const linux = macosPasswordDialog({ platform: 'linux', run: fakeRun('ok:x').run });
		await assert.rejects(
			linux({ id: 'vodafone', name: 'V', host: 'h' }),
			(/** @type {any} */ e) => {
				assert.equal(e.code, 'PORTAL_CREDENTIALS_UNSUPPORTED');
				assert.equal(e.status, 501);
				assert.match(e.message, /pnpm setup:portal vodafone/);
				return true;
			}
		);
	});

	test(
		'the AppleScript compiles (macOS only; compiled, never run)',
		{ skip: process.platform !== 'darwin' },
		async () => {
			const dir = await mkdtemp(join(tmpdir(), 'belege-osa-'));
			try {
				await new Promise((resolve, reject) =>
					execFile(
						'/usr/bin/osacompile',
						[...PASSWORD_DIALOG_SCRIPT.flatMap((l) => ['-e', l]), '-o', join(dir, 'x.scpt')],
						(error) => (error ? reject(error) : resolve(undefined))
					)
				);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}
	);

	test('a user name is one line of 1–200 characters', () => {
		assert.equal(validUsername('kunde@example.test'), true);
		for (const bad of ['', '   ', 'a\nb', 'x'.repeat(201), 42, null, undefined]) {
			assert.equal(validUsername(bad), false, String(bad));
		}
	});
});

describe('credentials endpoints', () => {
	/** @type {Awaited<ReturnType<typeof startFakePortal>>} */ let portal;
	/** @type {Awaited<ReturnType<typeof startBridge>>} */ let bridge;
	/** @type {string} */ let dir;
	/** @type {string} */ let configPath;
	/** @type {string} */ let token;
	/** @type {string[]} */ const printed = [];
	/** @type {string[]} */ const logs = [];
	/** @type {string[]} every response body */ const bodies = [];
	/** What the fake dialog answers next; what it was asked. */
	/** @type {string | null} */ let answer = null;
	/** @type {{ id: string, name: string, host: string }[]} */ const asked = [];
	const keychains = new Map();
	/** @param {string} id */
	const keychainOf = (id) => {
		if (!keychains.has(id)) keychains.set(id, memoryKeychain(null));
		return keychains.get(id);
	};

	before(async () => {
		portal = await startFakePortal();
		dir = await mkdtemp(join(tmpdir(), 'belege-credentials-'));
		configPath = join(dir, 'bridge.json');
		await saveConfig(
			{ ...defaultConfig(), appOrigins: [APP], portals: { vodafone: { baseUrl: portal.url } } },
			configPath
		);
		bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			portalKeychain: keychainOf,
			portalHeadless: 'always',
			portalPasswordDialog: async (p) => {
				asked.push(p);
				return answer;
			},
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logs.push(l)
		});
		const code = printed.map((l) => /Pairing code[^:]*: (\S+)/.exec(l)?.[1]).find(Boolean);
		token = (
			await request(bridge.address.port, '/pair', {
				method: 'POST',
				headers: { origin: APP },
				body: { code }
			})
		).json.token;
	});
	after(async () => {
		await bridge?.close();
		await portal?.close();
		await rm(dir, { recursive: true, force: true });
	});

	/** @param {string} path @param {{ method?: string, auth?: boolean, body?: unknown }} [o] */
	const call = async (path, { method = 'POST', auth = true, body } = {}) => {
		const res = await request(bridge.address.port, path, {
			method,
			headers: { origin: APP, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
			body
		});
		bodies.push(res.text);
		return res;
	};
	const listed = async () =>
		(await call('/portals', { method: 'GET' })).json.portals.find(
			(/** @type {any} */ p) => p.id === 'vodafone'
		);
	const stored = async () => JSON.parse(await readFile(configPath, 'utf8')).portals.vodafone;

	test('need the token and a user name; the list says whether any are stored', async () => {
		assert.equal(
			(await call('/portals/vodafone/credentials', { auth: false, body: { username: 'x' } }))
				.status,
			401
		);
		assert.equal(
			(await call('/portals/vodafone/credentials', { method: 'DELETE', auth: false })).status,
			401
		);
		assert.equal((await call('/portals/vodafone/credentials', { method: 'GET' })).status, 405);
		const bad = await call('/portals/vodafone/credentials', { body: { username: 'a\nb' } });
		assert.equal(bad.status, 400);
		assert.equal(bad.json.code, 'PORTAL_CREDENTIALS_INVALID');
		assert.equal(
			(await call('/portals/nope/credentials', { body: { username: 'x' } })).status,
			404
		);
		const p = await listed();
		assert.equal(p.credentials, true);
		assert.equal(p.hasCredentials, false);
		assert.equal(asked.length, 0, 'no dialog for a refused request');
		// The browser may send DELETE: the preflight says so.
		const pre = await request(bridge.address.port, '/portals/vodafone/credentials', {
			method: 'OPTIONS',
			headers: {
				origin: APP,
				'access-control-request-method': 'DELETE',
				'access-control-request-headers': 'authorization'
			}
		});
		assert.equal(pre.status, 204);
		assert.match(String(pre.headers['access-control-allow-methods']), /DELETE/);
	});

	test('cancelled: 409, nothing stored', async () => {
		answer = null;
		const res = await call('/portals/vodafone/credentials', {
			body: { username: FAKE_PORTAL_USER }
		});
		assert.equal(res.status, 409);
		assert.equal(res.json.code, 'PORTAL_CREDENTIALS_CANCELLED');
		assert.deepEqual(asked.at(-1), {
			id: 'vodafone',
			name: 'Vodafone MeinKabel',
			host: new URL(portal.url).host
		});
		assert.equal((await stored()).username, undefined);
		await assert.rejects(keychainOf('vodafone').read(), { code: 'KEYCHAIN_MISSING' });
	});

	test('empty: 422, nothing stored', async () => {
		answer = '';
		const res = await call('/portals/vodafone/credentials', {
			body: { username: FAKE_PORTAL_USER }
		});
		assert.equal(res.status, 422);
		assert.equal(res.json.code, 'PORTAL_CREDENTIALS_EMPTY');
		assert.equal((await stored()).username, undefined);
		assert.equal((await listed()).hasCredentials, false);
	});

	test('stored: the user name in bridge.json, the password in the keychain, a password in the body ignored', async () => {
		answer = FAKE_PORTAL_PASSWORD;
		const res = await call('/portals/vodafone/credentials', {
			body: { username: `  ${FAKE_PORTAL_USER} `, password: 'from-the-app' }
		});
		assert.equal(res.status, 200, res.text);
		assert.deepEqual(res.json, { hasCredentials: true });
		assert.equal(await keychainOf('vodafone').read(), FAKE_PORTAL_PASSWORD);
		const onDisk = await stored();
		assert.equal(onDisk.username, FAKE_PORTAL_USER);
		assert.equal(onDisk.passwordStored, true);
		assert.equal(onDisk.baseUrl, portal.url, 'the rest of the portal config stays');
		const text = await readFile(configPath, 'utf8');
		assert.ok(!text.includes(FAKE_PORTAL_PASSWORD));
		assert.ok(!text.includes('from-the-app'));
		assert.equal((await listed()).hasCredentials, true);
	});

	test('the stored credentials log in to the portal', async () => {
		const res = await call('/portals/vodafone/login');
		assert.equal(res.status, 200, res.text);
		assert.deepEqual(portal.state.logins.at(-1), {
			usernameOk: true,
			passwordOk: true,
			remember: true
		});
	});

	test('deleted: keychain entry and user name gone', async () => {
		const res = await call('/portals/vodafone/credentials', { method: 'DELETE' });
		assert.equal(res.status, 200);
		assert.deepEqual(res.json, { hasCredentials: false });
		await assert.rejects(keychainOf('vodafone').read(), { code: 'KEYCHAIN_MISSING' });
		const onDisk = await stored();
		assert.equal(onDisk.username, undefined);
		assert.equal(onDisk.passwordStored, undefined);
		assert.equal(onDisk.baseUrl, portal.url);
		assert.equal((await listed()).hasCredentials, false);
		// Deleting nothing is fine too.
		assert.equal((await call('/portals/vodafone/credentials', { method: 'DELETE' })).status, 200);
	});

	test('the password is in no response and no log line', () => {
		for (const text of [...bodies, logs.join('\n'), printed.join('\n')]) {
			assert.ok(!text.includes(FAKE_PORTAL_PASSWORD));
			assert.ok(!text.includes('from-the-app'));
		}
		assert.ok(logs.some((l) => l.includes('portal vodafone: credentials stored')));
		assert.ok(logs.some((l) => l.includes('password dialog cancelled')));
		assert.ok(!logs.join('\n').includes(FAKE_PORTAL_USER), 'nor the user name');
	});
});

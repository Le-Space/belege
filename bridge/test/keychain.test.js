// The keychain wrapper against a stand-in `security` binary (a shell script
// that writes down its argv and stdin), so the real keychain is never touched.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeychainError, macosKeychain, memoryKeychain } from '../src/keychain.js';

/** @type {string} */ let dir;
/** @type {string} */ let security;
const PASSWORD = 'pässwort mit "Quotes" und Leerzeichen';

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-keychain-'));
	security = join(dir, 'security');
	// argv to argv.log, stdin to stdin.log. `find-generic-password` answers
	// from store.txt (or exits 44, errSecItemNotFound, when there is none).
	await writeFile(
		security,
		`#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/argv.log"
if [ "$1" = "-i" ]; then
  cat >> "${dir}/stdin.log"
  sed -n 's/.* -w \\(hex:[0-9a-f]*\\).*/\\1/p' "${dir}/stdin.log" | tail -n 1 > "${dir}/store.txt"
  exit 0
fi
if [ "$1" = "find-generic-password" ]; then
  if [ -s "${dir}/store.txt" ]; then cat "${dir}/store.txt"; exit 0; fi
  echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2
  exit 44
fi
if [ "$1" = "delete-generic-password" ]; then
  if [ -s "${dir}/store.txt" ]; then : > "${dir}/store.txt"; exit 0; fi
  exit 44
fi
exit 1
`
	);
	await chmod(security, 0o700);
});
after(() => rm(dir, { recursive: true, force: true }));

test('missing entry: a clear error that names the setup command', async () => {
	const keychain = macosKeychain({ platform: 'darwin', securityPath: security });
	await assert.rejects(keychain.read(), (/** @type {any} */ e) => {
		assert.ok(e instanceof KeychainError);
		assert.equal(e.code, 'KEYCHAIN_MISSING');
		assert.match(e.message, /setup:hibiscus/);
		return true;
	});
});

test('write then read: exact round trip, and the password is never in argv', async () => {
	const keychain = macosKeychain({ platform: 'darwin', securityPath: security });
	await keychain.write(PASSWORD);
	assert.equal(await keychain.read(), PASSWORD);

	const argv = await readFile(join(dir, 'argv.log'), 'utf8');
	assert.equal(argv.includes(PASSWORD), false);
	assert.equal(argv.includes(Buffer.from(PASSWORD).toString('hex')), false, 'not even as hex');
	assert.match(argv, /^-i$/m);
	assert.match(argv, /find-generic-password -s belege-bridge -a hibiscus -w/);
	const stdin = await readFile(join(dir, 'stdin.log'), 'utf8');
	assert.match(
		stdin,
		/^add-generic-password -U -s belege-bridge -a hibiscus -l \S+ -w hex:[0-9a-f]+\n$/
	);
});

test('an entry typed into Keychain Access by hand is read as it is', async () => {
	await writeFile(join(dir, 'store.txt'), 'plain-password\n');
	const keychain = macosKeychain({ platform: 'darwin', securityPath: security });
	assert.equal(await keychain.read(), 'plain-password');
});

test('not macOS: a clear error, and nothing is run', async () => {
	const keychain = macosKeychain({ platform: 'linux', securityPath: '/nonexistent' });
	await assert.rejects(
		keychain.read(),
		(/** @type {any} */ e) => e.code === 'KEYCHAIN_UNSUPPORTED' && /macOS keychain/.test(e.message)
	);
	await assert.rejects(
		keychain.write('x'),
		(/** @type {any} */ e) => e.code === 'KEYCHAIN_UNSUPPORTED'
	);
});

test('no security binary: a clear error', async () => {
	const keychain = macosKeychain({
		platform: 'darwin',
		securityPath: join(dir, 'missing-security')
	});
	await assert.rejects(
		keychain.read(),
		(/** @type {any} */ e) => e.code === 'KEYCHAIN_UNSUPPORTED'
	);
});

test('the in-memory fake counts reads and refuses when empty', async () => {
	const fake = memoryKeychain();
	await assert.rejects(fake.read(), /No Hibiscus password/);
	await fake.write('x');
	assert.equal(await fake.read(), 'x');
	assert.equal(fake.reads, 2);
});

test('one entry per secret: the mail and LLM accounts, each naming its own setup', async () => {
	await writeFile(join(dir, 'store.txt'), '');
	for (const [account, setup, what] of [
		['imap', 'setup:mail', 'mail password'],
		['llm', 'setup:llm', 'LLM API key']
	]) {
		const keychain = macosKeychain({ platform: 'darwin', securityPath: security, account });
		await assert.rejects(keychain.read(), (/** @type {any} */ e) => {
			assert.equal(e.code, 'KEYCHAIN_MISSING');
			assert.match(e.message, new RegExp(`No ${what} .*account ${account}.*pnpm ${setup}`));
			return true;
		});
	}
	const llm = macosKeychain({ platform: 'darwin', securityPath: security, account: 'llm' });
	await llm.write('sk-test-key');
	const stdin = await readFile(join(dir, 'stdin.log'), 'utf8');
	assert.match(
		stdin,
		/add-generic-password -U -s belege-bridge -a llm -l belege-bridge-llm -w hex:/
	);
	assert.equal(stdin.includes('sk-test-key'), false);
	await assert.rejects(memoryKeychain(null, 'imap').read(), /No mail password/);
});

test('remove: the entry is gone, and removing nothing is fine', async () => {
	const keychain = macosKeychain({
		platform: 'darwin',
		securityPath: security,
		account: 'portal:vodafone'
	});
	await keychain.write('zu löschen');
	assert.equal(await keychain.read(), 'zu löschen');
	await keychain.remove?.();
	await assert.rejects(keychain.read(), { code: 'KEYCHAIN_MISSING' });
	await keychain.remove?.();
	const argv = await readFile(join(dir, 'argv.log'), 'utf8');
	assert.match(argv, /delete-generic-password -s belege-bridge -a portal:vodafone/);
	const memory = memoryKeychain('x');
	await memory.remove();
	await assert.rejects(memory.read(), { code: 'KEYCHAIN_MISSING' });
});

// The Windows Credential Manager store (issue #205) against a stand-in
// `powershell.exe`: a shell script that writes down its argv, the environment
// it was given and its stdin, and answers as the real script would. The real
// Credential Manager is never touched; the PowerShell itself runs only on
// Windows, where the person who asked for it tests it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeychainError, macosKeychain, systemKeychain } from '../src/keychain.js';
import {
	CREDENTIAL_SCRIPT,
	MAX_SECRET_BYTES,
	defaultPowershellPath,
	windowsKeychain
} from '../src/windows-keychain.js';

/** @type {string} */ let dir;
/** @type {string} */ let powershell;
const PASSWORD = 'pässwort mit "Quotes", Leerzeichen und €';

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-wincred-'));
	powershell = join(dir, 'powershell.exe');
	// One file per target, as the Credential Manager keeps one credential per target.
	await writeFile(
		powershell,
		`#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/argv.log"
printf '%s %s %s\\n' "$BELEGE_KEYCHAIN_OP" "$BELEGE_KEYCHAIN_TARGET" "$BELEGE_KEYCHAIN_USER" >> "${dir}/env.log"
store="${dir}/$(printf '%s' "$BELEGE_KEYCHAIN_TARGET" | tr ':/' '__').cred"
case "$BELEGE_KEYCHAIN_OP" in
  read)
    [ -s "$store" ] || exit 44
    printf 'hex:%s' "$(cat "$store")"
    ;;
  write)
    if [ -f "${dir}/refuse-write" ]; then echo "CredWrite failed with error 5" >&2; exit 1; fi
    cat > "$store"
    cat "$store" >> "${dir}/stdin.log"
    ;;
  remove)
    rm -f "$store"
    ;;
  *) exit 2 ;;
esac
`
	);
	await chmod(powershell, 0o700);
});
after(() => rm(dir, { recursive: true, force: true }));

const keychain = (/** @type {string} */ account = 'hibiscus') =>
	windowsKeychain({ platform: 'win32', powershellPath: powershell, account });

test('missing credential: a clear error that names the setup command', async () => {
	await assert.rejects(keychain().read(), (/** @type {any} */ e) => {
		assert.ok(e instanceof KeychainError);
		assert.equal(e.code, 'KEYCHAIN_MISSING');
		assert.match(e.message, /Credential Manager \(belege-bridge:hibiscus\)/);
		assert.match(e.message, /setup:hibiscus/);
		return true;
	});
});

test('write then read: exact round trip; the secret is on stdin as hex, never in argv or the environment', async () => {
	await keychain().write(PASSWORD);
	assert.equal(await keychain().read(), PASSWORD);

	const hex = Buffer.from(PASSWORD, 'utf8').toString('hex');
	assert.equal((await readFile(join(dir, 'stdin.log'), 'utf8')).trim(), hex);
	const argv = await readFile(join(dir, 'argv.log'), 'utf8');
	const env = await readFile(join(dir, 'env.log'), 'utf8');
	for (const log of [argv, env]) {
		assert.ok(!log.includes(PASSWORD), 'no secret');
		assert.ok(!log.includes(hex), 'no secret as hex');
	}
	// The script is what is on the command line; the rest travels in the environment.
	assert.match(argv, /-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand /);
	const encoded = argv.trim().split('\n')[0].split(' ').pop() ?? '';
	assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), CREDENTIAL_SCRIPT);
	assert.match(env, /^write belege-bridge:hibiscus hibiscus$/m);
	assert.match(env, /^read belege-bridge:hibiscus hibiscus$/m);
});

test('one credential per account, and removing one leaves the others', async () => {
	await keychain('imap').write('mail-secret');
	await keychain('llm').write('llm-secret');
	assert.equal(await keychain('imap').read(), 'mail-secret');
	assert.equal(await keychain('llm').read(), 'llm-secret');
	await keychain('imap').remove?.();
	await assert.rejects(keychain('imap').read(), { code: 'KEYCHAIN_MISSING' });
	assert.equal(await keychain('llm').read(), 'llm-secret');
	// Nothing to remove is what was wanted.
	await keychain('imap').remove?.();
});

test('an empty secret and one too long for a credential are refused before anything runs', async () => {
	await assert.rejects(keychain('kraken').write(''), { code: 'KEYCHAIN_EMPTY' });
	await assert.rejects(keychain('kraken').write('x'.repeat(MAX_SECRET_BYTES + 1)), {
		code: 'KEYCHAIN_WRITE'
	});
	await assert.rejects(keychain('kraken').read(), { code: 'KEYCHAIN_MISSING' });
});

test('a refused write says what Windows said, without the secret', async () => {
	await writeFile(join(dir, 'refuse-write'), '');
	try {
		await assert.rejects(keychain('alchemy').write('top-secret'), (/** @type {any} */ e) => {
			assert.equal(e.code, 'KEYCHAIN_WRITE');
			assert.match(e.message, /CredWrite failed with error 5/);
			assert.ok(!e.message.includes('top-secret'));
			return true;
		});
	} finally {
		await rm(join(dir, 'refuse-write'));
	}
});

test('no PowerShell, or not Windows: unsupported, with the reason', async () => {
	const gone = windowsKeychain({ platform: 'win32', powershellPath: join(dir, 'nope.exe') });
	await assert.rejects(gone.read(), { code: 'KEYCHAIN_UNSUPPORTED' });
	const mac = windowsKeychain({ platform: 'darwin', powershellPath: powershell });
	await assert.rejects(
		(async () => mac.read())(),
		(/** @type {any} */ e) => e.code === 'KEYCHAIN_UNSUPPORTED' && /only on Windows/.test(e.message)
	);
});

test('the system’s store: the Credential Manager on Windows, the keychain on a Mac, neither elsewhere', async () => {
	// Windows: the default PowerShell path, not the Mac's `security`.
	assert.match(
		defaultPowershellPath({ SystemRoot: 'C:\\Windows' }),
		/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/
	);
	const onWindows = systemKeychain({ platform: 'win32' });
	const onMac = systemKeychain({ platform: 'darwin' });
	assert.notEqual(onWindows.read.toString(), onMac.read.toString());
	assert.equal(onMac.read.toString(), macosKeychain({ platform: 'darwin' }).read.toString());
	await assert.rejects(systemKeychain({ platform: 'linux' }).read(), (/** @type {any} */ e) => {
		assert.equal(e.code, 'KEYCHAIN_UNSUPPORTED');
		assert.match(e.message, /macOS keychain or the Windows Credential Manager/);
		return true;
	});
});

test('the script names the three Credential Manager calls and both exit codes it promises', () => {
	for (const part of ['CredReadW', 'CredWriteW', 'CredDeleteW', 'CredFree', 'exit 44', '1168']) {
		assert.ok(CREDENTIAL_SCRIPT.includes(part), part);
	}
	// It never echoes what it read from stdin.
	assert.ok(!/Write(-Host|-Output)?\s+\$hex/.test(CREDENTIAL_SCRIPT));
});

// The Windows Credential Manager store against the real thing (issue #205):
// write, read, overwrite and remove a test credential through Windows
// PowerShell. Runs only on Windows – in CI on a Windows runner (bridge.yml) –
// and is skipped everywhere else. The credential is a test one of its own
// (`belege-bridge-test:…`), removed at the end; no real secret is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { windowsKeychain } from '../src/windows-keychain.js';

const skip = process.platform !== 'win32' && 'only on Windows';
const account = `ci-${randomBytes(6).toString('hex')}`;
const keychain = () => windowsKeychain({ service: 'belege-bridge-test', account });
// What a password may hold: umlauts, quotes, spaces, a euro sign, a line break.
const SECRET = 'pässwort mit "Quotes", \'Apostroph\', Leerzeichen, € und\neiner zweiten Zeile';

test('no credential yet: KEYCHAIN_MISSING', { skip }, async () => {
	await assert.rejects(keychain().read(), { code: 'KEYCHAIN_MISSING' });
});

test(
	'write, read, overwrite, remove: an exact round trip through the Credential Manager',
	{ skip },
	async () => {
		try {
			await keychain().write(SECRET);
			assert.equal(await keychain().read(), SECRET);
			await keychain().write('second');
			assert.equal(await keychain().read(), 'second');
			// As long as a credential may be.
			const long = 'k'.repeat(2560);
			await keychain().write(long);
			assert.equal(await keychain().read(), long);
		} finally {
			await keychain().remove?.();
		}
		await assert.rejects(keychain().read(), { code: 'KEYCHAIN_MISSING' });
		// Removing what is not there is fine.
		await keychain().remove?.();
	}
);

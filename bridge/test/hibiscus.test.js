// Certificate pinning against a fake Hibiscus with a self-signed certificate.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	createHibiscusClient,
	normalizeFingerprint,
	peerFingerprint,
	PinMismatchError
} from '../src/hibiscus.js';
import { memoryKeychain } from '../src/keychain.js';
import { FAKE_PASSWORD, startFakeHibiscus } from './support/fake-hibiscus.js';

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;

before(async () => {
	hibiscus = await startFakeHibiscus();
});
after(() => hibiscus?.close());

test('peerFingerprint reads the certificate and sends nothing', async () => {
	const fp = await peerFingerprint({ host: hibiscus.host, port: hibiscus.port });
	assert.equal(fp, hibiscus.fingerprint);
	assert.equal(hibiscus.requests.length, 0);
});

test('pin mismatch: the keychain is not asked and no request (let alone the password) is sent', async () => {
	const keychain = memoryKeychain(FAKE_PASSWORD);
	const wrong = normalizeFingerprint('AB'.repeat(32));
	const client = createHibiscusClient({
		host: hibiscus.host,
		port: hibiscus.port,
		certSha256: wrong,
		getPassword: () => keychain.read()
	});
	const before = hibiscus.requests.length;

	await assert.rejects(client.accounts(), (/** @type {any} */ e) => {
		assert.ok(e instanceof PinMismatchError);
		assert.equal(e.fingerprint, hibiscus.fingerprint);
		return true;
	});
	await assert.rejects(client.transactions('1', '2026-01-01'), PinMismatchError);

	assert.equal(keychain.reads, 0, 'password never read');
	assert.equal(hibiscus.requests.length, before, 'no HTTP request reached the server');
});

test('pin match: the password goes out, over the checked connection', async () => {
	const keychain = memoryKeychain(FAKE_PASSWORD);
	const client = createHibiscusClient({
		host: hibiscus.host,
		port: hibiscus.port,
		// Any spelling of the same fingerprint.
		certSha256: hibiscus.fingerprint.replace(/:/g, '').toLowerCase(),
		getPassword: () => keychain.read()
	});
	const accounts = await client.accounts();
	assert.equal(accounts.length, 2);
	assert.equal(keychain.reads, 1);
	assert.equal(hibiscus.requests.at(-1)?.authorized, true);
});

test('a wrong password is a clear 401 error', async () => {
	const client = createHibiscusClient({
		host: hibiscus.host,
		port: hibiscus.port,
		certSha256: hibiscus.fingerprint,
		getPassword: async () => 'not-the-password'
	});
	await assert.rejects(client.accounts(), /refused the master password/);
});

test('without a pinned certificate there is no client', () => {
	assert.throws(
		() =>
			createHibiscusClient({
				host: '127.0.0.1',
				port: 1,
				certSha256: '',
				getPassword: async () => 'x'
			}),
		/No pinned certificate/
	);
});

test('an unreachable Hibiscus says so, without asking the keychain', async () => {
	const keychain = memoryKeychain(FAKE_PASSWORD);
	const client = createHibiscusClient({
		host: '127.0.0.1',
		port: 1,
		certSha256: hibiscus.fingerprint,
		getPassword: () => keychain.read()
	});
	await assert.rejects(client.accounts(), /Cannot reach Hibiscus/);
	assert.equal(keychain.reads, 0);
});

// Secrets only after attestation (#584): a VM with a changed image gets no
// secret. A stand-in for the guest's attestation agent (RA-TLS certificate,
// fresh reports, the owner-checked injection; after relay-button's
// attest-wasm tests) records every secret it receives; the unlock is the
// owner's (rootfs/test/release.mjs, the code the live run uses).
//
// The AMD signature chain is stubbed (relay-button's attest-wasm tests cover
// it); the RA-TLS handshake, the measurement check, the key binding and the
// fresh report are the real WASM code.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

// @peculiar/x509 needs the reflect polyfill, which @libp2p/webrtc loads (as in lan-relay.js).
import '@libp2p/webrtc';
import * as x509 from '@peculiar/x509';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import * as wasm from '@le-space/attest-wasm/pkg/relay_button_attest.js';
import { canonicalSecretsJson } from '@le-space/attest-wasm/ratls';

import { addressOf, newBackupKey, personalSign } from '../src/aleph-backup.js';
import { releaseCheck, unlockHosted } from '../rootfs/test/release.mjs';

const require = createRequire(import.meta.url);
wasm.initSync({
	module: await readFile(require.resolve('@le-space/attest-wasm/pkg/relay_button_attest_bg.wasm'))
});

const REPORT_DATA = 0x50;
const MEASUREMENT = 0x90;
const POLICY = 0x30000;
const IMAGE = 'c'.repeat(64);
const OTHER_IMAGE = 'd'.repeat(64);
const PUBLISHED = '11'.repeat(48);
const CHANGED = '22'.repeat(48);
const CRN = 'e'.repeat(64);
const VM = 'a'.repeat(64);

const ownerKey = newBackupKey();
const owner = addressOf(ownerKey);
const sign = async (/** @type {string} */ payload) => personalSign(ownerKey, payload);

/** Aleph's SEV-SNP runtime for this owner, as the unlocking side computes it. */
const published = {
	policy: POLICY,
	measurements: [{ platform: 'sev_snp', registers: { launch: PUBLISHED }, vcpu_type: 'EPYC-v4' }]
};
/** The INSTANCE message's content, by default the published image for the owner. */
const instance = (/** @type {Record<string, any>} */ over = {}) => ({
	address: owner,
	rootfs: { parent: { ref: IMAGE, use_latest: true }, persistence: 'host', size_mib: 10240 },
	environment: { trusted_execution: published },
	...over
});

const sha = (/** @type {string} */ algorithm, /** @type {Uint8Array[]} */ ...parts) => {
	const hash = createHash(algorithm);
	for (const part of parts) hash.update(part);
	return hash.digest();
};
const bound = (/** @type {string} */ domain, /** @type {Uint8Array[]} */ ...parts) => {
	const data = Buffer.alloc(64);
	sha('sha384', Buffer.from(`${domain}\0`), ...parts).copy(data);
	return data;
};

/** An SEV-SNP report (v3, policy, measurement and CPU set) binding `data`. */
function report(/** @type {string} */ measurement, /** @type {Buffer} */ data) {
	const r = Buffer.alloc(0x4a0);
	r.writeUInt32LE(3, 0);
	r.writeBigUInt64LE(BigInt(POLICY), 0x08);
	data.copy(r, REPORT_DATA);
	Buffer.from(measurement, 'hex').copy(r, MEASUREMENT);
	// CPUID family and model: Milan (AMD EPYC 7003).
	r[0x188] = 0x19;
	r[0x189] = 0x01;
	return r;
}

/** Recover the address that signed `payload` with personal_sign. */
function signer(/** @type {string} */ payload, /** @type {string} */ signature) {
	const body = new TextEncoder().encode(payload);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const sig = Buffer.from(signature.slice(2), 'hex');
	const recovered = new Uint8Array([sig[64] - 27, ...sig.subarray(0, 64)]);
	const point = secp256k1.recoverPublicKey(
		recovered,
		keccak_256(new Uint8Array([...prefix, ...body])),
		{
			prehash: false
		}
	);
	const full = secp256k1.Point.fromBytes(point).toBytes(false).slice(1);
	return `0x${Buffer.from(keccak_256(full).slice(-20)).toString('hex')}`;
}

/**
 * The guest's attestation agent, reporting `measurement`: what the VM's
 * runtime really is. It keeps every secret it is given.
 */
async function guest(/** @type {string} */ measurement) {
	x509.cryptoProvider.set(/** @type {any} */ (webcrypto));
	const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const servedKey = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey));
	const inCert = report(measurement, bound('aleph-attest-tls-key-v1', servedKey));
	const json = Buffer.from(JSON.stringify({ tee_type: 'sev-snp', data: inCert.toString('hex') }));
	const cert = await x509.X509CertificateGenerator.createSelfSigned({
		serialNumber: '01',
		name: 'CN=guest.invalid',
		notBefore: new Date(Date.now() - 60_000),
		notAfter: new Date(Date.now() + 3_600_000),
		signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
		keys: /** @type {any} */ (keys),
		extensions: [
			new x509.Extension(
				'1.3.6.1.4.1.60000.1.1',
				false,
				// DER OCTET STRING of the report's JSON (aleph-rs encode_attestation_extension)
				Buffer.concat([Buffer.from([0x04, 0x82, json.length >> 8, json.length & 0xff]), json])
			)
		]
	});
	const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
	const key = `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`;

	/** @type {Record<string, string>} */
	const received = {};
	let connections = 0;
	const server = tls.createServer({ cert: cert.toString('pem'), key }, (socket) => {
		let buffer = Buffer.alloc(0);
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			const request = parse(buffer);
			if (!request) return;
			buffer = Buffer.alloc(0);
			const respond = (/** @type {number} */ status, /** @type {unknown} */ body) => {
				const payload = Buffer.from(JSON.stringify(body));
				socket.write(
					`HTTP/1.1 ${status} OK\r\ncontent-type: application/json\r\ncontent-length: ${payload.length}\r\n\r\n`
				);
				socket.write(payload);
			};
			if (request.path.startsWith('/.well-known/attestation?nonce=')) {
				const nonce = Buffer.from(request.path.split('=')[1], 'hex');
				const fresh = report(measurement, bound('aleph-attest-fresh-v1', servedKey, nonce));
				respond(200, { tee_type: 'sev-snp', data: fresh.toString('hex') });
			} else if (request.method === 'POST' && request.path === '/confidential/inject-secret') {
				const { secrets, signature } = JSON.parse(request.body);
				const payload = `aleph-snp-inject-secret-v1|${sha('sha384', servedKey).toString('hex')}|${sha('sha256', Buffer.from(canonicalSecretsJson(secrets))).toString('hex')}`;
				if (signer(payload, signature) !== owner.toLowerCase()) {
					return respond(403, { error: 'not the owner' });
				}
				Object.assign(received, secrets);
				respond(200, { injected: Object.keys(secrets) });
			} else {
				respond(404, {});
			}
		});
	});
	// Counted on TCP: a client that ends the handshake never gets a TLS socket.
	server.on('connection', () => (connections += 1));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		received,
		connections: () => connections,
		/** The transport the browser gets from the attest relay, here a TCP socket. */
		transport: () => {
			const socket = net.connect(port, '127.0.0.1');
			return {
				opened: new Promise((resolve, reject) =>
					socket.once('connect', resolve).once('error', reject)
				),
				send: (/** @type {Uint8Array} */ bytes) => socket.write(bytes),
				onData: (/** @type {(b: Uint8Array) => void} */ callback) =>
					socket.on('data', (chunk) => callback(new Uint8Array(chunk))),
				onClose: (/** @type {() => void} */ callback) => socket.on('close', callback),
				close: () => socket.destroy()
			};
		},
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}

/** @param {Buffer} buffer */
function parse(buffer) {
	const text = buffer.toString('latin1');
	const end = text.indexOf('\r\n\r\n');
	if (end < 0) return null;
	const [line, ...headers] = text.slice(0, end).split('\r\n');
	const [method, path] = line.split(' ');
	const length = Number(
		headers.find((h) => h.toLowerCase().startsWith('content-length:'))?.split(':')[1] ?? 0
	);
	const body = buffer.subarray(end + 4);
	if (body.length < length) return null;
	return { method, path, body: body.subarray(0, length).toString() };
}

// The AMD chain is the stub; the measurement is still held against the pins.
const verify = async (/** @type {any} */ { report: r, expectedMeasurements }) => {
	const measurement = Buffer.from(r)
		.subarray(MEASUREMENT, MEASUREMENT + 48)
		.toString('hex');
	if (!expectedMeasurements.includes(measurement)) throw new Error('measurement not pinned');
	return { verified: true, measurement, policy: `0x${POLICY.toString(16)}`, launchTcb: {} };
};

const SECRETS = { imap: 'not-a-real-password', bridge_config: '{}' };

/** The owner's unlock of `vm` (an agent), for `content` (the INSTANCE). */
const unlock = (/** @type {any} */ vm, /** @type {any} */ content) =>
	unlockHosted({
		instance: content,
		published,
		image: IMAGE,
		owner,
		wasm,
		relayUrl: 'wss://relay.example/attest',
		crnHash: CRN,
		instanceItemHash: VM,
		passphrase: 'not-the-real-passphrase',
		secrets: SECRETS,
		sign,
		verify,
		transport: vm.transport,
		sleep: async () => assert.fail('a verdict is not retried'),
		attempts: 1
	});

/** @type {any[]} */
const guests = [];
const started = async (/** @type {string} */ m) => {
	const g = await guest(m);
	guests.push(g);
	return g;
};
before(() => x509.cryptoProvider.set(/** @type {any} */ (webcrypto)));
after(() => Promise.all(guests.map((g) => g.close())));

test('the published image on the published runtime gets its secrets, with the passphrase', async () => {
	const vm = await started(PUBLISHED);
	const result = await unlock(vm, instance());
	assert.equal(result.measurement, PUBLISHED);
	assert.deepEqual(Object.keys(vm.received).sort(), ['bridge_config', 'imap', 'luks_passphrase']);
});

test('a changed runtime (kernel, initrd, firmware) ends the handshake: no secret', async () => {
	const vm = await started(CHANGED);
	await assert.rejects(unlock(vm, instance()), /measurement/);
	assert.equal(vm.connections(), 1);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE that boots another image gets no secret, and is not even dialled', async () => {
	const vm = await started(PUBLISHED);
	await assert.rejects(
		unlock(vm, instance({ rootfs: { parent: { ref: OTHER_IMAGE, use_latest: true } } })),
		/another image than the published one: no secret goes out/
	);
	await assert.rejects(
		unlock(vm, instance({ rootfs: undefined })),
		/another image than the published one/
	);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE that pins another measurement, or none, gets no secret', async () => {
	const vm = await started(CHANGED);
	const pinning = (/** @type {any} */ tee) => instance({ environment: { trusted_execution: tee } });
	await assert.rejects(
		unlock(
			vm,
			pinning({
				...published,
				measurements: [{ platform: 'sev_snp', registers: { launch: CHANGED } }]
			})
		),
		/a measurement other than the published one/
	);
	await assert.rejects(
		unlock(vm, pinning({ ...published, policy: 0x10000 })),
		/a measurement other than the published one/
	);
	await assert.rejects(unlock(vm, pinning(undefined)), /pins no SEV-SNP measurement/);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE of someone else gets no secret', async () => {
	const vm = await started(PUBLISHED);
	await assert.rejects(
		unlock(vm, instance({ address: addressOf(newBackupKey()) })),
		/not the owner’s/
	);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('releaseCheck returns the pins to attest with', () => {
	assert.deepEqual(releaseCheck({ instance: instance(), published, image: IMAGE, owner }), {
		expectedMeasurements: [PUBLISHED],
		expectedPolicy: POLICY
	});
	assert.throws(
		() => releaseCheck({ instance: instance(), published, image: 'latest', owner }),
		/not a STORE hash/
	);
});

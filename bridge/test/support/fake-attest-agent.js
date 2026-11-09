// A stand-in for the attestation agent in an Aleph confidential VM (#584,
// #585), after relay-button's attest-wasm tests: an RA-TLS certificate whose
// SEV-SNP report binds its key, fresh reports bound to the client's nonce,
// and the injection the owner signs (personal_sign). It keeps every secret it
// is given, so a test can say which ones arrived.
//
// The reports carry `measurement`, what the VM's runtime "really" is; the AMD
// signature is not real, so a test passes `fakeVerify` where attest-wasm
// takes `verify` (relay-button's own tests cover the AMD chain).
import { createHash, webcrypto } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

// @peculiar/x509 needs the reflect polyfill, which @libp2p/webrtc loads (as in lan-relay.js).
import '@libp2p/webrtc';
import * as x509 from '@peculiar/x509';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { canonicalSecretsJson } from '@le-space/attest-wasm/ratls';

const REPORT_DATA = 0x50;
const MEASUREMENT = 0x90;
/** The guest policy the reports carry. */
export const FAKE_POLICY = 0x30000;
const POLICY = FAKE_POLICY;

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

/**
 * The guest's attestation agent, reporting `measurement`, taking secrets
 * signed by `owner` only.
 *
 * @param {{ measurement: string, owner: string }} options
 */
export async function startFakeAttestAgent({ measurement, owner }) {
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
		port,
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

/** attest-wasm's `verify` without AMD: the measurement is still held against the pins. */
export const fakeVerify = async (/** @type {any} */ { report: r, expectedMeasurements }) => {
	const measurement = Buffer.from(r)
		.subarray(MEASUREMENT, MEASUREMENT + 48)
		.toString('hex');
	if (!expectedMeasurements.includes(measurement)) throw new Error('measurement not pinned');
	return { verified: true, measurement, policy: `0x${POLICY.toString(16)}`, launchTcb: {} };
};

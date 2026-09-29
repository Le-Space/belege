// Spike for #148 step 2c: the bridge's relay in the own network.
//
// A libp2p circuit-relay-v2 server that listens with WebRTC-Direct on one
// address only (never 0.0.0.0). A browser dials it by the certificate's hash
// in the multiaddr, so it needs no CA, no DNS name and no installed
// certificate, and an https page may dial it (WebRTC is no mixed content).
//
// Peer key and certificate are kept in a state directory, so the address,
// certhash included, survives a restart.
//
//   node relay.mjs --host 127.0.0.1 --port 4990 --dir out/state [--lifespan-days 365]
//
// Prints one JSON line `{ "ready": { peerId, addrs, certhash } }`, then counts only.

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { keychain } from '@libp2p/keychain';
import { ping } from '@libp2p/ping';
import { webRTCDirect } from '@libp2p/webrtc';
import { LevelDatastore } from 'datastore-level';
import { createLibp2p } from 'libp2p';

const { values } = parseArgs({
	options: {
		host: { type: 'string', default: '127.0.0.1' },
		port: { type: 'string', default: '4990' },
		dir: { type: 'string', default: 'out/state' },
		'lifespan-days': { type: 'string', default: '' },
		// The relay's own certificate, made once for this many days (0: the library's).
		'own-cert-days': { type: 'string', default: '0' }
	}
});
const host = String(values.host);
if (host === '0.0.0.0' || host === '::')
	throw new Error('Listens on one address only, never on all.');
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error('--host: an IPv4 address');
const port = Number(values.port);
const dir = String(values.dir);
await mkdir(dir, { recursive: true, mode: 0o700 });

/** The relay's peer key: made once, kept (0600). */
async function peerKey() {
	const file = join(dir, 'peer-key');
	try {
		return privateKeyFromProtobuf(await readFile(file));
	} catch {
		const key = await generateKeyPair('Ed25519');
		await writeFile(file, privateKeyToProtobuf(key), { mode: 0o600 });
		await chmod(file, 0o600);
		return key;
	}
}

/**
 * A certificate of the relay's own, valid for `days`: @libp2p/webrtc renews
 * the one it makes itself every 14 days (and then the certhash changes), but
 * never one it is given. P-256, as WebRTC-Direct requires.
 *
 * @param {number} days
 */
async function ownCertificate(days) {
	const keyFile = join(dir, 'cert-key.pem');
	const certFile = join(dir, 'cert.pem');
	try {
		await readFile(certFile);
	} catch {
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'ec',
				'-pkeyopt',
				'ec_paramgen_curve:P-256',
				'-nodes',
				'-keyout',
				keyFile,
				'-out',
				certFile,
				'-days',
				String(days),
				'-subj',
				'/CN=belege-lan-relay'
			],
			{ stdio: 'ignore' }
		);
		await chmod(keyFile, 0o600);
	}
	const pem = await readFile(certFile, 'utf8');
	const der = new X509Certificate(pem).raw;
	// multibase base64url ('u') of the sha2-256 multihash of the DER.
	const multihash = Buffer.concat([
		Buffer.from([0x12, 0x20]),
		createHash('sha256').update(der).digest()
	]);
	return {
		privateKey: await readFile(keyFile, 'utf8'),
		pem,
		certhash: `u${multihash.toString('base64url')}`
	};
}

const ownCertDays = Number(values['own-cert-days']);
const lifespanDays = Number(values['lifespan-days']);
const datastore = new LevelDatastore(join(dir, 'datastore'));
await datastore.open();

const node = await createLibp2p({
	privateKey: await peerKey(),
	datastore,
	addresses: { listen: [`/ip4/${host}/udp/${port}/webrtc-direct`] },
	transports: [
		webRTCDirect({
			// No STUN: in the own network there is nothing to learn from outside.
			rtcConfiguration: { iceServers: [] },
			...(lifespanDays > 0 ? { certificateLifespan: lifespanDays * 86_400_000 } : {}),
			...(ownCertDays > 0 ? { certificate: await ownCertificate(ownCertDays) } : {})
		})
	],
	connectionEncrypters: [noise()],
	streamMuxers: [yamux()],
	services: {
		identify: identify(),
		ping: ping(),
		// The certificate's key is kept here, so the certhash stays (@libp2p/webrtc docs).
		// A spike's passphrase; the bridge would keep one in the macOS keychain.
		keychain: keychain({ pass: 'spike-only-passphrase-not-a-secret' }),
		relay: circuitRelayServer({ reservations: { maxReservations: 16 } })
	}
});

const addrs = node.getMultiaddrs().map(String);
const certhash = addrs.map((a) => /\/certhash\/([^/]+)/.exec(a)?.[1]).find(Boolean) ?? '';
console.log(
	JSON.stringify({
		ready: { peerId: node.peerId.toString(), addrs, certhash }
	})
);

let reservations = 0;
node.addEventListener('relay:reservation', () => {
	reservations++;
	console.log(JSON.stringify({ reservations }));
});

const stop = async () => {
	await node.stop();
	await datastore.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

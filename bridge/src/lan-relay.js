// The bridge's relay in the own network (issue #148, step 2c): own devices
// meet here instead of at a public relay.
//
// A libp2p circuit-relay-v2 server that listens with WebRTC-Direct on one
// address of this Mac in the local network – never 0.0.0.0, never port
// forwarded. A browser dials it by the certificate's hash in the address, so
// it needs no CA, no DNS name and nothing installed on a phone, and an https
// page may dial it: WebRTC is no mixed content (spike: spikes/lan-relay).
//
// The certificate is the relay's own, made once, valid for ten years:
// @libp2p/webrtc renews the one it makes itself every 14 days, and then the
// certhash – and with it the address the books keep – changes; one it is
// given it never renews. Peer key and certificate are kept next to
// bridge.json (lan-relay/, 0700; keys 0600), so the address survives restarts.
//
// No STUN: in the own network there is nothing to learn from outside.
// Anyone in the network may reserve (at most MAX_RESERVATIONS); a relay only
// forwards what the devices seal with Noise, and the books' device gate lets
// nobody without the passkey have anything. The log has counts only.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { webcrypto, createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { webRTCDirect } from '@libp2p/webrtc';
import * as x509 from '@peculiar/x509';
import { createLibp2p } from 'libp2p';

export { DEFAULT_LAN_RELAY_PORT } from './lan-relay-port.js';
export const MAX_RESERVATIONS = 32;
/** The certificate's life: long, since a new one is a new address for every device. */
export const CERT_DAYS = 3650;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * An address in a private network (RFC 1918): 10/8, 172.16/12, 192.168/16.
 *
 * @param {string} ip
 */
export function isPrivateIPv4(ip) {
	const m = IPV4.exec(String(ip));
	if (!m) return false;
	const [a, b, c, d] = m.slice(1).map(Number);
	if ([a, b, c, d].some((n) => n > 255)) return false;
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * This Mac's IPv4 addresses in a private network, with their interface.
 *
 * @param {ReturnType<typeof networkInterfaces>} [interfaces]
 * @returns {{ name: string, address: string }[]}
 */
export function lanAddresses(interfaces = networkInterfaces()) {
	return Object.entries(interfaces).flatMap(([name, list]) =>
		(list ?? [])
			.filter((i) => i.family === 'IPv4' && !i.internal && isPrivateIPv4(i.address))
			.map((i) => ({ name, address: i.address }))
	);
}

/**
 * Where the relay may listen: an address this Mac has in a private network
 * right now (or 127.0.0.1 for the E2E suite). Never all addresses.
 *
 * @param {unknown} host
 * @param {{ interfaces?: ReturnType<typeof networkInterfaces>, allowLoopback?: boolean }} [options]
 * @returns {string | null} why not, or null when it may
 */
export function hostProblem(
	host,
	{ interfaces = networkInterfaces(), allowLoopback = false } = {}
) {
	const ip = String(host ?? '');
	if (allowLoopback && ip === '127.0.0.1') return null;
	if (!isPrivateIPv4(ip)) return 'not an IPv4 address in a private network';
	if (!lanAddresses(interfaces).some((a) => a.address === ip)) {
		return 'not an address of this Mac right now';
	}
	return null;
}

/**
 * Whether the UDP port is free on that address. Asked before libp2p is: its
 * WebRTC stack (node-datachannel) aborts the whole process when it cannot
 * bind, instead of throwing.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function udpPortFree(host, port) {
	return new Promise((resolve) => {
		const socket = createSocket('udp4');
		socket.once('error', () => {
			socket.close();
			resolve(false);
		});
		socket.bind({ address: host, port, exclusive: true }, () => {
			socket.close(() => resolve(true));
		});
	});
}

/** @param {string} dir */
async function peerKey(dir) {
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
 * The certhash of a certificate: multibase base64url ('u') of its sha2-256
 * multihash (0x12 0x20 ‖ digest).
 *
 * @param {Uint8Array} der
 */
export function certhashOf(der) {
	const digest = createHash('sha256').update(der).digest();
	return `u${Buffer.concat([Buffer.from([0x12, 0x20]), digest]).toString('base64url')}`;
}

/**
 * The relay's certificate: P-256, as WebRTC-Direct requires; made once.
 *
 * @param {string} dir
 * @param {() => Date} [now]
 * @returns {Promise<{ privateKey: string, pem: string, certhash: string }>}
 */
export async function relayCertificate(dir, now = () => new Date()) {
	const keyFile = join(dir, 'cert-key.pem');
	const certFile = join(dir, 'cert.pem');
	try {
		const pem = await readFile(certFile, 'utf8');
		const privateKey = await readFile(keyFile, 'utf8');
		const cert = new x509.X509Certificate(pem);
		if (cert.notAfter.getTime() > now().getTime()) {
			return { privateKey, pem, certhash: certhashOf(new Uint8Array(cert.rawData)) };
		}
	} catch {
		// None yet (or unreadable): a new one.
	}
	x509.cryptoProvider.set(/** @type {any} */ (webcrypto));
	const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const notBefore = now();
	notBefore.setMilliseconds(0);
	const cert = await x509.X509CertificateGenerator.createSelfSigned({
		serialNumber: Buffer.from(webcrypto.getRandomValues(new Uint8Array(8))).toString('hex'),
		name: 'CN=belege-lan-relay',
		notBefore,
		notAfter: new Date(notBefore.getTime() + CERT_DAYS * 86_400_000),
		signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
		keys: /** @type {any} */ (keys),
		extensions: [new x509.BasicConstraintsExtension(false, undefined, true)]
	});
	const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
	const privateKey = [
		'-----BEGIN PRIVATE KEY-----',
		...(pkcs8.toString('base64').match(/.{1,64}/g) ?? []),
		'-----END PRIVATE KEY-----'
	].join('\n');
	const pem = cert.toString('pem');
	await writeFile(keyFile, privateKey, { mode: 0o600 });
	await chmod(keyFile, 0o600);
	await writeFile(certFile, pem, { mode: 0o600 });
	return { privateKey, pem, certhash: certhashOf(new Uint8Array(cert.rawData)) };
}

/**
 * Start the relay.
 *
 * @param {object} p
 * @param {string} p.host an address of this Mac in the private network (hostProblem)
 * @param {number} p.port UDP
 * @param {string} p.dir where peer key and certificate are kept
 * @param {boolean} [p.allowLoopback] 127.0.0.1, for the E2E suite
 * @param {ReturnType<typeof networkInterfaces>} [p.interfaces]
 * @param {(line: string) => void} [p.log] counts only
 */
export async function startLanRelay({
	host,
	port,
	dir,
	allowLoopback = false,
	interfaces = networkInterfaces(),
	log = () => {}
}) {
	const problem = hostProblem(host, { interfaces, allowLoopback });
	if (problem) throw new Error(`LAN relay: ${host} is ${problem}`);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error('LAN relay: the port must be 1024–65535');
	}
	if (!(await udpPortFree(host, port))) {
		throw new Error(`LAN relay: UDP ${port} on ${host} is in use`);
	}
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);

	const node = await createLibp2p({
		privateKey: await peerKey(dir),
		addresses: { listen: [`/ip4/${host}/udp/${port}/webrtc-direct`] },
		transports: [
			webRTCDirect({
				rtcConfiguration: { iceServers: [] },
				certificate: await relayCertificate(dir)
			})
		],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			identify: identify(),
			relay: circuitRelayServer({ reservations: { maxReservations: MAX_RESERVATIONS } })
		}
	});

	let reservations = 0;
	node.addEventListener('relay:reservation', () => {
		reservations++;
		log(`LAN relay: ${reservations} reservation(s) since start`);
	});

	const addr = node
		.getMultiaddrs()
		.map(String)
		.find((a) => a.includes('/webrtc-direct/certhash/'));
	if (!addr) {
		await node.stop();
		throw new Error('LAN relay: no WebRTC-Direct address');
	}
	return {
		addr,
		peerId: node.peerId.toString(),
		stats: () => ({ reservations, connections: node.getConnections().length }),
		stop: () => node.stop()
	};
}

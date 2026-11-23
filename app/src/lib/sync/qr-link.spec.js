// A code counts as made in the room only when every address it offers is a
// host in the own network (first-contact.js): signed codes in both formats,
// made-up keys and addresses.
import { describe, expect, it } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { encodeCompactPayload, encodeSignedPayload } from '@le-space/libp2p-webrtc-qr';
import { madeInOwnNetwork, ownNetworkAddress, ownNetworkCandidate } from './qr-link.js';

const MDNS = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9.local';
const line = (/** @type {string} */ address, type = 'host') =>
	`candidate:1 1 udp 2122260223 ${address} 50000 typ ${type}`;

/** A signed invite in the full format, with these candidate lines. @param {string[]} lines */
async function fullCode(lines) {
	const key = await generateKeyPair('Ed25519');
	const sdp = ['v=0', 'a=fingerprint:sha-256 00', ...lines.map((l) => `a=${l}`), ''].join('\r\n');
	return encodeSignedPayload(key, {
		version: 2,
		type: 'offer',
		sessionId: 'made-up-session',
		peerId: peerIdFromPrivateKey(key).toString(),
		sdp
	});
}

/**
 * A signed invite in the compact format. Candidates packed as the library
 * packs them: kind (0 IPv4, 2 mDNS) | type index << 2, the address, the port.
 *
 * @param {{ kind: number, type: number, address: number[] }[]} candidates
 */
async function compactCode(candidates) {
	const key = await generateKeyPair('Ed25519');
	return encodeCompactPayload(key, {
		type: 'offer',
		sessionId: 'AAAAAAAAAAA',
		fingerprint: new Uint8Array(32).fill(1),
		peerId: peerIdFromPrivateKey(key).toString(),
		candidates: candidates.map(({ kind, type, address }) =>
			Uint8Array.from([kind | (type << 2), ...address, 0xc3, 0x50])
		)
	});
}

describe('the own network', () => {
	it('knows its addresses: mDNS, private and link-local', () => {
		for (const a of [MDNS, '10.1.2.3', '172.16.0.9', '192.168.178.20', '169.254.1.1']) {
			expect(ownNetworkAddress(a)).toBe(true);
		}
		for (const a of ['fd12:3456::1', 'fe80::1', '::1', '127.0.0.1'])
			expect(ownNetworkAddress(a)).toBe(true);
		for (const a of ['203.0.113.7', '172.32.0.1', '2001:db8::1', 'example.com', '']) {
			expect(ownNetworkAddress(a)).toBe(false);
		}
	});

	it('takes host candidates there only', () => {
		expect(ownNetworkCandidate(line(MDNS))).toBe(true);
		expect(ownNetworkCandidate(`a=${line('192.168.0.5')}`)).toBe(true);
		expect(ownNetworkCandidate(line('203.0.113.7'))).toBe(false);
		expect(ownNetworkCandidate(line('192.168.0.5', 'srflx'))).toBe(false);
		expect(ownNetworkCandidate(line('192.168.0.5', 'relay'))).toBe(false);
		expect(ownNetworkCandidate('candidate:nonsense')).toBe(false);
	});
});

describe('a code made in the own network', () => {
	it('in the full format: only when every address is a host there', async () => {
		expect(await madeInOwnNetwork(await fullCode([line(MDNS), line('192.168.0.5')]))).toBe(true);
		expect(await madeInOwnNetwork(await fullCode([line(MDNS), line('203.0.113.7')]))).toBe(false);
		expect(await madeInOwnNetwork(await fullCode([line('203.0.113.7', 'srflx')]))).toBe(false);
		expect(await madeInOwnNetwork(await fullCode([]))).toBe(false);
	});

	it('in the compact format: the same', async () => {
		const mdns = { kind: 2, type: 0, address: Array(16).fill(0xab) };
		expect(await madeInOwnNetwork(await compactCode([mdns]))).toBe(true);
		expect(
			await madeInOwnNetwork(
				await compactCode([mdns, { kind: 0, type: 0, address: [203, 0, 113, 7] }])
			)
		).toBe(false);
		expect(
			await madeInOwnNetwork(await compactCode([{ kind: 0, type: 1, address: [192, 168, 0, 5] }]))
		).toBe(false);
	});

	it('is not anything that is no code', async () => {
		expect(await madeInOwnNetwork('hello')).toBe(false);
		expect(await madeInOwnNetwork('')).toBe(false);
	});
});

// A scanned or linked invite marks its peer as met in the room only when the
// code offers hosts in the own network alone (sync/first-contact.js). Made-up
// keys and addresses; the QR session answers without WebRTC.
import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { encodeSignedPayload } from '@le-space/libp2p-webrtc-qr';

vi.mock('$lib/bridge-connection/local.js', () => ({
	loadBridgeAuth: async () => null,
	startBridgeForDevices: async () => null
}));
vi.mock('./refresh.js', () => ({ runMatchingNow: async () => {} }));
vi.mock('$lib/sync/qr-link.js', async (actual) => ({
	.../** @type {any} */ (await actual()),
	qrSession: () => ({ acceptOffer: async () => 'answer' })
}));

import { qrPeers } from '$lib/sync/qr-link.js';
import { qrScanned } from './devices.js';

/** An invite whose only address is `address`. @param {string} address */
async function invite(address) {
	const key = await generateKeyPair('Ed25519');
	const peerId = peerIdFromPrivateKey(key).toString();
	const sdp = `v=0\r\na=candidate:1 1 udp 2122260223 ${address} 50000 typ host\r\n`;
	const code = await encodeSignedPayload(key, {
		version: 2,
		type: 'offer',
		sessionId: 'made-up-session',
		peerId,
		sdp
	});
	return { code, peerId };
}

describe('an invite scanned or opened by link', () => {
	it('made in the own network: its peer is met in the room', async () => {
		const { code, peerId } = await invite('1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9.local');
		expect(await qrScanned(code)).toEqual({ answer: 'answer' });
		expect(qrPeers.has(peerId)).toBe(true);
	});

	it('with an address from elsewhere: answered, but its peer is not met in the room', async () => {
		const { code, peerId } = await invite('203.0.113.7');
		expect(await qrScanned(code)).toEqual({ answer: 'answer' });
		expect(qrPeers.has(peerId)).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';

import { firstContactPolicy, isLocalPath, relayPeerOf } from './first-contact.js';

// Made up: the bridge's relay, a public relay, a known and a new device.
const LAN_PEER = '12D3KooWNmFsNbztWUBmnaGf1xXyxABwMY1KiE41szzspFevFxqG';
const LAN_RELAY = `/ip4/192.168.10.23/udp/4990/webrtc-direct/certhash/uEiD3OphLir77I26uAdKgLdpMSBwo8PcLVg8IzkNU9XUteQ/p2p/${LAN_PEER}`;
const PUBLIC_PEER = '12D3KooWJYkVH5fxNwqYsMgG3HhvngMNtUAjM6LScejgy5LGFHho';
const KNOWN = '12D3KooWHWRpzzeMTRaaBCdgboQmVYYqdvSq4AyC9KyNADqnHXGg';
const NEW = '12D3KooWMNpd1v7wwWdRSGcnGCZ5RG7mh8Q3n2VPqa6rUrBQy3kX';

/** @param {string} peer @param {string} addr */
const conn = (peer, addr) => ({ remotePeer: peer, remoteAddr: addr });
const overPublic = (/** @type {string} */ peer) =>
	conn(peer, `/dns4/relay.example/tcp/443/wss/p2p/${PUBLIC_PEER}/p2p-circuit/p2p/${peer}`);
const overLan = (/** @type {string} */ peer) => conn(peer, `${LAN_RELAY}/p2p-circuit/p2p/${peer}`);
const direct = (/** @type {string} */ peer) => conn(peer, `/webrtc/p2p/${peer}`);

describe('first contact in "Beides" (#148)', () => {
	it("a relay's peer id is the end of its address", () => {
		expect(relayPeerOf(LAN_RELAY)).toBe(LAN_PEER);
		expect(relayPeerOf(null)).toBeNull();
	});

	it('the own network: through the bridge’s relay, or met by QR', () => {
		const local = { lanRelayPeer: LAN_PEER, qrPeers: new Set([NEW]) };
		expect(isLocalPath(overLan(KNOWN), local)).toBe(true);
		expect(isLocalPath(direct(NEW), local)).toBe(true);
		expect(isLocalPath(overPublic(KNOWN), local)).toBe(false);
		// A direct WebRTC connection negotiated over a public relay looks like a QR one: not local.
		expect(isLocalPath(direct(KNOWN), local)).toBe(false);
		expect(isLocalPath(overLan(KNOWN), { lanRelayPeer: null, qrPeers: new Set() })).toBe(false);
	});

	it('a new device over the own network only; a known one over any path', () => {
		const admit = firstContactPolicy({
			mode: 'both',
			knownPeers: new Set([KNOWN]),
			lanRelayPeer: LAN_PEER,
			qrPeers: new Set()
		});
		expect(admit(NEW, overPublic(NEW))).toBe(false);
		expect(admit(NEW, direct(NEW))).toBe(false);
		expect(admit(NEW, overLan(NEW))).toBe(true);
		expect(admit(KNOWN, overPublic(KNOWN))).toBe(true);
		expect(admit(KNOWN, direct(KNOWN))).toBe(true);
	});

	it('in every other mode, the proof is enough', () => {
		for (const mode of /** @type {const} */ (['public', 'qr', 'lan'])) {
			const admit = firstContactPolicy({
				mode,
				knownPeers: new Set(),
				lanRelayPeer: null,
				qrPeers: new Set()
			});
			expect(admit(NEW, overPublic(NEW))).toBe(true);
		}
	});
});

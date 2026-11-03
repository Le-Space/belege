// The relay light in the network menu: green while this node holds a place at
// a relay of the chosen kind, red when not. Made-up peer ids.
import { describe, expect, it } from 'vitest';

import { circuitRelayOf, relayLights } from './relay-light.js';

const PUBLIC = '12D3KooWQu5E1ZkGC5x2dSVTEWxYvsssWjXgk2Mzc8GZHN26cYzS';
const LAN = '12D3KooWNmFsNbztWUBmnaGf1xXyxABwMY1KiE41szzspFevFxqG';
const SELF = '12D3KooWE4CRxrYkVCwBxLXd7KJpcXuSABxG7iWb3xPZCwAkWBfW';
const publicRelay = `/dns4/relay.example/tcp/443/tls/ws/p2p/${PUBLIC}`;
const lanRelay = `/ip4/192.168.10.23/udp/4990/webrtc-direct/certhash/uEiD3/p2p/${LAN}`;
const at = (/** @type {string} */ relay) => `${relay}/p2p-circuit/p2p/${SELF}`;

describe('relay light', () => {
	it('reads the relay a circuit address goes through', () => {
		expect(circuitRelayOf(at(publicRelay))).toBe(PUBLIC);
		expect(circuitRelayOf('/webrtc/p2p/' + SELF)).toBeNull();
	});

	it('public: green with a place at a public relay, red without', () => {
		expect(
			relayLights({ mode: 'public', online: true, addrs: [at(publicRelay)], lanRelay: null })
		).toMatchObject({ public: 'up', lan: null, relays: { public: [PUBLIC] } });
		expect(
			relayLights({ mode: 'public', online: true, addrs: ['/webrtc'], lanRelay: null })
		).toMatchObject({ public: 'down', lan: null });
	});

	it('the own network: the bridge’s relay counts, a public one does not', () => {
		expect(
			relayLights({ mode: 'lan', online: true, addrs: [at(publicRelay)], lanRelay })
		).toMatchObject({ public: null, lan: 'down' });
		expect(
			relayLights({ mode: 'lan', online: true, addrs: [at(lanRelay)], lanRelay })
		).toMatchObject({ lan: 'up' });
	});

	it('both: each kind on its own', () => {
		expect(
			relayLights({ mode: 'both', online: true, addrs: [at(lanRelay)], lanRelay })
		).toMatchObject({ public: 'down', lan: 'up' });
	});

	it('no light when device sync is off or paused, nor for QR', () => {
		expect(
			relayLights({ mode: 'public', online: false, addrs: [at(publicRelay)], lanRelay: null })
		).toMatchObject({ public: null, lan: null });
		expect(relayLights({ mode: 'qr', online: true, addrs: [], lanRelay: null })).toMatchObject({
			public: null,
			lan: null
		});
	});
});

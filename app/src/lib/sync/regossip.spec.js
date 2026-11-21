import { describe, expect, it } from 'vitest';

import { isDirectAddr } from './device-sync.js';
import { connectionToRegossip, gossips, regossip } from './regossip.js';

const RELAY = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWRelayForTheSpec';
const PEER = '12D3KooWOtherDeviceForTheSpec';
const OUT = { protocol: '/meshsub/1.2.0', direction: 'outbound' };
const IN = { protocol: '/meshsub/1.2.0', direction: 'inbound' };
const IDENTIFY = { protocol: '/ipfs/id/1.0.0', direction: 'outbound' };

/** A relay's circuit, with the limits a relay puts on it unless told otherwise. */
const circuit = (/** @type {any[]} */ streams, limits = /** @type {any} */ ({ seconds: 120 })) => ({
	remoteAddr: `${RELAY}/p2p-circuit/p2p/${PEER}`,
	status: 'open',
	...(limits ? { limits } : {}),
	streams
});
/** The WebRTC connection the circuit signalled. */
const webrtc = (/** @type {any[]} */ streams, status = 'open') => ({
	remoteAddr: `${RELAY}/p2p-circuit/webrtc/p2p/${PEER}`,
	status,
	streams
});

const pick = (/** @type {any[]} */ connections) => connectionToRegossip(connections, isDirectAddr);

describe('which connection gossipsub is put on', () => {
	it('none while this node still talks to the device', () => {
		// As two devices are right after they met: gossipsub on the circuit,
		// WebRTC beside it with no stream of gossipsub's.
		expect(pick([circuit([OUT, IN]), webrtc([IDENTIFY])])).toBeNull();
	});

	it('the direct one that is left when the circuit took the streams with it (#393)', () => {
		const direct = webrtc([IDENTIFY]);
		expect(pick([direct])).toBe(direct);
	});

	it('also when the other device already opened its stream: this node still says nothing', () => {
		const direct = webrtc([IN]);
		expect(pick([direct])).toBe(direct);
	});

	it('none when nothing is left: the disconnect does the rest', () => {
		expect(pick([])).toBeNull();
		expect(pick([webrtc([], 'closed')])).toBeNull();
	});

	it('a connection without limits before a limited one, a direct one before a relayed one', () => {
		const limited = circuit([]);
		const relayed = circuit([], null);
		const direct = webrtc([]);
		expect(pick([limited, relayed, direct])).toBe(direct);
		expect(pick([limited, relayed])).toBe(relayed);
		expect(pick([limited])).toBe(limited);
	});

	it('ignores a stream on a connection that is closing', () => {
		const direct = webrtc([]);
		expect(pick([{ ...circuit([OUT, IN]), status: 'closing' }, direct])).toBe(direct);
	});
});

describe('gossips', () => {
	it('tells what this node says from what it hears', () => {
		expect(gossips([webrtc([IN])], 'inbound')).toBe(true);
		expect(gossips([webrtc([IN])], 'outbound')).toBe(false);
		// A stream that does not say which way it runs counts for both.
		expect(gossips([webrtc([{ protocol: '/meshsub/1.2.0' }])], 'outbound')).toBe(true);
		expect(gossips([webrtc([IDENTIFY])], 'outbound')).toBe(false);
	});
});

describe('telling gossipsub of a connection', () => {
	it('calls the topology gossipsub registered, once, as a new connection would', () => {
		/** @type {any[][]} */
		const told = [];
		const topology = { onConnect: (/** @type {any[]} */ ...args) => told.push(args) };
		const libp2p = {
			services: { pubsub: { protocols: ['/meshsub/1.2.0', '/meshsub/1.1.0'] } },
			// The same topology under every protocol, as gossipsub registers it.
			components: { registrar: { getTopologies: () => [topology] } }
		};
		const connection = { ...webrtc([]), remotePeer: PEER };
		expect(regossip(libp2p, connection)).toBe(true);
		expect(told).toEqual([[PEER, connection]]);
	});

	it('says so when there is nothing to tell', () => {
		const connection = { ...webrtc([]), remotePeer: PEER };
		expect(regossip({ services: {} }, connection)).toBe(false);
		expect(
			regossip(
				{
					services: { pubsub: { protocols: ['/meshsub/1.2.0'] } },
					components: { registrar: { getTopologies: () => [] } }
				},
				connection
			)
		).toBe(false);
	});
});

// The node to the bridge on this machine (#580): it dials 127.0.0.1 or ::1
// and nothing else, finds the node's WebSocket in what /health tells, and
// lets in the books' bridge only. Made-up addresses and peer ids.
import { describe, expect, it } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';

import { loopbackAddr, loopbackConfig, onThisMachine } from './loopback-bridge.js';

const PEER = '12D3KooWBridgeBridgeBridgeBridgeBridgeBridgeBridgeBri';

describe('the node to the bridge on this machine', () => {
	it('dials this machine only, and takes no connection in', () => {
		const gate = /** @type {any} */ ({ service: () => ({}), onProved: () => () => {} });
		const config = /** @type {any} */ (loopbackConfig({ privateKey: undefined, gate }));
		const deny = config.connectionGater.denyDialMultiaddr;
		expect(deny(multiaddr('/ip4/127.0.0.1/tcp/4423/ws'))).toBe(false);
		expect(deny(multiaddr('/ip6/::1/tcp/4423/ws'))).toBe(false);
		for (const addr of [
			'/ip4/192.168.1.20/tcp/4423/ws',
			'/ip4/10.0.0.2/tcp/4423/ws',
			'/dns4/relay.example.com/tcp/443/tls/ws',
			'/ip4/203.0.113.5/tcp/4423/ws'
		])
			expect(deny(multiaddr(addr)), addr).toBe(true);
		expect(config.connectionGater.denyInboundConnection()).toBe(true);
		expect(config.addresses.listen).toEqual([]);
		expect(Object.keys(config.services)).not.toContain('pubsub');
		expect(onThisMachine('not an address')).toBe(false);
	});

	it('the node’s WebSocket on 127.0.0.1 from /health, nothing else', () => {
		expect(
			loopbackAddr([
				`/ip4/192.168.1.20/tcp/4423/ws/p2p/${PEER}`,
				`/ip4/127.0.0.1/tcp/4423/ws/p2p/${PEER}`
			])
		).toBe('/ip4/127.0.0.1/tcp/4423/ws');
		expect(loopbackAddr([`/ip4/127.0.0.1/tcp/4424/p2p/${PEER}`])).toBe(null);
		expect(loopbackAddr(['/dns4/relay.example.com/tcp/443/tls/ws/p2p-circuit'])).toBe(null);
		expect(loopbackAddr(null)).toBe(null);
	});
});

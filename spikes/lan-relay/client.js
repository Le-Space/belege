// The browser side of the spike (bundled by run.mjs): the transports belege's
// sync node has, plus WebRTC-Direct to reach the bridge's relay. No STUN.
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2p } from 'libp2p';

const rtcConfiguration = { iceServers: [] };

/** @type {any} */
let node;

/** @type {any} */ (window).spike = {
	/** @param {string} relay the relay's webrtc-direct address */
	async start(relay) {
		node = await createLibp2p({
			addresses: { listen: [`${relay}/p2p-circuit`, '/webrtc'] },
			transports: [
				webRTCDirect({ rtcConfiguration }),
				webRTC({ rtcConfiguration }),
				circuitRelayTransport()
			],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			connectionGater: { denyDialMultiaddr: () => false },
			services: { identify: identify(), ping: ping() }
		});
		const t0 = performance.now();
		for (let i = 0; i < 100; i++) {
			if (node.getMultiaddrs().some((/** @type {any} */ a) => String(a).includes('/p2p-circuit')))
				break;
			await new Promise((r) => setTimeout(r, 200));
		}
		return {
			peerId: node.peerId.toString(),
			addrs: node.getMultiaddrs().map(String),
			reservedMs: Math.round(performance.now() - t0),
			secure: window.isSecureContext,
			origin: location.origin
		};
	},
	/** Meet another browser through the relay, then directly over WebRTC. @param {string} relay @param {string} peerId */
	async meet(relay, peerId) {
		const direct = await node.dial(multiaddr(`${relay}/p2p-circuit/webrtc/p2p/${peerId}`), {
			signal: AbortSignal.timeout(30_000)
		});
		const rtt = await node.services.ping.ping(direct.remoteAddr, {
			signal: AbortSignal.timeout(10_000)
		});
		return {
			remoteAddr: String(direct.remoteAddr),
			limited: Boolean(direct.limited),
			rtt,
			connections: node.getConnections().map((/** @type {any} */ c) => ({
				peer: c.remotePeer.toString(),
				addr: String(c.remoteAddr),
				limited: Boolean(c.limited)
			}))
		};
	},
	async stop() {
		await node?.stop();
	}
};

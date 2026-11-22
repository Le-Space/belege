// The node of a new device that joins books with its own passkey (#962,
// session/own-join.js): it exists before there are books here, so its key is
// one of the moment, not the device's. It answers one invite by QR, serves
// only the vault's handover (vault-handover.js) to that one device, runs no
// service – no identify, no gossipsub – and dials nothing of its own.

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webRTCQR } from '@le-space/libp2p-webrtc-qr';

import { NODE_INFO } from './quiet-identify.js';

/**
 * @param {{ privateKey: any, getOutboundSession: (peer: string) => any }} params
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function joinLibp2pConfig({ privateKey, getOutboundSession }) {
	return {
		privateKey,
		nodeInfo: NODE_INFO,
		addresses: { listen: [] },
		transports: [
			// Its bundled types name a listener libp2p's no longer matches (qr-link.js).
			/** @type {any} */ (
				webRTCQR({
					getOutboundSession: (/** @type {any} */ peer) => getOutboundSession(String(peer))
				})
			)
		],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [],
		connectionGater: { denyDialMultiaddr: () => true }
	};
}

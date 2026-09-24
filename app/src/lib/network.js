// The libp2p node under Helia and OrbitDB: prepared for P2P, used offline.
//
// OrbitDB needs a libp2p with a pubsub service (its sync subscribes to one
// topic per database), and Helia needs libp2p to exist. Neither needs a
// connection to anyone for a single device to read and write its own books,
// so this node has no transports, dials nobody, listens nowhere and has no
// peer discovery. Everything stays in this browser.
//
// TODO(p2p): syncing between a person's own devices comes later. Then
// `P2P_ENABLED` becomes a setting and the config comes from
// Le-Space/simple-todo `packages/net/src/libp2p-config.js` (`createLibp2pConfig`):
// WebSockets + WebRTC transports, circuit-relay-v2, the relay bootstrap list,
// pubsub peer discovery, autoNAT and dcutr. Keep gossipsub's
// `runOnLimitedConnection: true` from there — OrbitDB sync over a relayed
// connection depends on it. The data is sealed before it reaches the log, so a
// relay or a peer only ever sees ciphertext.

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';

/** Off until device sync exists; see the TODO above. */
export const P2P_ENABLED = false;

/** @returns {import('libp2p').Libp2pOptions<any>} */
export function createOfflineLibp2pConfig() {
	return {
		addresses: { listen: [] },
		transports: [],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [],
		services: {
			identify: identify(),
			pubsub: gossipsub({
				emitSelf: false,
				// OrbitDB publishes its heads whether or not anybody listens.
				allowPublishToZeroTopicPeers: true,
				runOnLimitedConnection: true
			})
		}
	};
}

/** @returns {Promise<any>} a started libp2p node that talks to nobody */
export async function createOfflineLibp2p() {
	if (P2P_ENABLED) {
		throw new Error('P2P is not implemented yet; see the TODO in network.js.');
	}
	return createLibp2p(createOfflineLibp2pConfig());
}

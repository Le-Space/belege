// The libp2p node under Helia and OrbitDB: prepared for P2P, used offline.
//
// OrbitDB needs a libp2p with a pubsub service (its sync subscribes to one
// topic per database), and Helia needs libp2p to exist. Neither needs a
// connection to anyone for a single device to read and write its own books,
// so this node has no transports, dials nobody, listens nowhere and has no
// peer discovery. Everything stays in this browser.
//
// Syncing a person's own devices (issue #123) does not go through here: when
// it is switched on, node.js builds an online node from sync/device-sync.js
// instead (relay, WebRTC, a peer key derived from the passkey). This file is
// the node for everyone who has not switched it on.
//
// The peer key: generated here, per session, and handed to libp2p together
// with no datastore, so libp2p and Helia's keychain have nowhere to write it.
// A reload is a new peer id, which costs nothing while nobody dials us. Do not
// switch to `createHelia`'s defaults, which load or create the self key in the
// Helia datastore (`belege/helia-data`, IndexedDB); the device-sync node
// derives its stable key from the passkey's PRF answer instead
// (database-keys.js deriveDevicePeerSeed). Never persist a peer key.

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { generateKeyPair } from '@libp2p/crypto/keys';

/** This offline node never goes online; device sync is sync/device-sync.js. */
export const P2P_ENABLED = false;

/** @typedef {NonNullable<import('libp2p').Libp2pOptions['privateKey']>} PeerKey */

/**
 * A peer key for this session only. It is never written anywhere.
 *
 * @returns {Promise<PeerKey>}
 */
export function createEphemeralPeerKey() {
	return generateKeyPair('Ed25519');
}

/**
 * @param {PeerKey} privateKey from `createEphemeralPeerKey`
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function createOfflineLibp2pConfig(privateKey) {
	if (!privateKey) throw new Error('A peer key is required; see createEphemeralPeerKey.');
	return {
		privateKey,
		// No `datastore`: libp2p keeps its peer store and keychain in memory.
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

/**
 * @param {PeerKey} [privateKey] defaults to a fresh one
 * @returns {Promise<any>} a started libp2p node that talks to nobody
 */
export async function createOfflineLibp2p(privateKey) {
	if (P2P_ENABLED) {
		throw new Error('The offline node does not go online; see sync/device-sync.js.');
	}
	return createLibp2p(createOfflineLibp2pConfig(privateKey ?? (await createEphemeralPeerKey())));
}

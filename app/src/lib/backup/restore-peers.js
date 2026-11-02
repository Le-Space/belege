// A backup over libp2p, from the peers that hold it (issue #528).
//
// A fetch-only Helia node, made when the first file is asked for over peers
// and stopped after the restore: the books are closed while a restore runs,
// so the app's own node is not there to borrow, and a second identity for a
// minute is cheaper than opening the books' node for a download. It listens
// on nothing, speaks the transports a page can open (secure WebSockets and
// WebRTC-Direct), and has identify beside bitswap – without identify no want
// is ever sent (peer-fetch.js, measured).
//
// Whom it dials, for every file:
//   - Aleph's own IPFS nodes, as the storage bridge names them
//     (`ALEPH_BITSWAP`): the backups were kept there, so reading from them
//     tells Aleph nothing new. Reachable over IPv6 only, as announced.
//   - whoever the public routing says holds the CID (`providersFor`: IPNI at
//     cid.contact and the DHT through delegated-ipfs.dev), with addresses a
//     page can dial. This is how a page reaches the public IPFS network: a
//     fetch-only node runs no DHT, and the public bootstrap peers hold no
//     backup, so they are not dialled.
// Every block is checked against its CID by Helia; a stranger's bytes are as
// safe as a gateway's, and a sealed backup is ciphertext to all of them.

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { unixfs } from '@helia/unixfs';
import { identify } from '@libp2p/identify';
import { webRTCDirect } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { multiaddr } from '@multiformats/multiaddr';
import {
	ALEPH_BITSWAP,
	DEFAULT_ROUTERS,
	createPeerFetch,
	providersFor
} from '@le-space/orbitdb-storage-bridge/peer-fetch';
import { createHeliaLight } from 'helia';
import { createLibp2p } from 'libp2p';
import { CID } from 'multiformats/cid';

/** A whole file over peers may take this long; a phone on a slow link needs it. */
export const PEER_FETCH_MS = 20 * 60_000;

/**
 * The addresses to dial for a CID: Aleph's nodes first, then the routing's
 * answer, each peer once.
 *
 * @param {string} cid
 * @param {{ routers?: readonly string[], aleph?: readonly string[], fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<string[]>}
 */
export async function restoreProviders(
	cid,
	{ routers = DEFAULT_ROUTERS, aleph = ALEPH_BITSWAP, fetchImpl } = {}
) {
	const found = await providersFor(cid, {
		routers: [...routers],
		...(fetchImpl ? { fetchImpl } : {})
	}).catch(() => []);
	const addrs = [.../** @type {readonly string[]} */ (aleph)];
	for (const provider of found)
		for (const addr of provider.addrs) if (!addrs.includes(addr)) addrs.push(addr);
	return addrs;
}

/**
 * @typedef {object} RestorePeers
 * @property {(cid: string, options?: { size?: number, onProgress?: (received: number, total: number) => void }) => Promise<Uint8Array>} fetch
 * @property {() => number} reached how many peers answered a dial so far
 * @property {() => Promise<void>} stop
 */

/**
 * The node, started.
 *
 * @param {{ routers?: string[] }} [options]
 * @returns {Promise<RestorePeers>}
 */
export async function createRestorePeers({ routers } = {}) {
	const libp2p = await createLibp2p({
		addresses: { listen: [] },
		transports: [webSockets(), webRTCDirect()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: { identify: identify() }
	});
	const helia = await withBitswap(withLibp2p(createHeliaLight({}), libp2p)).start();
	const fs = unixfs(helia);
	/** @type {Set<string>} */
	const peers = new Set();

	/** @type {(received: number) => void} */
	let report = () => {};
	const fetchOverPeers = createPeerFetch({
		helia,
		providers: (cid) => restoreProviders(cid, { ...(routers ? { routers } : {}) }),
		timeout: PEER_FETCH_MS,
		dial: async (addr) => {
			const connection = await helia.libp2p.dial(multiaddr(addr));
			peers.add(connection.remotePeer.toString());
			return connection;
		},
		cat: (cid, options) => counted(fs.cat(typeof cid === 'string' ? CID.parse(cid) : cid, options))
	});

	/** @param {AsyncIterable<Uint8Array>} chunks */
	async function* counted(chunks) {
		let received = 0;
		for await (const chunk of chunks) {
			received += chunk.length;
			report(received);
			yield chunk;
		}
	}

	return {
		fetch: async (cid, options = {}) => {
			const total = options.size ?? 0;
			report = (received) => options.onProgress?.(received, total);
			try {
				return await fetchOverPeers(cid);
			} finally {
				report = () => {};
			}
		},
		reached: () => peers.size,
		stop: async () => {
			await helia.stop();
		}
	};
}

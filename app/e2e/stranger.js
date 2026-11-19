// A stranger: a libp2p node with a key of its own and no device proof, for
// the stranger spec (#537). It speaks everything a device of the books speaks
// – identify, gossipsub, bitswap – and can open any protocol by name; what it
// lacks is the books' secret.
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { multiaddr } from '@multiformats/multiaddr';
import { CID } from 'multiformats/cid';

/**
 * @param {string} relay the relay's multiaddr
 */
export async function startStranger(relay) {
	const libp2p = await createLibp2p({
		addresses: { listen: [] },
		transports: [webSockets(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: {
			identify: identify(),
			pubsub: gossipsub({
				emitSelf: false,
				allowPublishToZeroTopicPeers: true,
				runOnLimitedConnection: true
			})
		}
	});
	const helia = await withBitswap(withLibp2p(createHeliaLight({}), libp2p)).start();
	await libp2p.dial(multiaddr(relay));
	/** @type {{ topic: string, from: string }[]} */
	const heard = [];
	/** @type {any} */ (libp2p.services.pubsub).addEventListener('message', (/** @type {any} */ e) =>
		heard.push({ topic: e.detail.topic, from: String(e.detail.from ?? '') })
	);

	return {
		peerId: libp2p.peerId.toString(),
		/** Every gossipsub message that reached the stranger. */
		heard,

		/**
		 * Connect to a device through the relay.
		 *
		 * @param {string} peer the device's peer id
		 * @returns {Promise<any>} the connection; throws when the device cannot be reached
		 */
		connect: (peer) =>
			libp2p.dial(multiaddr(`${relay}/p2p-circuit/p2p/${peer}`), {
				signal: AbortSignal.timeout(15_000)
			}),

		/**
		 * What identify told the stranger about a peer: libp2p asks by itself when
		 * a connection opens, and keeps the answer in the peer store.
		 *
		 * @param {any} connection
		 * @returns {Promise<{ protocols: string[], agent: string } | null>} null: no answer in ten seconds
		 */
		async told(connection) {
			const end = Date.now() + 10_000;
			while (Date.now() < end) {
				const peer = await libp2p.peerStore.get(connection.remotePeer).catch(() => null);
				const agent = peer?.metadata.get('AgentVersion');
				if (peer && (peer.protocols.length > 0 || agent)) {
					return {
						protocols: [...peer.protocols],
						agent: agent ? new TextDecoder().decode(agent) : ''
					};
				}
				await new Promise((r) => setTimeout(r, 200));
			}
			return null;
		},

		/**
		 * Try one protocol on a connection: open it, say something, wait for an
		 * answer.
		 *
		 * @param {any} connection
		 * @param {string} protocol
		 * @param {Uint8Array} [say]
		 * @returns {Promise<'refused' | 'silent' | 'answered'>} `refused`: the stream did not open or was
		 *   closed on us without a byte; `silent`: it stayed open and nothing came back; `answered`:
		 *   bytes came back. The device gate holds a stream while it waits for the proof
		 *   (PROOF_WAIT_MS, ten seconds) and then aborts it, so this waits a little longer.
		 */
		async tryProtocol(connection, protocol, say = new Uint8Array([1, 0])) {
			let stream;
			try {
				stream = await connection.newStream(protocol, {
					runOnLimitedConnection: true,
					signal: AbortSignal.timeout(5_000)
				});
			} catch {
				return 'refused';
			}
			try {
				const answer = new Promise((resolve) => {
					stream.addEventListener('message', () => resolve('answered'), { once: true });
					stream.addEventListener('close', () => resolve('refused'), { once: true });
					setTimeout(() => resolve('silent'), 14_000);
				});
				stream.send(say);
				return /** @type {any} */ (await answer);
			} catch {
				return 'refused';
			} finally {
				stream.abort(new Error('done'));
			}
		},

		/** Subscribe to topics, as a device subscribes to the books' databases. @param {string[]} topics */
		subscribe(topics) {
			for (const topic of topics) /** @type {any} */ (libp2p.services.pubsub).subscribe(topic);
		},

		/** Who the stranger's gossipsub knows as subscribed to a topic. @param {string} topic */
		subscribers: (topic) =>
			/** @type {any[]} */ (/** @type {any} */ (libp2p.services.pubsub).getSubscribers(topic)).map(
				String
			),

		/**
		 * Want a block over bitswap.
		 *
		 * @param {string} cid
		 * @returns {Promise<boolean>} whether anybody handed it over
		 */
		async wants(cid) {
			try {
				for await (const _ of helia.blockstore.get(CID.parse(cid), {
					signal: AbortSignal.timeout(8_000)
				})) {
					void _;
					return true;
				}
				return true;
			} catch {
				return false;
			}
		},

		stop: () => helia.stop()
	};
}

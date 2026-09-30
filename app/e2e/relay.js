// From Le-Space/invoice (app/e2e/relay.js) at 2222250, by the same author.
// Changed: a provider node that also accepts WebRTC, as the invoicing app does.
// A circuit relay on this machine for the browser specs: what the Le-Space
// relay (orbitdb-relay) is in production — WebSocket in, circuit relay v2 —
// with a key derived from a fixed seed, so the app can be built with its
// address before it runs.
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

export const RELAY_PORT = Number(process.env.E2E_RELAY_PORT || 4393);
const SEED = new Uint8Array(32).fill(42);

export async function relayKey() {
	return generateKeyPairFromSeed('Ed25519', SEED);
}

/** The relay's multiaddr, as the app is built with it. */
export async function relayAddr() {
	const peerId = peerIdFromPrivateKey(await relayKey());
	return `/ip4/127.0.0.1/tcp/${RELAY_PORT}/ws/p2p/${peerId}`;
}

/** Where the relay writes down what identify told it about each peer (one JSON line each). */
export const RELAY_IDENTIFY_LOG = join(tmpdir(), `belege-e2e-relay-identify-${RELAY_PORT}.jsonl`);

export async function startRelay() {
	// What a relay learns from identify, for the specs to look at (#209).
	writeFileSync(RELAY_IDENTIFY_LOG, '');
	const relay = await createRelay();
	/** @param {string} peer @param {string[]} protocols @param {string} [agent] */
	const note = (peer, protocols, agent) =>
		appendFileSync(RELAY_IDENTIFY_LOG, `${JSON.stringify({ peer, protocols, agent })}\n`);
	relay.addEventListener('peer:identify', (e) =>
		note(String(e.detail.peerId), e.detail.protocols, e.detail.agentVersion)
	);
	// identify-push: a later change of the peer's protocols.
	relay.addEventListener('peer:update', (e) =>
		note(String(e.detail.peer.id), e.detail.peer.protocols)
	);
	return relay;
}

async function createRelay() {
	return createLibp2p({
		privateKey: await relayKey(),
		addresses: { listen: [`/ip4/127.0.0.1/tcp/${RELAY_PORT}/ws`] },
		transports: [webSockets()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
			relay: circuitRelayServer({ reservations: { maxReservations: 32 } })
		}
	});
}

/**
 * A node as a consumer uses it: it reaches browsers through the relay.
 *
 * @param {string} relay
 */
export async function startConsumerNode(relay) {
	const node = await createLibp2p({
		addresses: { listen: [] },
		transports: [webSockets(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: { identify: identify(), identifyPush: identifyPush() }
	});
	const { multiaddr } = await import('@multiformats/multiaddr');
	await node.dial(multiaddr(relay));
	return node;
}

/**
 * A node as the invoicing app is one: a reservation on the relay, and WebRTC,
 * so a browser can reach it directly once the relay has introduced them.
 *
 * @param {string} relay
 */
export async function startProviderNode(relay) {
	const { webRTC } = await import('@libp2p/webrtc');
	const node = await createLibp2p({
		addresses: { listen: [`${relay}/p2p-circuit`, '/webrtc'] },
		transports: [webSockets(), webRTC(), circuitRelayTransport()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionGater: { denyDialMultiaddr: () => false },
		services: { identify: identify(), identifyPush: identifyPush() }
	});
	// Wait for the reservation: before it, nobody can reach us through the relay.
	for (let i = 0; i < 100; i++) {
		if (node.getMultiaddrs().some((a) => a.toString().includes('/p2p-circuit/'))) return node;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('No reservation on the relay');
}

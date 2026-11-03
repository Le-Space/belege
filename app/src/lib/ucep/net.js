// From Le-Space/invoice (app/src/lib/ucep/net.js) at Le-Space/invoice#16, by the same author.
// The libp2p node UCEP runs on (Le-Space/ucep-spec §5.1: browser and mobile
// over a relay).
//
// Apart from the node under Helia and OrbitDB (network.js), which talks to
// nobody: the books never leave this browser, only the commands a paired app
// sends and their answers do. This node dials the relay over a TLS WebSocket,
// takes a reservation there so another browser can reach it through the relay,
// and accepts WebRTC so the two can talk directly once they have met. Noise
// encrypts every connection end to end; the relay sees ciphertext.
//
// Pairing by QR code without any relay is the next step: the alpha module
// @le-space/libp2p-webrtc-qr (Le-Space/simple-todo uses it) exchanges the
// signed WebRTC signaling out of band as QR codes, so two devices in one room
// need no relay at all. Not wired in yet.
//
// Its key is derived from the passkey's PRF answer (database-keys.js,
// `derivePeerKeySeed`), so the peer id a paired app knows stays the same from
// one unlock to the next and on every device the passkey is synced to. It is
// never written anywhere.

import { createLibp2p } from 'libp2p';
import { NODE_INFO } from '../sync/quiet-identify.js';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { FaultTolerance } from '@libp2p/interface';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Where the relays come from: the Le-Space relays register their current
 * addresses on Aleph (Le-Space/relay-button, @le-space/aleph-bootstrap), as
 * POST messages in the channel `simple-todo` under the ref
 * `simple-todo-bootstrap`. Anybody can post there, so only the wallets that
 * run the Le-Space relays count (Nico's choice, 2026-09-28), and only their
 * orbitdb-relay registration, newest first.
 *
 * Trusting a relay is about metadata and availability, not about content:
 * every connection through it is encrypted end to end (Noise), and a relay
 * cannot pose as the app (Noise checks the peer id, the invitation names it).
 * A stranger's relay could still see who connects when, or refuse to relay.
 */
export const ALEPH_API = 'https://api.aleph.im';
export const RELAY_REGISTRATION = Object.freeze({
	channel: 'simple-todo',
	ref: 'simple-todo-bootstrap',
	type: 'relay-bootstrap-v2',
	registrationId: 'relay:orbitdb-relay:orbitdb-relay'
});
/**
 * Guest wallets of single relay VMs, trusted one by one. A guest publishes
 * with a key made at deploy time, so every redeploy meant a new wallet here.
 * None any more: the relay Belege uses is found by its account
 * (TRUSTED_RELAY_OWNERS). The last one, the orbitdb-relay VM of 2026-10-23
 * (secret-pass-wife-sentence), was retired for relay-main-ekb.
 *
 * @type {readonly string[]}
 */
export const TRUSTED_RELAY_SENDERS = Object.freeze([]);

/**
 * The Aleph accounts Le Space pays its relays from. A relay deployed with
 * relay-button names its account (`ownerAddress`) and its instance (the end of
 * its registration id) when it registers; the app checks on Aleph that the
 * instance is that account's, and dials only the instance's own 2n6.me name.
 * A redeploy therefore needs no change here, unlike the guest wallets above.
 */
export const TRUSTED_RELAY_OWNERS = Object.freeze([
	// relay-button
	'0x28129bdDa64310221480d4eF903446b0cdFD4BEb',
	// orbitdb-relay
	'0x2bd014B41FEa490320187b5FAdf413dab88f7628'
]);

/**
 * The 2n6.me name Aleph's gateway gives an instance: the hash's first 44 bits
 * as four BIP39 words.
 *
 * @param {string} instanceHash
 */
export function twoN6Host(instanceHash) {
	const bits = parseInt(String(instanceHash).slice(0, 11), 16);
	const words = [33, 22, 11, 0].map((shift) => wordlist[Math.floor(bits / 2 ** shift) % 2048]);
	return `${words.join('-')}.2n6.me`;
}

/**
 * The relay as it was registered on 2026-11-03, for when Aleph cannot be
 * asked: relay-main-ekb, deployed from the relay-button account, which serves
 * UCEP and paperless-anywhere's attest relay at /attest. A relay moves when it
 * is redeployed; the lookup is what keeps up. Before it:
 * secret-pass-wife-sentence (2026-11-02) and exhaust-tobacco-abuse-purchase
 * (2026-10-14), retired for this one, and job-blanket-biology-typical, silent
 * since 2026-10-09.
 */
export const FALLBACK_RELAYS = Object.freeze([
	'/dns4/crazy-pluck-uncle-device.2n6.me/tcp/443/tls/ws/p2p/12D3KooWQu5E1ZkGC5x2dSVTEWxYvsssWjXgk2Mzc8GZHN26cYzS'
]);

/**
 * A relay address a browser on an https page can dial: a TLS WebSocket by
 * name, with the relay's peer id.
 *
 * @param {string} addr
 */
export const browserDialable = (addr) =>
	/^\/dns[46]?\/[^/]+\/tcp\/\d+\/(tls\/ws|wss)\/p2p\/[1-9A-HJ-NP-Za-km-z]+$/.test(addr);

/**
 * The trusted relays' current addresses, from the Aleph posts: the newest
 * orbitdb-relay registration of each trusted wallet, one browser-dialable
 * address per relay (IPv4 by name first).
 *
 * @param {any} payload the answer of `/api/v0/posts.json`
 * @param {readonly string[]} [senders]
 * @returns {string[]}
 */
export function relaysFromPosts(payload, senders = TRUSTED_RELAY_SENDERS) {
	const trusted = new Set(senders.map((s) => s.toLowerCase()));
	/** @type {Map<string, { time: number, addrs: string[] }>} */
	const newest = new Map();
	for (const post of Array.isArray(payload?.posts) ? payload.posts : []) {
		const sender = String(post?.sender ?? '').toLowerCase();
		if (!trusted.has(sender)) continue;
		let content = post?.content;
		if (!content && typeof post?.item_content === 'string') {
			try {
				content = JSON.parse(post.item_content)?.content;
			} catch {
				continue;
			}
		}
		if (content?.registrationId !== RELAY_REGISTRATION.registrationId) continue;
		const time = Number(post?.time ?? 0);
		const addrs = (Array.isArray(content?.multiaddrs) ? content.multiaddrs : [])
			.map(String)
			.filter(browserDialable)
			.sort(
				(/** @type {string} */ a, /** @type {string} */ b) =>
					Number(b.startsWith('/dns4/')) - Number(a.startsWith('/dns4/'))
			);
		if (addrs.length === 0) continue;
		if ((newest.get(sender)?.time ?? -1) < time) newest.set(sender, { time, addrs });
	}
	return [...newest.values()].sort((a, b) => b.time - a.time).map((entry) => entry.addrs[0]);
}

/**
 * The registrations that name a trusted account and their instance, newest per
 * instance, with the addresses on that instance's own 2n6.me name only. Still
 * to be checked against the instance itself (`ownedInstance`).
 *
 * @param {any} payload the answer of `/api/v0/posts.json`
 * @param {readonly string[]} [owners]
 * @returns {{ instance: string, owner: string, addrs: string[] }[]}
 */
export function ownerRegistrations(payload, owners = TRUSTED_RELAY_OWNERS) {
	const trusted = new Set(owners.map((o) => o.toLowerCase()));
	/** @type {Map<string, { time: number, instance: string, owner: string, addrs: string[] }>} */
	const newest = new Map();
	for (const post of Array.isArray(payload?.posts) ? payload.posts : []) {
		let content = post?.content;
		if (!content && typeof post?.item_content === 'string') {
			try {
				content = JSON.parse(post.item_content)?.content;
			} catch {
				continue;
			}
		}
		const owner = String(content?.ownerAddress ?? '').toLowerCase();
		const instance = /^relay:orbitdb-relay:.*:([0-9a-f]{64})$/.exec(
			String(content?.registrationId ?? '')
		)?.[1];
		if (!instance || !trusted.has(owner)) continue;
		const host = twoN6Host(instance);
		const time = Number(post?.time ?? 0);
		const addrs = (Array.isArray(content?.multiaddrs) ? content.multiaddrs : [])
			.map(String)
			.filter(browserDialable)
			.filter((/** @type {string} */ addr) => addr.split('/')[2] === host)
			.sort(
				(/** @type {string} */ a, /** @type {string} */ b) =>
					Number(b.startsWith('/dns4/')) - Number(a.startsWith('/dns4/'))
			);
		if (addrs.length === 0) continue;
		if ((newest.get(instance)?.time ?? -1) < time)
			newest.set(instance, { time, instance, owner, addrs });
	}
	return [...newest.values()]
		.sort((a, b) => b.time - a.time)
		.map(({ instance, owner, addrs }) => ({ instance, owner, addrs }));
}

/**
 * Whether Aleph holds `instance` as a running INSTANCE of `owner`.
 *
 * @param {string} instance @param {string} owner
 * @param {typeof fetch} fetchImpl @param {number} timeoutMs
 */
export async function ownedInstance(instance, owner, fetchImpl, timeoutMs) {
	try {
		const response = await fetchImpl(new URL(`/api/v0/messages/${instance}`, ALEPH_API), {
			signal: AbortSignal.timeout(timeoutMs),
			cache: 'no-cache'
		});
		if (!response.ok) return false;
		const body = await response.json();
		return (
			body?.status === 'processed' &&
			body?.message?.type === 'INSTANCE' &&
			body?.message?.item_hash === instance &&
			String(body?.message?.content?.address ?? '').toLowerCase() === owner.toLowerCase()
		);
	} catch {
		return false;
	}
}

/**
 * The relays to use: the configured ones (VITE_RELAY_ADDRS, comma-separated;
 * the browser specs set it), else the relays of the trusted accounts and
 * wallets as Aleph knows them now, else the fallback.
 *
 * @param {{ configured?: string, fetch?: typeof fetch, timeoutMs?: number, senders?: readonly string[] }} [options]
 *   `senders`: the guest wallets trusted one by one (TRUSTED_RELAY_SENDERS); none: not asked
 * @returns {Promise<string[]>}
 */
export async function relayAddrs({
	configured = import.meta.env?.VITE_RELAY_ADDRS,
	fetch: fetchImpl = globalThis.fetch,
	timeoutMs = 5000,
	senders = TRUSTED_RELAY_SENDERS
} = {}) {
	const list = String(configured ?? '')
		.split(',')
		.map((addr) => addr.trim())
		.filter(Boolean);
	if (list.length > 0) return list;
	/** @param {Record<string, string>} params */
	const posts = async (params) => {
		const url = new URL('/api/v0/posts.json', ALEPH_API);
		url.searchParams.set('channels', RELAY_REGISTRATION.channel);
		url.searchParams.set('refs', RELAY_REGISTRATION.ref);
		url.searchParams.set('types', RELAY_REGISTRATION.type);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		const response = await fetchImpl(url, {
			signal: AbortSignal.timeout(timeoutMs),
			cache: 'no-cache'
		});
		if (!response.ok) throw new Error(`Aleph answered ${response.status}`);
		return response.json();
	};
	const [byOwner, bySender] = await Promise.all([
		// Anybody can post with any ownerAddress, so every candidate is checked
		// against its instance before it counts.
		posts({ pagination: '200' })
			.then((payload) =>
				Promise.all(
					ownerRegistrations(payload).map(async (entry) =>
						(await ownedInstance(entry.instance, entry.owner, fetchImpl, timeoutMs))
							? entry.addrs[0]
							: null
					)
				)
			)
			.catch(() => []),
		senders.length
			? posts({ addresses: senders.join(','), pagination: '20' })
					.then((payload) => relaysFromPosts(payload, senders))
					.catch(() => [])
			: []
	]);
	const found = [
		...new Set(
			[...byOwner, ...bySender].filter(
				/** @returns {addr is string} */ (/** @type {string | null} */ addr) =>
					typeof addr === 'string'
			)
		)
	];
	// Aleph not reachable or no relay registered: the relays as they were last known.
	return found.length > 0 ? found : [...FALLBACK_RELAYS];
}

/**
 * The addresses an invitation carries: this node through each of its relays
 * (and WebRTC through them), not the dozens of private addresses a relay also
 * reports, which make the QR code dense and help nobody outside its network.
 *
 * @param {any} node
 * @param {string[]} relays
 */
export function invitationAddrs(node, relays) {
	const self = node.peerId.toString();
	const wanted = new Set(
		relays.flatMap((relay) => [
			`${relay}/p2p-circuit/p2p/${self}`,
			`${relay}/p2p-circuit/webrtc/p2p/${self}`
		])
	);
	return node
		.getMultiaddrs()
		.map(String)
		.filter((/** @type {string} */ addr) => wanted.has(addr));
}

/** A relay on this machine, as the browser specs start one. @param {string} addr */
export const isLocal = (addr) => /\/(ip4\/127\.|ip6\/::1\/|dns4\/localhost\/)/.test(addr);

/**
 * @param {{ privateKey: any, relays: string[] }} params
 * @returns {import('libp2p').Libp2pOptions<any>}
 */
export function ucepLibp2pConfig({ privateKey, relays }) {
	return {
		privateKey,
		addresses: {
			// A reservation on each relay, and WebRTC for the direct connection
			// the relay helps to set up.
			listen: [...relays.map((relay) => `${relay}/p2p-circuit`), '/webrtc']
		},
		transports: [webSockets(), webRTC(), circuitRelayTransport()],
		// A relay that is down must not keep the node from starting on the others.
		transportManager: { faultTolerance: FaultTolerance.NO_FATAL },
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		connectionManager: {
			// Every connection a paired app opens through the relay comes from
			// the relay's address. @le-space/ucep from 0.2.0-draft.1 reuses its
			// relayed connection, which keeps it far below libp2p's default of
			// five a second; the margin is for consumers on 0.2.0-draft.0, which
			// opened one per call and were refused from the sixth.
			inboundConnectionThreshold: 100
		},
		// Not the browser's user agent string (sync/quiet-identify.js).
		nodeInfo: NODE_INFO,
		// A browser does not dial private addresses by default; the specs'
		// relay is on 127.0.0.1.
		...(relays.some(isLocal) ? { connectionGater: { denyDialMultiaddr: () => false } } : {}),
		// identify-push: a consumer already connected learns at once that the
		// extension is served (UCEP finds extensions through identify only).
		services: { identify: identify(), identifyPush: identifyPush() }
	};
}

/**
 * Start the node on the key derived from the passkey.
 *
 * @param {{ seed: Uint8Array, relays: string[] }} params from `relayAddrs`
 */
export async function startUcepNode({ seed, relays }) {
	const privateKey = await generateKeyPairFromSeed('Ed25519', seed);
	return createLibp2p(ucepLibp2pConfig({ privateKey, relays }));
}

/**
 * Whether another browser can reach this node: a relay holds a reservation
 * for it, which shows as an address of its own through that relay. Merely
 * being connected to the relay is not enough — a dial before the reservation
 * is refused.
 *
 * @param {any} node
 */
export function reachable(node) {
	return node
		.getMultiaddrs()
		.some((/** @type {any} */ addr) => addr.toString().includes('/p2p-circuit/'));
}

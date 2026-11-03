// The bridge's own libp2p node (Le-Space/belege#573, milestone M1 of #567):
// a peer of the books, like a phone, so that every device of the books
// reaches the bridge's functions over a stream – through the relays the
// books use, the bridge's own LAN relay, or a WebSocket on this machine –
// and no longer only over HTTP on 127.0.0.1.
//
// Identity. An Ed25519 peer key, made at the first start and kept as
// `<config dir>/node/peer-key` (0600), the way the LAN relay keeps its own.
// Its peer id is this bridge's name in the books' device list.
//
// Who gets in. The same gate as on every device (@belege/device-gate): a
// peer proves that it holds the books' device auth key before any protocol
// but identify, the relay's and the proof itself answers it; and only a peer
// the books list as a device is admitted, so a device removed in the app is
// refused here too. The auth key is the books' (derived from the passkey on
// a device), and the bridge has none until a device hands it over:
//
//   unarmed  – no auth key yet. The node runs without the gate and offers one
//              thing: pairing by invitation (UCEP), printed on the console as
//              `web+ucep:pair?…`. The proof of the pairing is the invitation's
//              secret, so whoever can read the console may pair, as with the
//              pairing code today.
//   handover – under the grant that pairing gave, the device sends `handover`
//              with the auth key, the relays the books use and the devices the
//              books know. The key goes to the keychain, the rest to
//              bridge.json, and the node restarts …
//   armed    – … with the gate. From now on the proof decides, and `devices`
//              keeps the list current when the app's device list changes.
//              Armed, the node offers the bridge's functions: `request`
//              dispatches onto the command table of commands.js (stream.js).
//
// What is kept where: the peer key on disk (not a secret: a peer id names,
// it does not open); the auth key in the keychain (`device-auth`), never in
// bridge.json, never logged; UCEP's grants in `<config dir>/node/grants.json`
// (grant ids and peer ids, no secrets); relays and devices in bridge.json.
//
// What the node does not do: no DHT, no discovery, no provide, no gossipsub,
// no OrbitDB – the bridge holds no books. identify names the extension to
// proved devices only (quiet identify); a relay or a stranger is told
// identify and the relay protocols, nothing else.

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { createLibp2p } from 'libp2p';
import { FaultTolerance } from '@libp2p/interface';
import {
	NODE_INFO,
	createDeviceGate,
	gatedIdentify,
	quietIdentify,
	quietIdentifyPush
} from '@belege/device-gate';
import { UcepError, createProvider } from '@le-space/ucep';

import { answerRequest, offered } from './stream.js';

/** The UCEP extension the bridge offers: pairing, the device list, and `request` onto commands.js. */
export const EXTENSION = 'belege-bridge';
export const EXTENSION_VERSION = '0.2.0';
/** The scope of pairing itself: the handover (UCEP wants `extension:resource:action`). */
export const PAIR_SCOPE = 'belege-bridge:pairing:manage';
/** The keychain account the books' device auth key is kept under. */
export const DEVICE_AUTH_ACCOUNT = 'device-auth';
/** The answer to `handover` goes first; the restart armed follows this much later. */
export const HANDOVER_RESTART_MS = 1000;
/** How long an invitation printed at start may be used. */
export const INVITATION_TTL_S = 10 * 60;
const AUTH_KEY_BYTES = 32;
const PEER_ID = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;

/**
 * The node's peer key: the one on disk, else a new one kept there.
 *
 * @param {string} dir
 */
export async function peerKeyOf(dir) {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const file = join(dir, 'peer-key');
	try {
		return privateKeyFromProtobuf(await readFile(file));
	} catch {
		const key = await generateKeyPair('Ed25519');
		await writeFile(file, privateKeyToProtobuf(key), { mode: 0o600 });
		await chmod(file, 0o600);
		return key;
	}
}

/**
 * A key-value store in one JSON file, for UCEP's grants and invitations:
 * grant ids, peer ids, scopes and times – nothing secret, so a plain file
 * beside the peer key does.
 *
 * @template T
 * @typedef {object} KeyValue what UCEP's store wants (ucep store.js)
 * @property {(key: string) => Promise<T | undefined>} get
 * @property {(key: string, value: T) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<T[]>} values
 */

/**
 * @template T
 * @param {string} file
 * @returns {KeyValue<T>}
 */
export function fileStore(file) {
	/** @returns {Promise<Record<string, T>>} */
	async function load() {
		try {
			const parsed = JSON.parse(await readFile(file, 'utf8'));
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch {
			return {};
		}
	}
	/** @param {Record<string, T>} all */
	async function save(all) {
		await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify(all)}\n`, { mode: 0o600 });
		await rename(tmp, file);
	}
	return {
		get: async (key) => (await load())[key],
		set: async (key, value) => save({ ...(await load()), [key]: value }),
		delete: async (key) => {
			const all = await load();
			delete all[key];
			await save(all);
		},
		values: async () => Object.values(await load())
	};
}

/** @param {unknown} value @returns {value is string} */
export const isPeerId = (value) => typeof value === 'string' && PEER_ID.test(value);

/**
 * What `handover` brings, checked: the key as 32 bytes, relays as multiaddrs
 * with a peer id, devices as peer ids.
 *
 * @param {any} args
 * @returns {{ authKey: Uint8Array, relays: string[], devices: string[] }}
 */
export function parseHandover(args) {
	const raw = typeof args?.deviceAuth === 'string' ? args.deviceAuth : '';
	let authKey;
	try {
		authKey = Uint8Array.from(Buffer.from(raw, 'base64'));
	} catch {
		authKey = new Uint8Array();
	}
	if (authKey.length !== AUTH_KEY_BYTES || authKey.every((b) => b === 0)) {
		throw new UcepError('INVALID_ARGUMENTS', 'deviceAuth must be 32 bytes, base64');
	}
	const relays = Array.isArray(args?.relays) ? args.relays : [];
	if (
		relays.length > 16 ||
		!relays.every((r) => typeof r === 'string' && /\/p2p\/12D3KooW/.test(r))
	) {
		throw new UcepError('INVALID_ARGUMENTS', 'relays must be up to 16 multiaddrs with a peer id');
	}
	const devices = Array.isArray(args?.devices) ? args.devices : [];
	if (devices.length > 64 || !devices.every(isPeerId)) {
		throw new UcepError('INVALID_ARGUMENTS', 'devices must be up to 64 peer ids');
	}
	return { authKey, relays: [...new Set(relays)], devices: [...new Set(devices)] };
}

/** The peer id a relay multiaddr names. @param {string} addr */
const relayPeerOf = (addr) => /\/p2p\/(12D3KooW[1-9A-HJ-NP-Za-km-z]{44})/.exec(addr)?.[1] ?? null;

/**
 * @typedef {object} BridgeNode
 * @property {string} peerId
 * @property {boolean} armed the gate is up: a device must prove the books' auth key
 * @property {() => string[]} addrs where the node listens now
 * @property {() => Promise<string>} invite an invitation to pair, `web+ucep:pair?…` (unarmed only)
 * @property {(peerIds: string[]) => void} setDevices the books' device list, as the app keeps it current
 * @property {() => Set<string>} devices
 * @property {() => Promise<void>} stop
 * @property {any} libp2p
 */

/**
 * Start the node.
 *
 * @param {object} p
 * @param {string} p.dir where the peer key and the grants live (`<config dir>/node`)
 * @param {Uint8Array | null} p.authKey the books' device auth key; null: unarmed, pairing only
 * @param {string[]} p.relays the relays the books use, to be reached through
 * @param {string[]} p.devices the books' devices (peer ids), the only ones admitted
 * @param {import('./commands.js').Command[] | null} [p.commands] the bridge's command table, offered as
 *   `request` to proved devices (stream.js); null: pairing and the device list only
 * @param {(handover: { authKey: Uint8Array, relays: string[], devices: string[] }) => Promise<void>} [p.onHandover]
 *   a device handed the key over (unarmed only): keep it, then restart armed
 * @param {(devices: string[]) => Promise<void>} [p.onDevices] the device list changed
 * @param {number} [p.wsPort] a WebSocket on 127.0.0.1 for the browser on this machine; 0 picks one
 * @param {any[]} [p.transports] tests: the memory transport
 * @param {string[]} [p.listen] tests: listen addresses instead of the relays and the WebSocket
 * @param {(line: string) => void} [p.log] counts and peer ids, never a key
 * @returns {Promise<BridgeNode>}
 */
export async function startBridgeNode({
	dir,
	authKey,
	relays,
	devices,
	commands = null,
	onHandover = async () => {},
	onDevices = async () => {},
	wsPort = 0,
	transports,
	listen,
	log = () => {}
}) {
	const privateKey = await peerKeyOf(dir);
	const relayPeers = new Set(relays.map(relayPeerOf).filter(Boolean));
	/** @type {Set<string>} */
	const known = new Set(devices);
	const armed = authKey !== null;

	const gate = armed
		? createDeviceGate({
				authKey: /** @type {Uint8Array} */ (authKey),
				// The proof is offered to devices, never to a relay this node dials.
				offer: (peer) => !relayPeers.has(peer),
				// A right proof from a peer the books do not list as a device: refused.
				admit: (peer) => known.has(peer)
			})
		: null;
	const whoAmI = gate ? gatedIdentify(gate) : null;
	if (gate && whoAmI) gate.onProved((peer) => whoAmI.learn(peer).catch(() => {}));

	const libp2p = await createLibp2p({
		privateKey,
		addresses: {
			listen: listen ?? [
				...relays.map((relay) => `${relay}/p2p-circuit`),
				`/ip4/127.0.0.1/tcp/${wsPort}/ws`
			]
		},
		transports: transports ?? [tcp(), webSockets(), circuitRelayTransport()],
		// A relay that is down must not keep the node from starting on the others.
		transportManager: { faultTolerance: FaultTolerance.NO_FATAL },
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		nodeInfo: NODE_INFO,
		connectionManager: { inboundConnectionThreshold: 100 },
		connectionGater: {
			// The relays and the own machine have private addresses, which libp2p refuses to dial by default.
			denyDialMultiaddr: () => false
		},
		services: {
			...(gate ? { deviceGate: gate.service } : {}),
			...(whoAmI
				? whoAmI.services
				: { identify: quietIdentify(), identifyPush: quietIdentifyPush() })
		}
	});

	/**
	 * The caller is a device of the books: the node is armed, the peer proved
	 * the key on this connection, and the books list it. The gate refuses an
	 * unproved peer before a stream opens; this is the check a command can
	 * read, and it holds while the node is unarmed, when there is no gate.
	 *
	 * @param {string} peerId
	 */
	function assertDevice(peerId) {
		if (!armed) throw new UcepError('PAIRING_REQUIRED', 'pair the bridge with the books first');
		if (!gate?.isProved(peerId) || !known.has(peerId)) throw new UcepError('PAIRING_REQUIRED');
	}

	/** @type {Record<string, { handler: (ctx: any) => unknown, scope?: string, description?: string }>} */
	const ucepCommands = {
		help: {
			handler: () => ({
				commands: Object.keys(ucepCommands),
				armed,
				// What `request` dispatches on, by the HTTP method and path the app knows (stream.js).
				requests: (commands ?? []).filter(offered).map((c) => ({
					name: c.name,
					method: c.method,
					path: typeof c.path === 'string' ? c.path : null
				}))
			})
		},
		handover: {
			scope: PAIR_SCOPE,
			description: 'The books’ device auth key, relays and devices → the node restarts armed',
			handler: async ({ argsJson, peerId }) => {
				if (armed) throw new UcepError('INVALID_ARGUMENTS', 'already armed: unpair first');
				const handover = parseHandover(argsJson);
				// The device that hands the key over is a device of the books.
				if (!handover.devices.includes(peerId)) handover.devices.push(peerId);
				log(
					`handover from a device: ${handover.relays.length} relay(s), ${handover.devices.length} device(s)`
				);
				// Not awaited, and not at once: the restart that follows closes this
				// very stream, and the answer must be on its way before (#575).
				setTimeout(() => {
					onHandover(handover).catch((e) => log(`handover failed: ${e.message}`));
				}, HANDOVER_RESTART_MS);
				return { peerId: libp2p.peerId.toString() };
			}
		},
		devices: {
			// No UCEP scope: armed, any proved device of the books keeps the list
			// current (the gate is the check); unarmed, the handover brings it.
			description: 'The books’ device list, as the app keeps it',
			handler: async ({ argsJson, peerId }) => {
				const list = Array.isArray(argsJson?.devices) ? argsJson.devices : [];
				if (list.length > 64 || !list.every(isPeerId)) {
					throw new UcepError('INVALID_ARGUMENTS', 'devices must be up to 64 peer ids');
				}
				assertDevice(peerId);
				setDevices([...new Set(list)]);
				await onDevices([...known]);
				return { devices: known.size };
			}
		},
		...(commands
			? {
					request: {
						description:
							'One bridge call: { method, path, body? } → { status, contentType, json | base64 } (the commands of src/commands.js)',
						handler: async ({ argsJson, peerId, limited }) => {
							assertDevice(peerId);
							return answerRequest({ commands, args: argsJson, limited, log });
						}
					}
				}
			: {})
	};

	/** @type {ReturnType<typeof createProvider>} */
	let provider;
	try {
		provider = createProvider({
			libp2p,
			manifest: {
				id: EXTENSION,
				name: 'Belege bridge',
				version: EXTENSION_VERSION,
				description: 'The bridge of these books, for their devices.',
				scopes: [{ name: PAIR_SCOPE, description: 'Pair this bridge with the books' }]
			},
			commands: ucepCommands,
			pairingModes: ['INVITATION'],
			store: {
				grants: fileStore(join(dir, 'grants.json')),
				invitations: fileStore(join(dir, 'invitations.json'))
			}
		});
		await provider.start();
	} catch (error) {
		await libp2p.stop().catch(() => {});
		throw error;
	}

	/** @param {string[]} peerIds */
	function setDevices(peerIds) {
		const next = new Set(peerIds);
		for (const peer of known) if (!next.has(peer)) gate?.forget(peer);
		known.clear();
		for (const peer of next) known.add(peer);
	}

	const peerId = libp2p.peerId.toString();
	log(`node ${armed ? 'armed' : 'unarmed'}, peer ${peerId}`);

	return {
		peerId,
		armed,
		libp2p,
		addrs: () => libp2p.getMultiaddrs().map((/** @type {any} */ a) => a.toString()),
		async invite() {
			if (armed)
				throw new Error('An armed bridge pairs no new device by invitation: unpair first.');
			const { uri } = await provider.createInvitation({
				scopes: [PAIR_SCOPE],
				ttlSeconds: INVITATION_TTL_S
			});
			return uri;
		},
		setDevices,
		devices: () => new Set(known),
		async stop() {
			await provider.stop().catch(() => {});
			await libp2p.stop();
		}
	};
}

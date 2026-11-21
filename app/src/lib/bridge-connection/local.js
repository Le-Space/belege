// The bridge on a computer (#844, B5): its node reached over a stream – on
// this machine with device sync off, as a device of the books with it on –,
// its pairing by invitation, the bridge between own devices, and what each
// device may call there. Moved out of session.svelte.js unchanged; the stream
// to the bridge's node and the node on this machine are this module's state.
import { networkPause } from '$lib/network-pause.js';
import { keyGenerationOf, readBridgeRecord, writeBridgeRecord } from './record.js';
import { t } from '$lib/i18n/index.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {Awaited<ReturnType<typeof import('$lib/sync/device-sync.js').startDeviceSync>> | null} deviceSync
 * @property {() => string} deviceLabel how this device names itself to the bridge
 */

/** @type {SessionContext} */
let ctx;

/** @param {SessionContext} context */
export function bindSession(context) {
	ctx = context;
}

const isoNow = () => new Date().toISOString();

/** The stream to the bridge's node, when there is one: for the hosted bridges and the cards. */
export const currentBridgeConsumer = () => bridgeConsumer;

/** @type {Awaited<ReturnType<typeof import('../sync/remote-bridge.js').startBridgeConsumer>> | null} */
let bridgeConsumer = null;

/** This device's own peer id (node.js `devicePeerKey`): what the bridge lists it as. */
async function devicePeerId() {
	if (!ctx.session?.devicePeerKey) return /** @type {string} */ (ctx.session?.peerId);
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
	return peerIdFromPrivateKey(ctx.session.devicePeerKey).toString();
}

/** @type {{ libp2p: any, gate: any } | null} the node to the bridge on this machine (#580) */
let loopback = null;
/** Dial the bridge's node on this machine again; set while `loopback` runs. @type {(() => Promise<void>) | null} */
let loopbackDial = null;

/**
 * Whether these books may pair the bridge's node by its invitation on their
 * own (#580): a bridge paired by code whose node these books never paired.
 * One they paired before and that is unarmed now was unpaired on purpose –
 * "Kopplung lösen", or on its own machine – and is not paired again unasked.
 *
 * @param {any} saved settings `bridge`
 */
const mayPairNodeByCode = (saved) => Boolean(saved?.token) && !saved?.nodePairedAt;

/**
 * Pair the node of a bridge paired by code, when these books may (above):
 * its invitation over HTTP with the token (`node.invite`), then
 * `pairBridgeNode` over whichever node reaches it – device sync's, or the one
 * on this machine. Quietly nothing when the bridge has no node or it is
 * armed already.
 *
 * @param {{ health: () => Promise<any>, nodeInvite: () => Promise<string> }} http
 * @param {any} saved settings `bridge`
 */
async function pairNodeByCode(http, saved) {
	if (!mayPairNodeByCode(saved)) return;
	/** @type {any} */
	const health = await http.health().catch(() => null);
	if (!health?.node?.enabled || health.node.armed) return;
	const invitation = await http.nodeInvite().catch(() => null);
	// No relays: paired by code, the bridge does not go online itself.
	if (invitation) await pairBridgeNode(invitation, { relays: [] });
}

/**
 * The bridge on this machine over a stream, with device sync off (#580,
 * sync/loopback-bridge.js): a node of its own that dials 127.0.0.1 only. A
 * bridge paired by code whose node these books never paired is paired here by
 * its invitation (`pairNodeByCode`); from then on its functions go over the
 * stream, and HTTP keeps pairing, health, shares and the backup upload. Not
 * while the network is paused. A bridge whose node is paired with other books,
 * or unpaired on purpose, is not reached this way; HTTP answers its functions
 * 410 then, and the card says so.
 */
export async function startLoopbackBridge() {
	if (!ctx.session || ctx.session.online || loopback || !ctx.session.devicePeerKey) return;
	if (networkPause()) return;
	const settings = ctx.session.store.settings;
	const saved = await readBridgeRecord(settings);
	if (!saved?.token && !saved?.peerId) return;
	const { createBridgeClient, setBridgeTransport, holdBridgeTransport } = await import(
		'../bridge/client.js'
	);
	// Calls wait until the stream is the bridge's transport: over HTTP they
	// would only get 410 (a page opened right after pairing by code). From
	// then on each call waits for the node itself (`waitMs` below).
	const release = holdBridgeTransport(30_000);
	try {
		await startLoopbackBridgeHeld(saved, createBridgeClient, setBridgeTransport, release);
	} finally {
		release();
	}
}

/**
 * @param {any} saved settings `bridge`
 * @param {typeof import('../bridge/client.js').createBridgeClient} createBridgeClient
 * @param {typeof import('../bridge/client.js').setBridgeTransport} setBridgeTransport
 * @param {() => void} release lets the held calls go
 */
async function startLoopbackBridgeHeld(saved, createBridgeClient, setBridgeTransport, release) {
	if (!ctx.session) return;
	const http = createBridgeClient({
		...(saved?.url ? { url: saved.url } : {}),
		token: saved?.token ?? null,
		fetch
	});
	/** @type {any} */
	const health = await http.health().catch(() => null);
	const { loopbackAddr, startLoopbackNode } = await import('../sync/loopback-bridge.js');
	const addr = loopbackAddr(health?.node?.addrs);
	if (!health?.node?.enabled || !addr || typeof health.node.peerId !== 'string') return;
	// A node already paired, but not with these books: theirs is not ours to call.
	if (health.node.armed && saved?.peerId !== health.node.peerId) return;
	// Unpaired on purpose: not paired again unasked.
	if (!health.node.armed && !mayPairNodeByCode(saved)) return;

	const { startBridgeConsumer, bridgeFetch, setBridgeNode } = await import(
		'../sync/remote-bridge.js'
	);
	const { multiaddr } = await import('@multiformats/multiaddr');
	const nodePeer = health.node.peerId;
	await loadBridgeAuth().catch(() => {});
	ctx.session.bridgeAuth.peerId = nodePeer;
	loopback = await startLoopbackNode({
		privateKey: ctx.session.devicePeerKey,
		bridge: ctx.session.bridgeAuth
	});
	const node = loopback;
	loopbackDial = async () => {
		await node.libp2p.dial(multiaddr(`${addr}/p2p/${nodePeer}`), {
			signal: AbortSignal.timeout(5000)
		});
	};
	// Dialled until it is there and proved, with growing pauses: the bridge
	// may start after the page, or take its time to restart (a pairing, an
	// update). One loop at a time; none while the network is paused.
	let dialling = false;
	const keepDialling = async () => {
		if (dialling) return;
		dialling = true;
		try {
			for (let pause = 1000; loopback === node && !node.gate.isProved(nodePeer); ) {
				if (!networkPause()) await loopbackDial?.().catch(() => {});
				if (node.gate.isProved(nodePeer)) break;
				await new Promise((r) => setTimeout(r, pause));
				pause = Math.min(pause * 2, 30_000);
			}
		} finally {
			dialling = false;
		}
	};
	node.libp2p.addEventListener('peer:disconnect', (/** @type {any} */ e) => {
		if (String(e.detail) !== nodePeer || loopback !== node) return;
		setTimeout(() => keepDialling().catch(() => {}), 1000);
	});
	const consumer = await startBridgeConsumer({
		libp2p: node.libp2p,
		label: ctx.deviceLabel(),
		devices: () => [],
		isProved: (peerId) => Boolean(node.gate.isProved(peerId)),
		bridgeKey: () => ctx.session?.bridgeAuth.key ?? null
	});
	bridgeConsumer = consumer;
	setBridgeTransport(
		bridgeFetch({
			// HTTP no longer carries the bridge's functions: a call waits a while for
			// the node (a restart, a dial still on its way) rather than go there.
			stream: () => (input, init) => consumer.streamFetch(input, init, { waitMs: 45_000 }),
			remote: () => null,
			onRoute: (r) => (ctx.app.sync.bridgeRoute = r)
		})
	);
	// The node's peer id is the same before and after its pairing: calls wait for it from now on.
	setBridgeNode({ peerId: nodePeer });
	release();
	if (health.node.armed) {
		keepDialling().catch(() => {});
		return;
	}
	await loopbackDial().catch(() => {});
	await pairNodeByCode(http, saved);
	keepDialling().catch(() => {});
}

/**
 * The bridge on this machine over a stream (#580): right after it was paired
 * by code, and whenever the card finds it answering while this device has no
 * stream to it yet (it started after the page, say).
 */
export async function bridgeOnThisMachine() {
	if (!ctx.session?.online) {
		await startLoopbackBridge();
		return;
	}
	// Device sync on: its node is paired over device sync's node, as at an unlock.
	if (!bridgeConsumer || !ctx.deviceSync) return;
	const saved = await readBridgeRecord(ctx.session.store.settings);
	if (saved?.peerId) {
		await findBridgeNodeHere(saved);
		return;
	}
	const { createBridgeClient } = await import('../bridge/client.js');
	await pairNodeByCode(
		createBridgeClient({
			...(saved?.url ? { url: saved.url } : {}),
			token: saved?.token ?? null,
			fetch
		}),
		saved
	);
}

/**
 * The books' bridge runs on this machine: tell device sync where its node
 * listens now (sync/device-sync.js `bridgeListensAt`). The node takes a free
 * port at every start, and it may sit at none of the relays this device uses,
 * so without this a restarted bridge answers its status over HTTP while none
 * of its functions can be reached. Quiet when no bridge answers here – a
 * phone, or a bridge that is another machine's.
 *
 * @param {any} saved the settings' `bridge`
 */
async function findBridgeNodeHere(saved) {
	if (!ctx.deviceSync || !saved?.peerId) return;
	// Connected: nothing to find, and nothing asked over HTTP.
	if (bridgeConsumer?.streamServer()) return;
	const { createBridgeClient } = await import('../bridge/client.js');
	const { loopbackAddr } = await import('../sync/loopback-bridge.js');
	/** @type {any} */
	const health = await createBridgeClient({ ...(saved.url ? { url: saved.url } : {}), fetch })
		.health()
		.catch(() => null);
	const addr = loopbackAddr(health?.node?.addrs);
	// Only the node these books paired: another one's address is not ours to dial.
	if (!addr || health?.node?.peerId !== saved.peerId) return;
	await ctx.deviceSync.bridgeListensAt(saved.peerId, addr);
}

/**
 * The bridge over the stream (#573, #575): the bridge's own node, a device of
 * the books, first; the bridge between own devices (issue #142) after – this
 * device may use a desktop's bridge when its own cannot be reached, and a
 * desktop that switched "Bridge für eigene Geräte freigeben" on serves its own
 * to the devices the books know.
 */
export async function startBridgeForDevices() {
	if (!ctx.session?.online) return;
	const { startBridgeConsumer, startBridgeProvider, bridgeFetch, bridgeShareOn, setBridgeNode } =
		await import('../sync/remote-bridge.js');
	const { knownDevices } = await import('../sync/device-sync.js');
	const { setBridgeTransport } = await import('../bridge/client.js');
	const libp2p = ctx.session.libp2p;
	const settings = ctx.session.store.settings;
	// The bridge's node, as the books know it (settings `bridge.peerId`, written at its pairing).
	const readNode = async () => {
		const saved = await readBridgeRecord(settings);
		setBridgeNode(saved?.peerId ? { peerId: saved.peerId } : null);
		await loadBridgeAuth();
	};
	await readNode();
	const consumer = await startBridgeConsumer({
		libp2p,
		label: ctx.deviceLabel(),
		// `connected` only once the device proved the passkey (device-gate.js).
		devices: () =>
			(ctx.app.sync.state?.devices ?? []).filter((d) => d.connected).map((d) => d.peerId),
		isProved: (peerId) => Boolean(ctx.session?.deviceGate?.isProved(peerId)),
		bridgeKey: () => ctx.session?.bridgeAuth.key ?? null
	});
	bridgeConsumer = consumer;
	setBridgeTransport(
		bridgeFetch({
			stream: () => consumer.streamFetch,
			remote: () => consumer.remoteFetch,
			onRoute: (r) => (ctx.app.sync.bridgeRoute = r)
		})
	);
	// Paired by code with device sync on: its node is paired by its invitation
	// too (#580) – HTTP no longer carries the bridge's functions. Not awaited:
	// the pairing waits for the node to come back armed.
	(async () => {
		const saved = await readBridgeRecord(settings);
		// Paired already: where its node listens today, when it runs on this machine.
		if (saved?.peerId) return findBridgeNodeHere(saved);
		const { createBridgeClient } = await import('../bridge/client.js');
		await pairNodeByCode(
			createBridgeClient({
				...(saved?.url ? { url: saved.url } : {}),
				token: saved?.token ?? null,
				fetch
			}),
			saved
		);
	})().catch((e) => console.warn('bridge node:', e));
	// The books' device list to the bridge's node whenever it changes, from any
	// device that is connected to it: a device removed here is refused there.
	let toldDevices = '';
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let tellTimer;
	const tellDevices = async () => {
		const records = await settings.list({ includeDeleted: true });
		const { whose } = await import('../members/whose.js');
		const members = whose(records);
		// Own devices, and a writing member's the owner let use the bridge (#641, #579);
		// with what each was given when added, for a device new to the bridge.
		const list = knownDevices(records)
			.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
			.sort((a, b) => (a.peerId < b.peerId ? -1 : 1))
			.map((d) => (d.bridgeScopes ? { peerId: d.peerId, initial: d.bridgeScopes } : d.peerId));
		const key = JSON.stringify(list);
		if (key === toldDevices) return;
		if (await consumer.tellDevices(list).catch(() => false)) {
			toldDevices = key;
			ctx.app.sync.bridgeDevicesAt = Date.now();
		}
	};
	settings.onChange(() => {
		readNode().catch(() => {});
		clearTimeout(tellTimer);
		tellTimer = setTimeout(() => tellDevices().catch(() => {}), 1500);
	});
	ctx.app.sync.bridgeServed = false;
	if (!bridgeShareOn()) return;
	const { DEFAULT_BRIDGE_URL } = await import('../bridge/client.js');
	const { UcepError } = await import('@le-space/ucep');
	const { command: specOf } = await import('@le-space/bridge-protocol');
	/** @type {{ url: string, token: string } | null} */
	let own = null;
	const readOwn = async () => {
		const saved = await readBridgeRecord(settings);
		// Paired by code or by invitation: over the node it needs no token (#580).
		own =
			saved?.token || saved?.peerId
				? { url: saved.url ?? DEFAULT_BRIDGE_URL, token: saved.token ?? '' }
				: null;
	};
	await readOwn();
	settings.onChange(() => {
		readOwn().catch(() => {});
	});
	/** The bridge's grants, asked at most every 30 s. @type {{ at: number, value: any } | null} */
	let grantsKept = null;
	const grantsNow = async (fresh = false) => {
		if (!fresh && grantsKept && Date.now() - grantsKept.at < 30_000) return grantsKept.value;
		const value = await consumer.bridgeGrants().catch(() => null);
		grantsKept = value ? { at: Date.now(), value } : null;
		return value;
	};
	await startBridgeProvider({
		libp2p,
		bridge: () => own,
		// Its own bridge over the bridge's node (#580): its HTTP routes are gone.
		// Never on to another device: a call that came from one goes no further.
		fetch: bridgeFetch({ stream: () => consumer.streamFetch, remote: () => null }),
		// What the asking device may call there (#579): its own scopes, as the
		// bridge keeps them – not this desktop's. Only the device that paired
		// the bridge sees every device's; another desktop forwards nothing.
		mayCall: async (/** @type {string} */ peerId, /** @type {string} */ name) => {
			const scope = specOf(name)?.scope ?? '';
			// A command without a scope (`bridge.health`) is for every device of the books.
			if (!scope) return;
			const find = (/** @type {any} */ g) =>
				g?.devices?.find((/** @type {any} */ d) => d.peerId === peerId);
			let grants = await grantsNow();
			// A device the kept answer does not know yet (added since): asked again, once.
			if (grants && !find(grants)) grants = await grantsNow(true);
			if (!grants) throw new UcepError('UNAVAILABLE', 'the bridge’s node is not connected');
			const device = find(grants);
			if (!device || !device.scopes.includes(scope)) throw new UcepError('SCOPE_MISSING', scope);
			if (device.expiresAt !== null && device.expiresAt < Date.now()) {
				throw new UcepError('GRANT_EXPIRED', scope);
			}
		},
		// A device the books know and that proved the passkey on this connection:
		// an id typed in by mistake is known, and still gets nothing.
		isOwnDevice: async (peerId) => {
			if (!ctx.session?.deviceGate?.isProved(peerId)) return false;
			// The bridge's own node is no device that may use this one's bridge.
			if (!knownDevices(await settings.list()).some((d) => d.peerId === peerId && !d.bridge)) {
				return false;
			}
			// A member's device proves the same key, and is not one of these: the
			// share is for the owner's own devices (members reach a bridge only as
			// the owner admitted them).
			const { whose } = await import('../members/whose.js');
			return !whose(await settings.list({ includeDeleted: true })).isMemberDevice(peerId);
		}
	});
	ctx.app.sync.bridgeServed = true;
}

/**
 * The bridge's key for this session's gate (node.js `bridgeAuth`): the peer
 * the books name as their bridge and its key of the current generation. Read
 * before device sync dials anyone, and again when the settings change.
 */
export async function loadBridgeAuth() {
	if (!ctx.session?.bridgeAuthBase) return;
	const saved = await readBridgeRecord(ctx.session.store.settings);
	const { bridgeAuthKeyOf } = await import('../database-keys.js');
	const peerId = typeof saved?.peerId === 'string' ? saved.peerId : null;
	ctx.session.bridgeAuth.key = peerId
		? await bridgeAuthKeyOf(ctx.session.bridgeAuthBase, keyGenerationOf(saved))
		: null;
	ctx.session.bridgeAuth.peerId = peerId;
}

/**
 * "Über Einladung koppeln" (Integrationen → Bridge, #575): pair the bridge's
 * own node by the invitation `pnpm bridge` printed, hand it the bridge's own
 * key (never the books' device key), the relays and the devices, and add it to
 * the books as their bridge. Then wait for it to come back armed and proved,
 * so the next call goes over the stream.
 *
 * @param {string} invitation `web+ucep:pair?…`
 * @param {{ relays?: string[] }} [options] the relays it gets: the books' by default; none for a
 *   bridge paired by code, which stays on this machine (#580)
 * @returns {Promise<{ peerId: string }>} the bridge's node
 */
export async function pairBridgeNode(invitation, { relays } = {}) {
	// Online through device sync, or – with it off – over the stream on this machine (#580).
	if (!ctx.session?.bridgeAuthBase || !bridgeConsumer || (ctx.session.online && !ctx.deviceSync)) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	const { knownDevices } = await import('../sync/device-sync.js');
	const { setBridgeNode } = await import('../sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('../database-keys.js');
	const settings = ctx.session.store.settings;
	const saved = (await readBridgeRecord(settings)) ?? {};
	const keyGeneration = keyGenerationOf(saved);
	const key = await bridgeAuthKeyOf(ctx.session.bridgeAuthBase, keyGeneration);
	const records = await settings.list({ includeDeleted: true });
	const { whose } = await import('../members/whose.js');
	const members = whose(records);
	// Own devices, and a writing member's the owner let use the bridge (#641, #579).
	const own = knownDevices(records)
		.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
		.map((d) => d.peerId);
	// A bridge whose pairing was undone keeps its peer id, and these books hold
	// it as a removed device, which is never dialled: let it through for this.
	/** @type {string | null} */
	let coming = null;
	const { peerId, addrs } = await bridgeConsumer
		.pairBridge({
			invitation,
			authKey: key,
			relays: relays ?? ctx.session.relays,
			devices: [await devicePeerId(), ...own],
			before: (peer) => {
				coming = peer;
				ctx.deviceSync?.expectDevice(peer);
			}
		})
		.catch((error) => {
			if (coming) ctx.deviceSync?.expectDevice(coming, false);
			throw error;
		});
	// Known as the books' bridge at once – the gate proves with its key toward it –
	// and in the books (settings `bridge`), for the other devices.
	ctx.session.bridgeAuth.peerId = peerId;
	ctx.session.bridgeAuth.key = key;
	setBridgeNode({ peerId });
	await writeBridgeRecord(settings, {
		token: null,
		...saved,
		peerId,
		keyGeneration,
		nodePairedAt: isoNow()
	});
	// A device of the books from now on; dialled where it listens, and through the relays.
	const label = t('messages.bridge.deviceLabel');
	const until = Date.now() + 45_000;
	await new Promise((r) => setTimeout(r, 1500)); // the node restarts armed
	if (!ctx.deviceSync) {
		// Device sync off: the node on this machine, dialled again until it proves (#580).
		while (!bridgeConsumer.streamServer() && Date.now() < until) {
			await loopbackDial?.().catch(() => {});
			if (!bridgeConsumer.streamServer()) await new Promise((r) => setTimeout(r, 1000));
		}
		return { peerId };
	}
	await ctx.deviceSync.addDevice(peerId, label, { bridge: true, addrs });
	while (!bridgeConsumer.streamServer() && Date.now() < until) {
		await new Promise((r) => setTimeout(r, 2000));
		if (!bridgeConsumer.streamServer())
			await ctx.deviceSync.addDevice(peerId, label, { bridge: true, addrs });
	}
	return { peerId };
}

/** "Kopplung lösen" over the stream: the bridge's node forgets its key and offers pairing again. */
export async function forgetBridgeNode() {
	await bridgeConsumer?.forgetBridge();
}

/** What each device may do with the bridge's node, or null when it is not connected (#579). */
export async function bridgeGrants() {
	return (await bridgeConsumer?.bridgeGrants()) ?? null;
}

/** The device that paired the bridge lets a device whose access lapsed in again. @param {string} peerId */
export async function renewBridgeDevice(peerId) {
	return (await bridgeConsumer?.renewDevice(peerId)) ?? false;
}

/**
 * The device that paired the bridge sets what one device may call there (#579).
 *
 * @param {string} peerId
 * @param {string[]} scopes
 * @returns {Promise<string[] | null>} what it holds now; null: the bridge's node is not connected
 */
export async function setBridgeDeviceScopes(peerId, scopes) {
	return (await bridgeConsumer?.setDeviceScopes(peerId, scopes)) ?? null;
}

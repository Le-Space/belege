// The network of the open books (#844, B9): the invoicing app's node (UCEP),
// the header's network menu – pause, resume, own devices on or off – and where
// devices meet. Moved out of session.svelte.js unchanged.
import { networkPause } from '$lib/network-pause.js';
import { getSetting } from '$lib/store/settings.js';
import { readBridgeRecord } from '$lib/bridge-connection/record.js';
import { pairedClient } from '$lib/bridge-connection/paired-client.js';
import { t } from '$lib/i18n/index.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 * @property {() => boolean} readOnly
 * @property {ReturnType<typeof import('$lib/receipts/prefetch.js').createFilePrefetcher> | null} filePrefetch
 */

/** @type {SessionContext} */
let ctx;

/** @param {SessionContext} context */
export function bindSession(context) {
	ctx = context;
}

/** After the books closed or changed: the bridge's relay is asked for again at the next unlock. */
export function forgetLanRelayAsked() {
	lanRelayAskedWith = '';
}

/** @type {{ node: any, consumer: any, relays: string[] } | null} */
let ucep = null;

/** The running consumer and its relays, for the pairing card and the Eigenbeleg form. */
export function currentUcep() {
	return ucep;
}

/** Only when a paired app exists; see `startUcep`. */
export async function startUcepIfPaired() {
	if (!ctx.session || ctx.readOnly()) return;
	if (networkPause()) return;
	const { pairedApp } = await import('../ucep/consumer.js');
	if (await pairedApp(ctx.session.store.settings)) await startUcep();
}

/**
 * Take UCEP offline again: after unpairing, Belege has no reason to keep a
 * connection to the relay (the consent screen promises as much).
 */
export async function stopUcep() {
	const running = ucep;
	ucep = null;
	ctx.app.ucep.status = 'off';
	ctx.app.ucep.peerId = null;
	if (!running) return;
	await running.consumer.stop?.().catch(() => {});
	await running.node.stop().catch(() => {});
}

// The header's network menu (issue: switch the network off from the badge).
// Device sync runs on the books' own libp2p node, which cannot stop without
// closing the books: its connection gater is shut instead
// (sync/device-sync.js `setSyncGateClosed`) and every connection hung up.
// The invoicing app has a node of its own, stopped and started as it is.

/** Shut or open the sync node's gate: shut while paused or device sync is off. */
async function applySyncGate() {
	const { deviceSyncOn, setSyncGateClosed } = await import('../sync/device-sync.js');
	const closed = Boolean(networkPause()) || !deviceSyncOn();
	setSyncGateClosed(closed);
	return closed;
}

function hangUpSync() {
	for (const c of ctx.session?.libp2p?.getConnections?.() ?? []) {
		c.close().catch(() => {});
	}
}

async function redialRelays() {
	if (!ctx.session?.libp2p || !ctx.session.relays?.length) return;
	const { multiaddr } = await import('@multiformats/multiaddr');
	for (const relay of ctx.session.relays) {
		ctx.session.libp2p.dial(multiaddr(relay)).catch(() => {});
	}
}

/** "Alles pausieren": nothing online, now and at the next unlock, until resumed. */
export async function pauseNetwork() {
	const { setNetworkPause } = await import('../network-pause.js');
	setNetworkPause({
		ucep: ctx.app.ucep.status === 'running' || ctx.app.ucep.status === 'starting'
	});
	ctx.app.network.paused = true;
	await applySyncGate();
	hangUpSync();
	await stopUcep();
}

/** "Fortsetzen": what was on goes online again – at once where the node can. */
export async function resumeNetwork() {
	const { setNetworkPause } = await import('../network-pause.js');
	const pause = networkPause();
	setNetworkPause(null);
	ctx.app.network.paused = false;
	const closed = await applySyncGate();
	const { deviceSyncOn } = await import('../sync/device-sync.js');
	if (!closed && ctx.session?.online) await redialRelays();
	if (!closed) ctx.filePrefetch?.retryAll();
	// Paused at unlock: the node has no transports; going online takes a new unlock.
	ctx.app.network.reloadNeeded = deviceSyncOn() && !ctx.session?.online;
	if (pause?.ucep) await startUcep();
}

/**
 * "Eigene Geräte" on or off, in the menu and in the consent screen alike
 * (#327). Off: now, and at the next unlock. On: at once when this session's
 * node went online at unlock, else from the next unlock (`reloadNeeded`).
 * Before an unlock only the choice is kept: the unlock applies it.
 *
 * @param {boolean} on
 */
export async function setDevicesNetwork(on) {
	const { setDeviceSync } = await import('../sync/device-sync.js');
	setDeviceSync(on);
	if (!ctx.session) return;
	const closed = await applySyncGate();
	if (!on) {
		hangUpSync();
		ctx.app.sync.online = false;
		ctx.app.network.reloadNeeded = false;
		return;
	}
	if (!closed && ctx.session?.online) {
		ctx.app.sync.online = true;
		await redialRelays();
	} else {
		ctx.app.network.reloadNeeded = true;
	}
}

/**
 * The books' mode, when they name one: a newer choice from another device
 * becomes this browser's too, and applies at the next unlock.
 */
export async function applyStoredMode() {
	if (!ctx.session) return;
	const { NETWORK_MODE_SETTING, modeOfSetting, setNetworkModeMirror } = await import(
		'../sync/network-mode.js'
	);
	// Two devices may choose at once: the newest choice counts.
	const [newest] = (
		await ctx.session.store.settings.list({ where: (r) => r.key === NETWORK_MODE_SETTING })
	).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
	const stored = modeOfSetting(newest?.value);
	if (stored) {
		setNetworkModeMirror(stored);
		ctx.app.network.modeWanted = stored;
	}
	await applyStoredLanRelay();
}

/** The own bridge's relay as the books know it, copied into this browser for the next unlock. */
async function applyStoredLanRelay() {
	if (!ctx.session) return;
	const { LAN_RELAY_SETTING, isLanRelayAddr, lanRelayAddr, setLanRelayMirror } = await import(
		'../sync/network-mode.js'
	);
	const addr = /** @type {any} */ (await getSetting(ctx.session.store.settings, LAN_RELAY_SETTING))
		?.addr;
	if (isLanRelayAddr(addr)) setLanRelayMirror(addr);
	ctx.app.network.lanRelay = lanRelayAddr();
	// Not awaited: the books open whatever the bridge answers.
	learnLanRelay().catch(() => {});
}

/** The bridge token the relay's address was last asked with: once per pairing, not per change. */
let lanRelayAskedWith = '';

/**
 * Ask the paired bridge for its relay in the own network (bridge/src/lan-relay.js)
 * and keep a new address in the books, so every device learns it.
 */
async function learnLanRelay() {
	if (!ctx.session) return;
	const saved = await readBridgeRecord(ctx.session.store.settings);
	// A token over HTTP, or the bridge's node over the stream (#575).
	const pairing = saved?.token ?? saved?.peerId ?? null;
	if (!pairing || pairing === lanRelayAskedWith) return;
	lanRelayAskedWith = pairing;
	const client = await pairedClient();
	const relay = await client?.lanRelay().catch(() => null);
	const { LAN_RELAY_SETTING, isLanRelayAddr } = await import('../sync/network-mode.js');
	if (!relay?.running || !isLanRelayAddr(relay.addr) || relay.addr === ctx.app.network.lanRelay) {
		return;
	}
	const { setSetting } = await import('../store/settings.js');
	await setSetting(ctx.session.store.settings, LAN_RELAY_SETTING, { addr: relay.addr });
}

/**
 * "Wo sich Geräte treffen" in the header menu: kept in the books, so every
 * device learns it, and in this browser; the node follows at the next unlock.
 *
 * @param {import('../sync/network-mode.js').NetworkMode} mode
 */
export async function setNetworkMode(mode) {
	const { NETWORK_MODE_SETTING, isNetworkMode, setNetworkModeMirror } = await import(
		'../sync/network-mode.js'
	);
	if (!isNetworkMode(mode)) throw new Error(t('messages.sync.unknownMode', { mode }));
	setNetworkModeMirror(mode);
	ctx.app.network.modeWanted = mode;
	if (ctx.session) {
		const { setSetting } = await import('../store/settings.js');
		await setSetting(ctx.session.store.settings, NETWORK_MODE_SETTING, { mode });
	}
}

/** Read the paired app again, after pairing or unpairing. */
export async function refreshUcep() {
	if (!ctx.session) return;
	const { pairedApp } = await import('../ucep/consumer.js');
	ctx.app.ucep.app = await pairedApp(ctx.session.store.settings);
}

/**
 * Start UCEP: after unlocking only when Belege is paired (the relay sees our
 * IP address, and nobody who does not use UCEP should pay that), otherwise
 * when the person asks for it on the Integrationen card. In the background: an
 * unreachable relay must not keep anybody from their books.
 */
export async function startUcep() {
	if (!ctx.session || ucep) return;
	ctx.app.ucep.status = 'starting';
	ctx.app.ucep.error = null;
	try {
		const { startUcepNode, relayAddrs } = await import('../ucep/net.js');
		const { createBelegeConsumer, forgetStoredCatalogue } = await import('../ucep/consumer.js');
		// The Le-Space relays as Aleph knows them now (ucep/net.js); the ones
		// device sync already found, when it is on.
		const relays = ctx.session.relays?.length ? ctx.session.relays : await relayAddrs();
		const node = await startUcepNode({ seed: ctx.session.ucepSeed, relays });
		const consumer = createBelegeConsumer({
			libp2p: node,
			settings: ctx.session.store.settings,
			label: 'Belege'
		});
		await consumer.start();
		await forgetStoredCatalogue(ctx.session.store.settings).catch(() => 0);
		ucep = { node, consumer, relays };
		ctx.app.ucep.peerId = node.peerId.toString();
		await refreshUcep();
		ctx.app.ucep.status = 'running';
	} catch (error) {
		console.error('UCEP did not start:', error);
		ctx.app.ucep.status = 'failed';
		ctx.app.ucep.error = error instanceof Error ? error.message : String(error);
	}
}

// App-wide state: who is signed in, and the records the pages show.
import { networkPause } from './network-pause.js';
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting } from './store/settings.js';
import { classifyTransaction, cleanMatchingSettings } from './matching/classify.js';
import { buildMatchingContext } from './matching/context.js';
import { cleanChart } from './booking/chart.js';
import { t } from './i18n/index.js';

/** @typedef {import('./node.js').Session} Session */
/** @typedef {import('./store/repository.js').StoredRecord} StoredRecord */

export const app = $state({
	/** @type {'locked' | 'starting' | 'ready' | 'error'} */
	status: 'locked',
	/** @type {string | null} */
	error: null,
	/** @type {string | null} */
	did: null,
	/** Device sync (#123): off, or this device's id and the devices it knows. */
	sync: {
		online: false,
		/** @type {import('./sync/device-sync.js').SyncState | null} */
		state: null,
		/** @type {string | null} */
		error: null,
		/** Another device removed this one; its sync is switched off. */
		removed: false,
		/** This desktop serves its bridge to own devices (#142). */
		bridgeServed: false,
		/**
		 * How the bridge answered last: here, or through an own device's (#142).
		 * @type {'local' | 'device'}
		 */
		bridgeRoute: 'local'
	},
	/** @type {StoredRecord[]} */
	transactions: [],
	/** @type {StoredRecord[]} */
	receipts: [],
	/** @type {StoredRecord[]} */
	partners: [],
	/** @type {StoredRecord[]} */
	accounts: [],
	/** @type {StoredRecord[]} */
	matches: [],
	/** @type {StoredRecord[]} */
	questions: [],
	/** @type {StoredRecord[]} the Verlauf, newest first */
	events: [],
	/** @type {Record<string, import('./matching/classify.js').Classification>} bookings that need no receipt, by id */
	classifications: {},
	/** @type {any} the stored "Eigene Anweisungen" (settings key `matching`) */
	matchingSettings: null,
	/** @type {any} the stored DATEV values (settings key `datev`, booking/settings.js) */
	datevSettings: null,
	/** @type {import('./booking/chart.js').StoredChart | null} the person's chart of accounts (settings key `chart`) */
	chart: null,
	/** whether an "Abgleich" is running */
	matching: false,
	/** @type {import('./matching/engine.js').MatchingProgress | null} where the running "Abgleich" is */
	matchingProgress: null,
	/** The header's network menu (network-pause.js): paused, or a reload needed to go online. */
	network: {
		paused: Boolean(networkPause()),
		reloadNeeded: false,
		/** this session's node went online at unlock: device sync can go on and off at once */
		syncCapable: false,
		/**
		 * Where own devices meet (sync/network-mode.js, #148): as this session's
		 * node was built, and as the books say now – a change applies at the next unlock.
		 * @type {import('./sync/network-mode.js').NetworkMode}
		 */
		mode: 'public',
		/** @type {import('./sync/network-mode.js').NetworkMode} */
		modeWanted: 'public',
		/** @type {string | null} the relay in the own bridge, as the books know it (#148) */
		lanRelay: null
	},
	/** Belege as a UCEP consumer (ucep/): the invoicing app it is paired with. */
	ucep: {
		/** @type {'off' | 'starting' | 'running' | 'failed'} */
		status: 'off',
		/** @type {string | null} */
		peerId: null,
		/** @type {string | null} */
		error: null,
		/** @type {import('./ucep/consumer.js').PairedApp | null} */
		app: null
	}
});

/** @type {{ node: any, consumer: any, relays: string[] } | null} */
let ucep = null;

/** The running consumer and its relays, for the pairing card and the Eigenbeleg form. */
export function currentUcep() {
	return ucep;
}

/** Only when a paired app exists; see `startUcep`. */
async function startUcepIfPaired() {
	if (!session) return;
	if (networkPause()) return;
	const { pairedApp } = await import('./ucep/consumer.js');
	if (await pairedApp(session.store.settings)) await startUcep();
}

/**
 * Take UCEP offline again: after unpairing, Belege has no reason to keep a
 * connection to the relay (the consent screen promises as much).
 */
export async function stopUcep() {
	const running = ucep;
	ucep = null;
	app.ucep.status = 'off';
	app.ucep.peerId = null;
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
	const { deviceSyncOn, setSyncGateClosed } = await import('./sync/device-sync.js');
	const closed = Boolean(networkPause()) || !deviceSyncOn();
	setSyncGateClosed(closed);
	return closed;
}

function hangUpSync() {
	for (const c of session?.libp2p?.getConnections?.() ?? []) {
		c.close().catch(() => {});
	}
}

async function redialRelays() {
	if (!session?.libp2p || !session.relays?.length) return;
	const { multiaddr } = await import('@multiformats/multiaddr');
	for (const relay of session.relays) {
		session.libp2p.dial(multiaddr(relay)).catch(() => {});
	}
}

/** "Alles pausieren": nothing online, now and at the next unlock, until resumed. */
export async function pauseNetwork() {
	const { setNetworkPause } = await import('./network-pause.js');
	setNetworkPause({ ucep: app.ucep.status === 'running' || app.ucep.status === 'starting' });
	app.network.paused = true;
	await applySyncGate();
	hangUpSync();
	await stopUcep();
}

/** "Fortsetzen": what was on goes online again – at once where the node can. */
export async function resumeNetwork() {
	const { setNetworkPause } = await import('./network-pause.js');
	const pause = networkPause();
	setNetworkPause(null);
	app.network.paused = false;
	const closed = await applySyncGate();
	const { deviceSyncOn } = await import('./sync/device-sync.js');
	if (!closed && session?.online) await redialRelays();
	// Paused at unlock: the node has no transports; going online takes a new unlock.
	app.network.reloadNeeded = deviceSyncOn() && !session?.online;
	if (pause?.ucep) await startUcep();
}

/**
 * "Eigene Geräte" on or off in the menu. Off: now, and at the next unlock.
 * On: at once when this session's node went online at unlock, else from the
 * next unlock.
 *
 * @param {boolean} on
 */
export async function setDevicesNetwork(on) {
	const { setDeviceSync } = await import('./sync/device-sync.js');
	setDeviceSync(on);
	const closed = await applySyncGate();
	if (!on) {
		hangUpSync();
		app.sync.online = false;
		return;
	}
	if (!closed && session?.online) {
		app.sync.online = true;
		await redialRelays();
	} else {
		app.network.reloadNeeded = true;
	}
}

/**
 * The books' mode, when they name one: a newer choice from another device
 * becomes this browser's too, and applies at the next unlock.
 */
async function applyStoredMode() {
	if (!session) return;
	const { NETWORK_MODE_SETTING, modeOfSetting, setNetworkModeMirror } = await import(
		'./sync/network-mode.js'
	);
	// Two devices may choose at once: the newest choice counts.
	const [newest] = (
		await session.store.settings.list({ where: (r) => r.key === NETWORK_MODE_SETTING })
	).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
	const stored = modeOfSetting(newest?.value);
	if (stored) {
		setNetworkModeMirror(stored);
		app.network.modeWanted = stored;
	}
	await applyStoredLanRelay();
}

/** The own bridge's relay as the books know it, copied into this browser for the next unlock. */
async function applyStoredLanRelay() {
	if (!session) return;
	const { LAN_RELAY_SETTING, isLanRelayAddr, lanRelayAddr, setLanRelayMirror } = await import(
		'./sync/network-mode.js'
	);
	const addr = /** @type {any} */ (await getSetting(session.store.settings, LAN_RELAY_SETTING))
		?.addr;
	if (isLanRelayAddr(addr)) setLanRelayMirror(addr);
	app.network.lanRelay = lanRelayAddr();
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
	if (!session) return;
	const saved = /** @type {any} */ (await getSetting(session.store.settings, 'bridge'));
	if (!saved?.token || saved.token === lanRelayAskedWith) return;
	lanRelayAskedWith = saved.token;
	const client = await pairedClient();
	const relay = await client?.lanRelay().catch(() => null);
	const { LAN_RELAY_SETTING, isLanRelayAddr } = await import('./sync/network-mode.js');
	if (!relay?.running || !isLanRelayAddr(relay.addr) || relay.addr === app.network.lanRelay) {
		return;
	}
	const { setSetting } = await import('./store/settings.js');
	await setSetting(session.store.settings, LAN_RELAY_SETTING, { addr: relay.addr });
}

/**
 * "Wo sich Geräte treffen" in the header menu: kept in the books, so every
 * device learns it, and in this browser; the node follows at the next unlock.
 *
 * @param {import('./sync/network-mode.js').NetworkMode} mode
 */
export async function setNetworkMode(mode) {
	const { NETWORK_MODE_SETTING, isNetworkMode, setNetworkModeMirror } = await import(
		'./sync/network-mode.js'
	);
	if (!isNetworkMode(mode)) throw new Error(t('messages.sync.unknownMode', { mode }));
	setNetworkModeMirror(mode);
	app.network.modeWanted = mode;
	if (session) {
		const { setSetting } = await import('./store/settings.js');
		await setSetting(session.store.settings, NETWORK_MODE_SETTING, { mode });
	}
}

// "Ohne Relay, per QR" (sync/qr-link.js, #148). The device that shows the
// invite reads the answer back and is connected; the one that answered learns
// of the connection from the session. Either way the other device is added to
// the books only once it proved the passkey on that connection (device-gate.js).

/** How long a device connected by QR has to prove the passkey. */
const QR_PROOF_MS = 30_000;

/** @param {string} peerId */
async function addWhenProved(peerId) {
	const gate = session?.deviceGate;
	if (!gate) throw new Error(t('messages.sync.off'));
	const until = Date.now() + QR_PROOF_MS;
	// The first proof may run before the other side's muxer is ready: again, until it holds.
	while (!gate.isProved(peerId)) {
		if (Date.now() > until) {
			const { qrSession } = await import('./sync/qr-link.js');
			qrSession()?.forget(peerId);
			throw new Error(t('messages.sync.notProved'));
		}
		await gate.proveTo(peerId);
		if (!gate.isProved(peerId)) await new Promise((r) => setTimeout(r, 1000));
	}
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	await deviceSync.addDevice(peerId);
}

/** Watch the QR session for the connections this device answered. */
async function watchQrConnections() {
	if (!session?.online || (session.mode !== 'qr' && session.mode !== 'both')) return;
	const { qrSession } = await import('./sync/qr-link.js');
	qrSession()?.addEventListener('connect', (/** @type {any} */ e) => {
		if (e.detail?.direction !== 'inbound') return;
		app.sync.error = null;
		addWhenProved(String(e.detail.peerId)).catch((error) => {
			app.sync.error = error instanceof Error ? error.message : String(error);
		});
	});
}

/** "Einladung zeigen": a signed invite for the other device to scan. */
export async function qrInvite() {
	const { qrSession } = await import('./sync/qr-link.js');
	const qr = qrSession();
	if (!qr) throw new Error(t('messages.sync.noQrSession'));
	return qr.createOffer();
}

/**
 * A scanned code: an invite is answered (its answer returned, to show), an
 * answer to this device's invite connects, and the other device is added once
 * it proved the passkey.
 *
 * @param {string} text
 * @returns {Promise<{ answer: string } | { connected: string }>}
 */
export async function qrScanned(text) {
	const { qrSession, payloadKind, payloadPeer, qrPeers } = await import('./sync/qr-link.js');
	const qr = qrSession();
	if (!qr) throw new Error(t('messages.sync.noQrSession'));
	const kind = await payloadKind(text);
	if (kind !== 'offer' && kind !== 'answer') {
		throw new Error(t('messages.sync.notQrCode'));
	}
	// Met in the room: a path in the own network ("Beides", sync/first-contact.js).
	// Noted before the connection opens; dropped when the signature fails.
	const peer = await payloadPeer(text);
	if (peer) qrPeers.add(peer);
	/** @type {string} */
	let peerId;
	try {
		if (kind === 'offer') return { answer: await qr.acceptOffer(text.trim()) };
		({ peerId } = await qr.acceptAnswer(text.trim()));
	} catch (error) {
		if (peer) qrPeers.delete(peer);
		throw error;
	}
	await addWhenProved(peerId);
	return { connected: peerId };
}

/** Read the paired app again, after pairing or unpairing. */
export async function refreshUcep() {
	if (!session) return;
	const { pairedApp } = await import('./ucep/consumer.js');
	app.ucep.app = await pairedApp(session.store.settings);
}

/**
 * Start UCEP: after unlocking only when Belege is paired (the relay sees our
 * IP address, and nobody who does not use UCEP should pay that), otherwise
 * when the person asks for it on the Integrationen card. In the background: an
 * unreachable relay must not keep anybody from their books.
 */
export async function startUcep() {
	if (!session || ucep) return;
	app.ucep.status = 'starting';
	app.ucep.error = null;
	try {
		const { startUcepNode, relayAddrs } = await import('./ucep/net.js');
		const { createBelegeConsumer, forgetStoredCatalogue } = await import('./ucep/consumer.js');
		// The Le-Space relays as Aleph knows them now (ucep/net.js); the ones
		// device sync already found, when it is on.
		const relays = session.relays?.length ? session.relays : await relayAddrs();
		const node = await startUcepNode({ seed: session.ucepSeed, relays });
		const consumer = createBelegeConsumer({
			libp2p: node,
			settings: session.store.settings,
			label: 'Belege'
		});
		await consumer.start();
		await forgetStoredCatalogue(session.store.settings).catch(() => 0);
		ucep = { node, consumer, relays };
		app.ucep.peerId = node.peerId.toString();
		await refreshUcep();
		app.ucep.status = 'running';
	} catch (error) {
		console.error('UCEP did not start:', error);
		app.ucep.status = 'failed';
		app.ucep.error = error instanceof Error ? error.message : String(error);
	}
}

/** @type {Session | null} */
let session = null;

/** @returns {Session['store'] | null} */
export function currentStore() {
	return session?.store ?? null;
}

/** @returns {Session['blobs'] | null} receipt files, sealed */
export function currentBlobs() {
	return session?.blobs ?? null;
}

/** @type {Promise<void> | null} the refresh running now */
let refreshing = null;
/** Whether something asked for a refresh while one was running. */
let refreshAgain = false;

/**
 * Read the lists again. One at a time: asked while one runs, it runs once
 * more after that one (so a caller that just wrote sees its write), instead
 * of a second full read side by side.
 *
 * @returns {Promise<void>}
 */
function refresh() {
	if (refreshing) {
		refreshAgain = true;
		return refreshing;
	}
	refreshing = (async () => {
		do {
			refreshAgain = false;
			await readAll();
		} while (refreshAgain && session);
	})().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

async function readAll() {
	if (!session) return;
	const [
		transactions,
		receipts,
		partners,
		accounts,
		matches,
		questions,
		events,
		matchingSettings,
		datevSettings,
		chart
	] = await Promise.all([
		session.store.transactions.list(),
		session.store.receipts.list(),
		session.store.partners.list(),
		session.store.accounts.list(),
		session.store.matches.list(),
		session.store.questions.list(),
		session.store.events.list(),
		getSetting(session.store.settings, 'matching'),
		getSetting(session.store.settings, 'datev'),
		getSetting(session.store.settings, 'chart')
	]);
	const ctx = await buildMatchingContext({
		accounts,
		transactions,
		settings: matchingSettings,
		partners
	});
	/** @type {Record<string, import('./matching/classify.js').Classification>} */
	const classifications = {};
	for (const tx of transactions) {
		const c = classifyTransaction(tx, ctx);
		if (c) classifications[tx.id] = c;
	}
	app.transactions = transactions;
	app.receipts = receipts;
	app.partners = partners;
	app.accounts = accounts;
	app.matches = matches;
	app.questions = questions;
	app.events = events;
	app.classifications = classifications;
	app.matchingSettings = matchingSettings;
	app.datevSettings = datevSettings;
	app.chart = cleanChart(chart);
}

/** @type {Promise<unknown>} */
let matchingQueue = Promise.resolve();

/**
 * "Abgleich": receipts against transactions (matching/engine.js). Runs one at
 * a time; the lists are read again afterwards.
 *
 * @param {'manual' | 'auto'} [trigger] "Abgleich starten" is manual; after a sync, fetch or read it is auto
 * @returns {Promise<import('./matching/engine.js').MatchingResult | null>}
 */
export function runMatchingNow(trigger = 'auto') {
	const next = matchingQueue.then(async () => {
		if (!session) return null;
		app.matching = true;
		app.matchingProgress = null;
		try {
			const { runMatching } = await import('./matching/engine.js');
			return await runMatching({
				store: session.store,
				trigger,
				onProgress: (p) => (app.matchingProgress = p)
			});
		} catch (error) {
			console.error('matching failed:', error);
			return null;
		} finally {
			app.matching = false;
			app.matchingProgress = null;
			await refresh();
		}
	});
	matchingQueue = next;
	return next;
}

/** Quiet this long after the last write, and the lists are read again. */
export const REFRESH_QUIET_MS = 250;
/** A long burst (an import, reading many receipts) still shows progress this often. */
export const REFRESH_MAX_WAIT_MS = 2000;

/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;
/** When the first write of the current burst came; 0 when none waits. */
let burstStart = 0;
/**
 * An import writes hundreds of records; the lists are read again once the
 * writes stop (REFRESH_QUIET_MS), and during a long burst at most every
 * REFRESH_MAX_WAIT_MS – not after every write: each read goes through all
 * the books (docs/performance.md). A matching run reads them itself when it
 * ends, so its writes schedule nothing.
 */
function scheduleRefresh() {
	if (app.matching) return;
	const now = Date.now();
	if (!burstStart) burstStart = now;
	if (refreshTimer) clearTimeout(refreshTimer);
	const wait = Math.max(0, Math.min(REFRESH_QUIET_MS, burstStart + REFRESH_MAX_WAIT_MS - now));
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		burstStart = 0;
		void refresh();
	}, wait);
}

/** Read the lists again now (after an import, so its result shows at once). */
export function refreshNow() {
	return refresh();
}

/** Bridge client from the sealed settings, or null when none is paired. */
async function pairedClient() {
	if (!session) return null;
	const saved = await getSetting(session.store.settings, 'bridge');
	if (!saved?.token) return null;
	const { createBridgeClient, setRedactTerms } = await import('./bridge/client.js');
	// The company's names are blacked out in whatever goes to the language model (#226).
	setRedactTerms(() => cleanMatchingSettings(app.matchingSettings).companyNames);
	return createBridgeClient({ url: saved.url, token: saved.token });
}

/**
 * "Weitermachen" (Home): an AI run the page left behind (a reload, the books
 * locked) takes up the ids it had not done yet (jobs/pending.js). Only on a
 * click; nothing starts by itself after an unlock.
 *
 * @param {'extract' | 'suggest'} kind
 * @param {string[]} ids
 * @returns {Promise<boolean>} false without a paired bridge, or while a run goes
 */
export async function resumeJob(kind, ids) {
	if (!session) return false;
	const client = await pairedClient();
	if (!client) return false;
	if (kind === 'extract') {
		const { extractAll } = await import('./receipts/extract-queue.svelte.js');
		const ctx = { client, store: currentStore, blobs: currentBlobs, refresh };
		if (!(await extractAll(ctx, ids))) return false;
		await runMatchingNow();
		return true;
	}
	const { suggestAll } = await import('./matching/ai-suggest.svelte.js');
	const ctx = { client, store: () => /** @type {any} */ (currentStore()), refresh };
	const started = await suggestAll(ctx, ids);
	await refresh();
	return started;
}

/**
 * "Verwerfen" (Home): what a run left is forgotten.
 *
 * @param {'extract' | 'suggest'} kind
 */
export async function dropPendingJob(kind) {
	if (!session) return;
	const { savePending } = await import('./jobs/pending.js');
	await savePending(session.store.settings, kind, []);
}

/**
 * The shared folder, checked again (receipts/folder-watch.js): new files are
 * imported, read when a bridge is paired, and matched.
 *
 * @param {{ prompt?: boolean }} [options] `prompt` only from a click: asks for read permission
 * @returns {Promise<{ configured: boolean, permitted: boolean, created: number, counts: any } | null>}
 */
export async function checkFolderNow({ prompt = false } = {}) {
	if (!session) return null;
	const { savedFolder } = await import('./receipts/folder.js');
	const handle = await savedFolder();
	if (!handle) return { configured: false, permitted: false, created: 0, counts: null };
	const { checkFolder } = await import('./receipts/folder-watch.js');
	const store = session.store;
	const blobs = session.blobs;
	const r = await checkFolder({ store, blobs, handle, prompt });
	if (r.created.length) {
		const client = await pairedClient();
		if (client) {
			const { extractReceipt } = await import('./receipts/extract.js');
			const { needsConfirmation } = await import('./receipts/import.js');
			for (const record of r.created) {
				if (needsConfirmation(record) || String(record.mime).startsWith('image/')) continue;
				try {
					await extractReceipt({
						client,
						receipts: store.receipts,
						blobs,
						record,
						events: store.events
					});
				} catch (error) {
					console.error('reading a folder file failed:', error);
				}
			}
		}
		await refresh();
		await runMatchingNow();
	}
	return { configured: true, permitted: r.permitted, created: r.created.length, counts: r.counts };
}

/** @type {(() => void) | null} */
let stopFolderWatch = null;

/** @type {Awaited<ReturnType<typeof import('./sync/device-sync.js').startDeviceSync>> | null} */
let deviceSync = null;

/** Device sync (#123): only when this device switched it on, so the node is online. */
async function startDeviceSyncIfOn() {
	app.sync.online = Boolean(session?.online);
	if (!session?.online || deviceSync) return;
	try {
		const { startDeviceSync, deviceSyncSince, setDeviceSync } = await import(
			'./sync/device-sync.js'
		);
		deviceSync = await startDeviceSync({
			libp2p: session.libp2p,
			store: session.store,
			relays: session.relays,
			label: deviceLabel(),
			since: deviceSyncSince(),
			onState: (state) => {
				app.sync.state = state;
			},
			gate: session.deviceGate ?? undefined,
			onRemoved: () => {
				setDeviceSync(false);
				app.sync.removed = true;
				app.sync.state = null;
			}
		});
		await startBridgeForDevices();
	} catch (error) {
		app.sync.error = error instanceof Error ? error.message : String(error);
	}
}

/**
 * The bridge between own devices (issue #142): this device may use a desktop's
 * bridge when its own cannot be reached, and a desktop that switched "Bridge
 * für eigene Geräte freigeben" on serves its own to the devices the books know.
 */
async function startBridgeForDevices() {
	if (!session?.online) return;
	const { startBridgeConsumer, startBridgeProvider, bridgeFetch, bridgeShareOn } = await import(
		'./sync/remote-bridge.js'
	);
	const { knownDevices } = await import('./sync/device-sync.js');
	const { setBridgeTransport } = await import('./bridge/client.js');
	const libp2p = session.libp2p;
	const settings = session.store.settings;
	const { remoteFetch } = await startBridgeConsumer({
		libp2p,
		label: deviceLabel(),
		// `connected` only once the device proved the passkey (device-gate.js).
		devices: () => (app.sync.state?.devices ?? []).filter((d) => d.connected).map((d) => d.peerId)
	});
	setBridgeTransport(
		bridgeFetch({ remote: () => remoteFetch, onRoute: (r) => (app.sync.bridgeRoute = r) })
	);
	app.sync.bridgeServed = false;
	if (!bridgeShareOn()) return;
	/** @type {{ url: string, token: string } | null} */
	let own = null;
	const readOwn = async () => {
		const saved = /** @type {any} */ (await getSetting(settings, 'bridge'));
		own = saved?.url && saved?.token ? { url: saved.url, token: saved.token } : null;
	};
	await readOwn();
	settings.onChange(() => {
		readOwn().catch(() => {});
	});
	await startBridgeProvider({
		libp2p,
		bridge: () => own,
		// A device the books know and that proved the passkey on this connection:
		// an id typed in by mistake is known, and still gets nothing.
		isOwnDevice: async (peerId) =>
			Boolean(session?.deviceGate?.isProved(peerId)) &&
			knownDevices(await settings.list()).some((d) => d.peerId === peerId)
	});
	app.sync.bridgeServed = true;
}

/** How this device calls itself in the list: the browser and system, as it says. */
function deviceLabel() {
	try {
		const ua = navigator.userAgent;
		const system = /iPhone|iPad/.test(ua)
			? 'iPhone/iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Mac OS X/.test(ua)
					? 'Mac'
					: /Windows/.test(ua)
						? 'Windows'
						: 'Linux';
		const browser = /Edg\//.test(ua)
			? 'Edge'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'Browser';
		return t('messages.sync.deviceLabel', { browser, system });
	} catch {
		return 'Browser';
	}
}

/**
 * "Gerät hinzufügen": the other device's id, as it shows it.
 *
 * @param {string} peerId
 */
export async function addSyncDevice(peerId) {
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	const id = peerId.trim();
	if (session?.mode !== 'both') return deviceSync.addDevice(id);
	// "Beides": a new device only over the own network – through the bridge's
	// relay here, and into the books once it proved the passkey on that path.
	const { lanRelayAddr } = await import('./sync/network-mode.js');
	const relay = session.relays.find((r) => r === lanRelayAddr());
	if (!relay) {
		throw new Error(t('messages.sync.bothNeedsLocal'));
	}
	const { multiaddr } = await import('@multiformats/multiaddr');
	await session.libp2p.dial(multiaddr(`${relay}/p2p-circuit/p2p/${id}`), {
		signal: AbortSignal.timeout(15_000)
	});
	await addWhenProved(id);
}

/** "Entfernen" in Integrationen → Eigene Geräte. @param {string} peerId */
export async function removeSyncDevice(peerId) {
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	await deviceSync.removeDevice(peerId);
}

/** @param {any} credential */
async function unlockWith(credential) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential);
	app.network.syncCapable = Boolean(session.online);
	app.network.reloadNeeded = false;
	app.network.mode = session.mode;
	app.network.modeWanted = session.mode;
	lanRelayAskedWith = '';
	app.did = session.did;
	for (const name of /** @type {const} */ ([
		'transactions',
		'receipts',
		'partners',
		'accounts',
		'matches',
		'questions',
		'events',
		'settings'
	])) {
		session.store[name].onChange(scheduleRefresh);
	}
	session.store.settings.onChange(() => {
		applyStoredMode().catch(() => {});
	});
	await applyStoredMode();
	await refresh();
	installE2EHooks();
	// Not awaited: the books are open, whatever the relay does.
	startUcepIfPaired();
	startDeviceSyncIfOn().then(watchQrConnections);
	const { folderSupported } = await import('./receipts/folder.js');
	if (folderSupported() && !stopFolderWatch) {
		const { watchFolder } = await import('./receipts/folder-watch.js');
		stopFolderWatch = watchFolder(() => checkFolderNow());
	}
}

/**
 * @param {() => Promise<any>} getCredential
 * @param {string} nothingFound shown when the credential step finds nothing
 */
async function run(getCredential, nothingFound) {
	app.status = 'starting';
	app.error = null;
	try {
		const credential = await getCredential();
		if (!credential) throw new Error(nothingFound);
		await unlockWith(credential);
		app.status = 'ready';
	} catch (error) {
		console.error('unlock failed:', error);
		app.status = 'error';
		app.error = error instanceof Error ? error.message : String(error);
	}
}

/** @param {string} label shown in the passkey picker; identifies nothing */
export function createPasskey(label) {
	const name = label.trim() || 'Le Space Belege';
	return run(
		() => createPasskeyCredential({ userId: `belege-${crypto.randomUUID()}`, displayName: name }),
		t('messages.passkey.createFailed')
	);
}

export function restorePasskey() {
	return run(() => restorePasskeyCredential(), t('messages.passkey.notFound'));
}

export function unlockStoredPasskey() {
	return run(async () => loadStoredPasskeyCredential(), t('messages.passkey.notStored'));
}

/**
 * A dev/E2E-only hook: tests add records through the real store, the way the
 * bank import does.
 */
function installE2EHooks() {
	if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === 'true')) return;
	/** @param {Uint8Array} bytes */
	const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	/** @type {any} */ (window).__belegeE2E = {
		did: () => app.did,
		identityHash: () => session?.identityHash,
		peerId: () => session?.peerId,
		// Hex, so the test can look for them on disk. Present only in E2E
		// builds: node.js leaves `secretsForE2E` out of every other build.
		secrets: () => {
			const secrets = session?.secretsForE2E;
			if (!secrets) return null;
			return {
				signingKey: hex(secrets.signingKey),
				databaseKey: hex(secrets.databaseKey),
				blobKey: hex(secrets.blobKey),
				peerKey: hex(secrets.peerKey)
			};
		},
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx),
		// The matching over what a test put in (questions, own transfers).
		runMatching: () => runMatchingNow(),
		// A bank account as an import creates it (bank/import.js), for the export spec.
		addAccount: (/** @type {Record<string, any>} */ account) =>
			session?.store.accounts.put(account),
		accounts: () => session?.store.accounts.list(),
		// For the benchmark (app/bench/): made-up books written through the real
		// store, and the app's own read, refresh and matching paths timed in the page.
		bench: {
			/** @param {string} name @param {Record<string, any>[]} records */
			async putMany(name, records) {
				const collection = /** @type {any} */ (session?.store)?.[name];
				const ids = [];
				for (const r of records) ids.push((await collection.put(r)).id);
				return ids;
			},
			/** @param {string} name @param {string} id */
			async get(name, id) {
				return /** @type {any} */ (session?.store)?.[name].get(id);
			},
			/** @param {string} name */
			async count(name) {
				return ((await /** @type {any} */ (session?.store)?.[name].list()) ?? []).length;
			},
			refresh: () => refresh(),
			match: () => runMatchingNow('manual'),
			estimate: () => navigator.storage.estimate()
		}
	};
}

// The books' own devices (#844, B9): a device met by QR, device sync with its
// log and the receipt files it brings, and the list of devices. Moved out of
// session.svelte.js unchanged; device sync and the file prefetch are this
// module's state.
import { networkPause } from '$lib/network-pause.js';
import { loadBridgeAuth, startBridgeForDevices } from '$lib/bridge-connection/local.js';
import { runMatchingNow } from './refresh.js';
import { t } from '$lib/i18n/index.js';

/**
 * @typedef {object} SessionContext what this module reads from the session, anew at each use
 * @property {import('$lib/node.js').Session | null} session the open books, or null
 * @property {typeof import('$lib/session.svelte.js').app} app
 */

/** @type {SessionContext} */
let ctx;

/** @param {SessionContext} context */
export function bindSession(context) {
	ctx = context;
}

/** Device sync, while it runs. */
export const currentDeviceSync = () => deviceSync;
/** The receipt files' prefetch, while it runs. */
export const currentFilePrefetch = () => filePrefetch;

// "Ohne Relay, per QR" (sync/qr-link.js, #148). The device that shows the
// invite reads the answer back and is connected; the one that answered learns
// of the connection from the session. Either way the other device is added to
// the books only once it proved the passkey on that connection (device-gate.js).

/** How long a device connected by QR has to prove the passkey. */
const QR_PROOF_MS = 30_000;

/**
 * What a device added from the Geräte card may use at the bridge (#579): the
 * boxes ticked there; null: every scope, as before. Kept in the device's
 * record, and the bridge gives it to a device new to it.
 *
 * @type {string[] | null}
 */
let newDeviceBridgeScopes = null;

/** @param {string[] | null} scopes */
export function setNewDeviceBridgeScopes(scopes) {
	newDeviceBridgeScopes = scopes ? [...scopes] : null;
}

/**
 * A device added from the Geräte card, with what it may use at the bridge.
 *
 * @param {string} peerId
 * @param {string[] | null} scopes as ticked when the add began
 */
const addOwnDevice = (peerId, scopes) =>
	/** @type {NonNullable<typeof deviceSync>} */ (deviceSync).addDevice(peerId, '', {
		bridgeScopes: scopes
	});

/**
 * @param {string} peerId
 * @param {string[] | null} [scopes] what it may use at the bridge, as ticked when the add began:
 *   the proof may take a while, and the card may change or close meanwhile
 */
async function addWhenProved(peerId, scopes = newDeviceBridgeScopes) {
	const gate = ctx.session?.deviceGate;
	if (!gate) throw new Error(t('messages.sync.off'));
	const until = Date.now() + QR_PROOF_MS;
	// The first proof may run before the other side's muxer is ready: again, until it holds.
	while (!gate.isProved(peerId)) {
		if (Date.now() > until) {
			const { qrSession } = await import('../sync/qr-link.js');
			qrSession()?.forget(peerId);
			throw new Error(t('messages.sync.notProved'));
		}
		await gate.proveTo(peerId);
		if (!gate.isProved(peerId)) await new Promise((r) => setTimeout(r, 1000));
	}
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	await addOwnDevice(peerId, scopes);
}

/** Watch the QR session for the connections this device answered. */
export async function watchQrConnections() {
	if (!ctx.session?.online || (ctx.session.mode !== 'qr' && ctx.session.mode !== 'both')) return;
	const { qrSession } = await import('../sync/qr-link.js');
	qrSession()?.addEventListener('connect', (/** @type {any} */ e) => {
		if (e.detail?.direction !== 'inbound') return;
		ctx.app.sync.error = null;
		addWhenProved(String(e.detail.peerId)).catch((error) => {
			ctx.app.sync.error = error instanceof Error ? error.message : String(error);
		});
	});
}

/** "Einladung zeigen": a signed invite for the other device to scan. */
export async function qrInvite() {
	const { qrSession } = await import('../sync/qr-link.js');
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
	const { qrSession, payloadKind, payloadPeer, qrPeers } = await import('../sync/qr-link.js');
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

/** @type {Awaited<ReturnType<typeof import('../sync/device-sync.js').startDeviceSync>> | null} */
let deviceSync = null;

/** @type {ReturnType<typeof import('../sync/sync-log.js').createSyncLog> | null} */
let syncLog = null;

/**
 * The sync log and the data light (sync/sync-log.js): every entry a
 * collection takes, as written here or come by sync. Written here counts
 * only while device sync is on – then it goes to the others; what came is
 * attributed to the device its database last exchanged heads with (OrbitDB's
 * `join`), else to the one own device connected.
 */
export async function watchSync() {
	if (!ctx.session) return;
	const { createSyncLog, describeEntry } = await import('../sync/sync-log.js');
	const { callsForRun, debounced } = await import('../matching/catch-up.js');
	const catchUpSoon = debounced(() => runMatchingNow());
	syncLog = createSyncLog(ctx.session.syncLogSealer);
	ctx.app.sync.log = await syncLog.load();
	ctx.app.sync.lastIn = {};
	for (const line of [...ctx.app.sync.log].reverse()) {
		if (line.direction === 'in' && line.peerId) ctx.app.sync.lastIn[line.peerId] = line.at;
	}
	/** @type {Record<string, { peer: string, at: number }>} the last heads exchange, by collection */
	const lastJoin = {};
	const databases = ctx.session.store.databases();
	const own = ctx.session.store;
	for (const [name, db] of Object.entries(databases)) {
		db.events?.on?.('join', (/** @type {unknown} */ peer) => {
			lastJoin[name] = { peer: String(peer), at: Date.now() };
		});
		const collection = /** @type {any} */ (own)[name];
		collection?.onEntry?.((/** @type {any} */ entry) => {
			// After the write that made it has returned: only then is its hash known as ours.
			setTimeout(() => {
				const here = collection.wroteHere(entry.hash);
				if (here && !ctx.app.sync.online) return;
				const at = Date.now();
				const connected = (ctx.app.sync.state?.devices ?? []).filter((d) => d.connected);
				const joined = lastJoin[name];
				const peerId = here
					? null
					: joined && at - joined.at < 120_000
						? joined.peer
						: connected.length === 1
							? connected[0].peerId
							: null;
				/** @type {import('../sync/sync-log.js').SyncLine} */
				const line = {
					at,
					direction: here ? 'out' : 'in',
					collection: name,
					peerId,
					...describeEntry(name, entry)
				};
				ctx.app.sync.data = line;
				if (!here && peerId) ctx.app.sync.lastIn = { ...ctx.app.sync.lastIn, [peerId]: at };
				// What came may pair with what is here: one run once the burst is over (#473).
				if (callsForRun(line)) catchUpSoon();
				ctx.app.sync.log = /** @type {ReturnType<typeof createSyncLog>} */ (syncLog).add(line);
			}, 50);
		});
	}
}

/** "Protokoll leeren": the sync log of this browser. */
export async function clearSyncLog() {
	await syncLog?.clear();
	ctx.app.sync.log = [];
}

/** Device sync (#123): only when this device switched it on, so the node is online. */
export async function startDeviceSyncIfOn() {
	ctx.app.sync.online = Boolean(ctx.session?.online);
	if (!ctx.session?.online || deviceSync) return;
	try {
		const { startDeviceSync, deviceSyncSince, setDeviceSync, deviceSyncOn } = await import(
			'../sync/device-sync.js'
		);
		// Before anyone is dialled: the books' bridge proves with its own key (#575).
		await loadBridgeAuth().catch(() => {});
		deviceSync = await startDeviceSync({
			libp2p: ctx.session.libp2p,
			store: ctx.session.store,
			relays: ctx.session.relays,
			label: deviceLabel(),
			since: deviceSyncSince(),
			onState: (state) => {
				const before = ownDevicesConnected();
				const directBefore = ownDevicesConnected({ direct: true });
				ctx.app.sync.state = state;
				// An own device came, or is reached directly now – where the books'
				// Bitswap runs: what did not come before may come now.
				if (ownDevicesConnected() > before || ownDevicesConnected({ direct: true }) > directBefore)
					filePrefetch?.retryAll();
			},
			onPulse: (pulse) => {
				ctx.app.sync.pulse = pulse;
			},
			gate: ctx.session.deviceGate ?? undefined,
			onRemoved: () => {
				setDeviceSync(false);
				ctx.app.sync.removed = true;
				ctx.app.sync.state = null;
			}
		});
		startFilePrefetch(deviceSyncOn);
		await startBridgeForDevices();
	} catch (error) {
		ctx.app.sync.error = error instanceof Error ? error.message : String(error);
	}
}

/**
 * Own devices connected now – the books' bridge is none: it holds no books.
 * With `direct`, only those reached without a relay.
 *
 * @param {{ direct?: boolean }} [options]
 */
export function ownDevicesConnected({ direct = false } = {}) {
	return (ctx.app.sync.state?.devices ?? []).filter(
		(d) => d.connected && !d.bridge && (!direct || d.direct)
	).length;
}

/** @type {ReturnType<typeof import('../receipts/prefetch.js').createFilePrefetcher> | null} */
let filePrefetch = null;

/**
 * Receipt files to this device in the background (receipts/prefetch.js):
 * what the receipts name and this device lacks, from the own devices
 * connected – at once for what came while it was locked, then whenever a
 * receipt comes by sync or an own device connects. Never while paused.
 *
 * @param {() => boolean} deviceSyncOn
 */
async function startFilePrefetch(deviceSyncOn) {
	if (!ctx.session?.online || filePrefetch) return;
	const { createFilePrefetcher } = await import('../receipts/prefetch.js');
	const open = ctx.session;
	filePrefetch = createFilePrefetcher({
		blobs: open.blobs,
		receipts: () => open.store.receipts.list(),
		canFetch: () => !networkPause() && deviceSyncOn() && ownDevicesConnected() > 0,
		onState: (state) => {
			ctx.app.files = state;
		}
	});
	open.store.receipts.onChange(() => filePrefetch?.kick());
	filePrefetch.run().catch(() => {});
}

export function stopFilePrefetch() {
	filePrefetch?.stop();
	filePrefetch = null;
}

/** How this device calls itself in the list: the browser and system, as it says. */
export function deviceLabel() {
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
	const scopes = newDeviceBridgeScopes;
	if (ctx.session?.mode !== 'both') return addOwnDevice(id, scopes);
	// "Beides": a new device only over the own network – through the bridge's
	// relay here, and into the books once it proved the passkey on that path.
	const { lanRelayAddr } = await import('../sync/network-mode.js');
	const relay = ctx.session.relays.find((r) => r === lanRelayAddr());
	if (!relay) {
		throw new Error(t('messages.sync.bothNeedsLocal'));
	}
	const { multiaddr } = await import('@multiformats/multiaddr');
	await ctx.session.libp2p.dial(multiaddr(`${relay}/p2p-circuit/p2p/${id}`), {
		signal: AbortSignal.timeout(15_000)
	});
	await addWhenProved(id, scopes);
}

/**
 * A device that proved the books' key but is not on their list (first-contact.js):
 * let in by the person – it goes on the list and is dialled – or turned away.
 *
 * @param {string} peerId
 * @param {boolean} letIn
 */
export async function answerAskingDevice(peerId, letIn) {
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	const { asking } = await import('../sync/device-sync.js');
	asking.delete(peerId);
	if (letIn) await addOwnDevice(peerId, newDeviceBridgeScopes);
	else deviceSync.refresh();
}

/** "Entfernen" in Integrationen → Eigene Geräte. @param {string} peerId */
export async function removeSyncDevice(peerId) {
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	await deviceSync.removeDevice(peerId);
}

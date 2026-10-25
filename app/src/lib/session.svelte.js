// App-wide state: who is signed in, and the records the pages show.
import { networkPause } from './network-pause.js';
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting } from './store/settings.js';
import { passkeyStepsFor } from './passkey-steps.svelte.js';
import { sharedOrigin } from './shared-origin.js';
import { redactionFromStatus } from './llm-redaction.js';
import { classifyTransaction, cleanMatchingSettings } from './matching/classify.js';
import { buildMatchingContext } from './matching/context.js';
import { cleanChart } from './booking/chart.js';
import { t } from './i18n/index.js';
import { requestPersistence } from './storage/safety.js';

/** @typedef {import('./node.js').Session} Session */
/** @typedef {import('./store/repository.js').StoredRecord} StoredRecord */

export const app = $state({
	/** @type {'locked' | 'starting' | 'ready' | 'error'} */
	status: 'locked',
	/** @type {string | null} */
	error: null,
	/**
	 * Where an unlock is, while `status` is 'starting' after the passkey answered
	 * (unlock-progress.js): the step, a collection, a move's count, its start.
	 * @type {(import('./unlock-progress.js').Status & { since: number }) | null}
	 */
	unlock: null,
	/** @type {string | null} */
	did: null,
	/**
	 * Whether the browser keeps this site's storage for good (storage/safety.js),
	 * asked on every unlock; null: not asked yet, or it cannot say.
	 * @type {boolean | null}
	 */
	persisted: null,
	/**
	 * Whether the paired bridge blacks out what goes to its language model
	 * (#423): false for a model on its own computer, which gets the text as it
	 * is. null: not known (no bridge, no model, not asked yet) – the hints then
	 * say "geschwärzt", as for a provider on the internet (ai-text.js); 'enclave':
	 * unredacted into an attested enclave (#416).
	 * @type {boolean | 'enclave' | null}
	 */
	llmRedaction: null,
	/**
	 * The books' passkeys (#406): one slot each in the vault, this browser's
	 * name for it, and whether it is the one that unlocked. `indexOn`: the
	 * vault is published on Aleph for empty devices (backup/vault-index.js).
	 * `words`: the recovery words' slot, when there is one (stage 2).
	 * @type {{ slots: { kid: string, label: string, addedAt: string, mine: boolean }[], indexOn: boolean, words: { addedAt: string } | null }}
	 */
	vault: { slots: [], indexOn: false, words: null },
	/** Books just made: recovery words are offered once (keys/WordsOffer.svelte). */
	offerWords: false,
	/** Device sync (#123): off, or this device's id and the devices it knows. */
	sync: {
		online: false,
		/** @type {import('./sync/device-sync.js').SyncState | null} */
		state: null,
		/** @type {import('./sync/device-sync.js').SyncPulse | null} the last ping an own device answered */
		pulse: null,
		/** @type {import('./sync/sync-log.js').SyncLine | null} the last entry that came or went (sync/sync-log.js) */
		data: null,
		/** @type {import('./sync/sync-log.js').SyncLine[]} the sync log, newest first */
		log: [],
		/** @type {Record<string, number>} when each own device last sent something, by peer id */
		lastIn: {},
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
	/** @type {StoredRecord[]} travellers, trips and statements (travel/records.js, #213) */
	travel: [],
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
		lanRelay: null,
		/** @type {string | null} a QR invite that came by link, waiting for the books to open (sync/qr-link-url.js) */
		qrInvite: null
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
 * "Eigene Geräte" on or off, in the menu and in the consent screen alike
 * (#327). Off: now, and at the next unlock. On: at once when this session's
 * node went online at unlock, else from the next unlock (`reloadNeeded`).
 * Before an unlock only the choice is kept: the unlock applies it.
 *
 * @param {boolean} on
 */
export async function setDevicesNetwork(on) {
	const { setDeviceSync } = await import('./sync/device-sync.js');
	setDeviceSync(on);
	if (!session) return;
	const closed = await applySyncGate();
	if (!on) {
		hangUpSync();
		app.sync.online = false;
		app.network.reloadNeeded = false;
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

/**
 * Everything this browser keeps, as one sealed backup (backup/archive.js, #77).
 *
 * @param {{ appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
 */
export async function makeBackup(meta) {
	if (!session) throw new Error('The books are not open.');
	return session.makeBackup(meta);
}

/**
 * What is new since the chain's last backup, sealed (backup/archive.js, #454);
 * null when nothing is.
 *
 * @param {{ chain: import('./backup/archive.js').BackupChain, appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
 */
export async function makeIncrement(meta) {
	if (!session) throw new Error('The books are not open.');
	return session.makeIncrement(meta);
}

/**
 * Whether a chain of backups goes on in these databases: an increment names
 * the databases its chain began in, and books that moved to their own
 * identity (#496) are in others – their next backup is a full one.
 *
 * @param {import('./backup/archive.js').BackupChain | null | undefined} chain
 */
export function chainFitsBooks(chain) {
	if (!session || !chain) return false;
	return Object.values(session.store.databases()).every((db) =>
		Object.hasOwn(chain.heads, String(db.address))
	);
}

/**
 * The collections that changed since the chain's last backup: their heads
 * are not the ones it shipped. Settings do not count – every backup writes
 * them (its history, the chain), as in `buildIncrement`. Comparing heads
 * walks nothing, so it is cheap enough to ask after every write.
 *
 * @param {import('./backup/archive.js').BackupChain} chain
 * @returns {Promise<string[]>}
 */
export async function unsavedCollections(chain) {
	if (!session) return [];
	/** @type {string[]} */
	const changed = [];
	for (const [name, db] of Object.entries(session.store.databases())) {
		if (name === 'settings') continue;
		/** @type {string[]} */
		const now = (await /** @type {any} */ (db).log.heads()).map((/** @type {any} */ h) =>
			String(h.hash)
		);
		const shipped = chain.heads[String(db.address)] ?? [];
		if (now.length !== shipped.length || now.some((h) => !shipped.includes(h))) changed.push(name);
	}
	return changed;
}

/**
 * Put a sealed backup back into these books (backup/archive.js, #77), with its
 * increments (#454). The books are closed for it: reload the page afterwards.
 *
 * @param {Uint8Array} sealed
 * @param {(p: import('./backup/archive.js').RestoreProgress) => void} [onProgress]
 * @param {{ increments?: Uint8Array[], base?: string, fetchBytes?: (cid: string) => Promise<Uint8Array> }} [chain] its increments (#454), and where a
 *   head the backup does not carry may still be found
 */
export async function restoreBackup(sealed, onProgress, chain) {
	if (!session) throw new Error('The books are not open.');
	return session.restoreBackup(sealed, onProgress, chain);
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
		travel,
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
		session.store.travel.list(),
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
	app.travel = travel;
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
			const result = await runMatching({
				store: session.store,
				trigger,
				onProgress: (p) => (app.matchingProgress = p)
			});
			// New network fees take the account the person set for all of them (#305).
			const { applyFeeRule } = await import('./booking/fee-rule.js');
			await applyFeeRule(/** @type {any} */ (session.store));
			return result;
		} catch (error) {
			console.error('matching failed:', error);
			return null;
		} finally {
			app.matching = false;
			app.matchingProgress = null;
			await refresh();
			// Links the run made may be to an invoice in another currency.
			fillExchangeRates();
			// The books as this run left them, for the catch-up after the next unlock (#473).
			if (app.did) {
				const { fingerprint, noteRun } = await import('./matching/catch-up.js');
				noteRun(globalThis.localStorage, app.did, fingerprint(app));
			}
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

/** @type {Promise<number>} */
let fxQueue = Promise.resolve(0);

/**
 * The ECB rate of the day for payments linked to an invoice in another
 * currency, where none is kept yet (matching/fx.js): so instalments in euros
 * – a bank transfer, a Monero payment valued in euros – count in the
 * invoice's currency. And for euro bookings that, at it, come near an open
 * receipt in another currency (#474), with matching run again for them.
 * Through the bridge; without one, nothing happens.
 * One run at a time; the books are read again when a rate came.
 *
 * @returns {Promise<number>} bookings that got a rate
 */
export function fillExchangeRates() {
	const next = fxQueue
		.then(async () => {
			if (!session) return 0;
			const { fxGaps, fxCandidateGaps, fillFx } = await import('./matching/fx.js');
			const books = {
				receipts: app.receipts,
				matches: app.matches,
				transactions: app.transactions
			};
			const linked = fxGaps(books);
			const candidates = fxCandidateGaps(books);
			if (!linked.length && !candidates.length) return 0;
			const client = await pairedClient();
			if (!client || !session) return 0;
			const filled = await fillFx({
				client,
				transactions: session.store.transactions,
				gaps: [...linked, ...candidates]
			});
			if (!filled) return 0;
			await refresh();
			// A booking that now comes near an open receipt in another currency
			// may be its payment (#474): matching counts it on the next run.
			const kept = (/** @type {any} */ g) =>
				app.transactions.some((t) => t.id === g.tx.id && t.fx?.[g.currency]?.rate);
			if (candidates.some(kept)) runMatchingNow();
			return filled;
		})
		.catch((error) => {
			console.error('exchange rates:', error);
			return 0;
		});
	fxQueue = next;
	return next;
}

/**
 * Ask the paired bridge whether it blacks out what goes to its model; never
 * throws, an unknown answer leaves null.
 */
export async function refreshLlmRedaction() {
	try {
		const client = await pairedClient();
		if (!client) return;
		app.llmRedaction = redactionFromStatus(await client.llmStatus());
	} catch {
		// Offline or an older bridge: the cautious wording stays.
	}
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
 * imported, read while "gleich auslesen" is on and a bridge is paired, and matched.
 *
 * @param {{ prompt?: boolean }} [options] `prompt` only from a click: asks for read permission
 * @returns {Promise<{ configured: boolean, permitted: boolean, created: number, counts: any, read?: number, waiting?: number, images?: number } | null>}
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
	/** @type {{ read: number, waiting: number, images: number }} */
	let reading = { read: 0, waiting: 0, images: 0 };
	if (r.created.length) {
		// Read with the model only while "gleich auslesen" is on, as an upload is (#475).
		const { getSetting } = await import('./store/settings.js');
		const readAfter = (await getSetting(store.settings, 'uploadRead'))?.readAfter !== false;
		const client = readAfter ? await pairedClient() : null;
		const { readNewFiles } = await import('./receipts/folder-watch.js');
		const { extractReceipt } = await import('./receipts/extract.js');
		const { needsConfirmation } = await import('./receipts/import.js');
		/** @type {any} only called when there is one (`canRead`) */
		const reader = client;
		reading = await readNewFiles({
			created: r.created,
			readAfter,
			canRead: Boolean(client),
			needsConfirmation,
			read: (record) =>
				extractReceipt({
					client: reader,
					receipts: store.receipts,
					blobs,
					record,
					events: store.events
				})
		});
		await refresh();
		await runMatchingNow();
	}
	return {
		configured: true,
		permitted: r.permitted,
		created: r.created.length,
		counts: r.counts,
		...reading
	};
}

/** @type {(() => void) | null} */
let stopFolderWatch = null;

/** @type {Awaited<ReturnType<typeof import('./sync/device-sync.js').startDeviceSync>> | null} */
let deviceSync = null;

/** @type {ReturnType<typeof import('./sync/sync-log.js').createSyncLog> | null} */
let syncLog = null;

/**
 * The sync log and the data light (sync/sync-log.js): every entry a
 * collection takes, as written here or come by sync. Written here counts
 * only while device sync is on – then it goes to the others; what came is
 * attributed to the device its database last exchanged heads with (OrbitDB's
 * `join`), else to the one own device connected.
 */
async function watchSync() {
	if (!session) return;
	const { createSyncLog, describeEntry } = await import('./sync/sync-log.js');
	const { callsForRun, debounced } = await import('./matching/catch-up.js');
	const catchUpSoon = debounced(() => runMatchingNow());
	syncLog = createSyncLog(session.syncLogSealer);
	app.sync.log = await syncLog.load();
	app.sync.lastIn = {};
	for (const line of [...app.sync.log].reverse()) {
		if (line.direction === 'in' && line.peerId) app.sync.lastIn[line.peerId] = line.at;
	}
	/** @type {Record<string, { peer: string, at: number }>} the last heads exchange, by collection */
	const lastJoin = {};
	const databases = session.store.databases();
	const own = session.store;
	for (const [name, db] of Object.entries(databases)) {
		db.events?.on?.('join', (/** @type {unknown} */ peer) => {
			lastJoin[name] = { peer: String(peer), at: Date.now() };
		});
		const collection = /** @type {any} */ (own)[name];
		collection?.onEntry?.((/** @type {any} */ entry) => {
			// After the write that made it has returned: only then is its hash known as ours.
			setTimeout(() => {
				const here = collection.wroteHere(entry.hash);
				if (here && !app.sync.online) return;
				const at = Date.now();
				const connected = (app.sync.state?.devices ?? []).filter((d) => d.connected);
				const joined = lastJoin[name];
				const peerId = here
					? null
					: joined && at - joined.at < 120_000
						? joined.peer
						: connected.length === 1
							? connected[0].peerId
							: null;
				/** @type {import('./sync/sync-log.js').SyncLine} */
				const line = {
					at,
					direction: here ? 'out' : 'in',
					collection: name,
					peerId,
					...describeEntry(name, entry)
				};
				app.sync.data = line;
				if (!here && peerId) app.sync.lastIn = { ...app.sync.lastIn, [peerId]: at };
				// What came may pair with what is here: one run once the burst is over (#473).
				if (callsForRun(line)) catchUpSoon();
				app.sync.log = /** @type {ReturnType<typeof createSyncLog>} */ (syncLog).add(line);
			}, 50);
		});
	}
}

/** "Protokoll leeren": the sync log of this browser. */
export async function clearSyncLog() {
	await syncLog?.clear();
	app.sync.log = [];
}

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
			onPulse: (pulse) => {
				app.sync.pulse = pulse;
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

/**
 * @typedef {{ opened: import('./books-vault.js').OpenedVault, owner: string, label: string }} Recovered
 *   the vault the recovery words opened, for a new passkey (#406, stage 2)
 */

/**
 * @param {any} credential
 * @param {ReturnType<typeof import('./unlock-progress.js').createUnlockProgress>} [progress]
 * @param {(purpose: 'prf') => Promise<void>} [beforePrompt] what the next touch is for (#429)
 * @param {{ lookupVault?: boolean, recovered?: Recovered }} [options] `lookupVault`: an empty
 *   device – ask Aleph's index for the vault (#406); `recovered`: opened with recovery words
 */
async function unlockWith(
	credential,
	progress,
	beforePrompt,
	{ lookupVault = false, recovered } = {}
) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential, {
		onStatus: (s) => progress?.status(s),
		beforePrompt,
		lookupVault,
		...(recovered ? { recovered } : {})
	});
	await showVault();
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
		'settings',
		'travel'
	])) {
		session.store[name].onChange(scheduleRefresh);
	}
	session.store.settings.onChange(() => {
		applyStoredMode().catch(() => {});
	});
	await watchSync();
	await applyStoredMode();
	progress?.status({ step: 'books' });
	await refresh();
	installE2EHooks();
	// Changed elsewhere while this device was locked: one run, in the background (#473).
	{
		const { fingerprint, lastRunOf } = await import('./matching/catch-up.js');
		if (app.did && lastRunOf(globalThis.localStorage, app.did) !== fingerprint(app)) {
			runMatchingNow();
		}
	}
	// Not awaited: the browser's answer, for Home's warning (storage/safety.js).
	requestPersistence().then((kept) => (app.persisted = kept));
	// Not awaited: rates for instalments of invoices in another currency.
	fillExchangeRates();
	// Not awaited: whether the AI hints may say "geschwärzt" (ai-text.js).
	refreshLlmRedaction();
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
 * @param {'create' | 'restore' | 'unlock'} flow which prompts follow, and what is said before each (#429)
 * @param {{ recovered?: () => Recovered | undefined }} [options]
 *   the vault the recovery words opened, once `getCredential` has opened it
 */
async function run(getCredential, nothingFound, flow, { recovered } = {}) {
	// Never on an origin other CIDs share (shared-origin.js); the screen offers no button there.
	if (sharedOrigin()) return;
	app.status = 'starting';
	app.error = null;
	/** @type {ReturnType<typeof import('./unlock-progress.js').createUnlockProgress> | null} */
	let progress = null;
	try {
		const credential = await getCredential();
		if (!credential) throw new Error(nothingFound);
		// After the passkey answered: from here on the books open, and that is shown.
		const { createUnlockProgress } = await import('./unlock-progress.js');
		progress = createUnlockProgress({ onChange: (s) => (app.unlock = s) });
		// A restore is an empty device: its passkey's vault may be on Aleph (#406),
		// asked unless the network is paused.
		const opened = recovered?.();
		await unlockWith(credential, progress, passkeyStepsFor(flow), {
			lookupVault: flow === 'restore' && !networkPause(),
			...(opened ? { recovered: opened } : {})
		});
		progress.finish('ready');
		app.unlock = null;
		app.offerWords = flow === 'create' && !opened;
		app.status = 'ready';
	} catch (error) {
		progress?.finish('failed');
		app.unlock = null;
		console.error('unlock failed:', error);
		app.status = 'error';
		app.error = error instanceof Error ? error.message : String(error);
	}
}

/** The setting that says the vault is published on Aleph (#406). */
const VAULT_INDEX_SETTING = 'vault/index';

/** What the keys page shows of the open vault. */
async function showVault() {
	if (!session) return;
	const { record, kid } = session.vault;
	const { wordsSlotId } = await import('./books-vault.js');
	const wordsKid = await wordsSlotId();
	// Every slot in the vault, named where this browser knows the name.
	const known = new Map(record.slots.map((s) => [s.kid, s]));
	const words = record.vault.slots.some((/** @type {{ kid: string }} */ v) => v.kid === wordsKid);
	app.vault = {
		slots: record.vault.slots
			.filter((/** @type {{ kid: string }} */ v) => v.kid !== wordsKid)
			.map((/** @type {{ kid: string }} */ v) => ({
				kid: v.kid,
				label: known.get(v.kid)?.label ?? '',
				addedAt: known.get(v.kid)?.addedAt ?? '',
				mine: v.kid === kid
			})),
		indexOn: (await getSetting(session.store.settings, VAULT_INDEX_SETTING)) === true,
		words: words ? { addedAt: known.get(wordsKid)?.addedAt ?? '' } : null
	};
}

/**
 * Publish the vault on Aleph (#406): index M with the pointer to the paying
 * account, and index P of this passkey and of `extraKeys`. Never while the
 * network is paused. Switches publishing on for later backups.
 *
 * @param {Uint8Array[]} [extraKeys] index keys of passkeys just added
 */
export async function publishBooksVault(extraKeys = []) {
	if (!session) throw new Error('The books are not open.');
	if (networkPause()) throw new Error(t('settings.keys.paused'));
	const [{ publishVault }, { loadOwner }, { setSetting }] = await Promise.all([
		import('./backup/vault-index.js'),
		import('./backup/keeper.js'),
		import('./store/settings.js')
	]);
	await publishVault({
		root: session.vault.root,
		record: session.vault.record,
		passkeyKeys: [session.ownIndexKey, ...extraKeys],
		owner: await loadOwner(session.store.settings)
	});
	await setSetting(session.store.settings, VAULT_INDEX_SETTING, true);
	await showVault();
}

/**
 * Give the books one more passkey (#406): it is made now, answers once, and
 * gets its own slot in the vault. This browser goes on unlocking with its own.
 *
 * @param {string} label
 * @param {{ publish?: boolean }} [options] publish the vault on Aleph as well
 */
export async function addBooksPasskey(label, { publish = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const name = label.trim() || 'Le Space Belege';
	const [{ createAdditionalPasskey, readPrfOutput }, { addPasskey }, { passkeyIndexKey }] =
		await Promise.all([
			import('./passkey-identity.js'),
			import('./books-vault.js'),
			import('./backup/vault-index.js')
		]);
	const credential = await createAdditionalPasskey({ displayName: name });
	const prfOutput = await readPrfOutput(credential);
	session.vault = await addPasskey(
		session.vault,
		{
			prfOutput,
			rawCredentialId: credential.rawCredentialId,
			credentialId: String(credential.credentialId ?? ''),
			label: name
		},
		globalThis.localStorage
	);
	const key = await passkeyIndexKey(prfOutput);
	prfOutput.fill(0);
	await showVault();
	if (publish || app.vault.indexOn) await publishBooksVault([key]);
}

/**
 * Take a passkey's slot out (#406). With `renew`, the vault gets a new key and
 * a slot for every passkey that stays – each answers once, this one too – for
 * a passkey that may be in other hands.
 *
 * @param {string} kid
 * @param {{ renew?: boolean }} [options]
 */
export async function removeBooksPasskey(kid, { renew = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const vaultModule = await import('./books-vault.js');
	if (!renew) {
		session.vault = vaultModule.removePasskey(session.vault, kid, globalThis.localStorage);
	} else {
		const { readPrfOutput } = await import('./passkey-identity.js');
		const { WebAuthnDIDProvider } = await import(
			'@le-space/orbitdb-identity-provider-webauthn-did'
		);
		/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} */
		const answers = [];
		const wordsKid = await vaultModule.wordsSlotId();
		// The recovery words cannot answer here: a renewed vault has none, and says so.
		for (const slot of session.vault.record.slots.filter(
			(s) => s.kid !== kid && s.kid !== wordsKid
		)) {
			const rawCredentialId = new Uint8Array(
				WebAuthnDIDProvider.base64urlToArrayBuffer(slot.credentialId)
			);
			const prfOutput = await readPrfOutput({ credentialId: slot.credentialId, rawCredentialId });
			answers.push({ prfOutput, rawCredentialId });
		}
		session.vault = await vaultModule.renewBooksVault(
			session.vault,
			answers,
			[kid],
			globalThis.localStorage
		);
		for (const a of answers) a.prfOutput.fill(0);
	}
	await showVault();
	if (app.vault.indexOn && !networkPause()) await publishBooksVault();
}

/**
 * Give the books recovery words (#406, stage 2), once the person has written
 * them down and given three of them back: one more slot in the vault. Words
 * the books had are replaced. Published on Aleph (index W) when the vault is.
 *
 * @param {string[]} words from `newRecoveryWords`
 * @param {{ publish?: boolean }} [options]
 */
export async function addBooksRecoveryWords(words, { publish = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const [{ seedFromWords }, { addRecoveryWords }, { wordsIndexKey }] = await Promise.all([
		import('./recovery-words.js'),
		import('./books-vault.js'),
		import('./backup/vault-index.js')
	]);
	const seed = await seedFromWords(words);
	try {
		session.vault = await addRecoveryWords(session.vault, seed, globalThis.localStorage);
		const key = await wordsIndexKey(seed);
		await showVault();
		if ((publish || app.vault.indexOn) && !networkPause()) await publishBooksVault([key]);
	} finally {
		seed.fill(0);
	}
}

/** Take the recovery words out of the vault. */
export async function removeBooksRecoveryWords() {
	if (!session) throw new Error('The books are not open.');
	const { removeRecoveryWords } = await import('./books-vault.js');
	session.vault = await removeRecoveryWords(session.vault, globalThis.localStorage);
	await showVault();
	if (app.vault.indexOn && !networkPause()) await publishBooksVault();
}

/**
 * Open the books with recovery words, on a device without any of their
 * passkeys (#406, stage 2): the words open the vault – kept in this browser,
 * or found on Aleph through their index unless the network is paused – then
 * a new passkey is made, gets its slot, and opens the books as any other.
 * Two prompts, as when creating. Nothing is made when the words open nothing.
 *
 * @param {string} text the words as typed or pasted
 * @param {string} label the new passkey's name
 */
export function recoverWithWords(text, label) {
	const name = label.trim() || 'Le Space Belege';
	/** @type {Recovered | undefined} */
	let recovered;
	return run(
		async () => {
			const [words, vaultModule, indexes] = await Promise.all([
				import('./recovery-words.js'),
				import('./books-vault.js'),
				import('./backup/vault-index.js')
			]);
			const typed = words.normalizeWords(text);
			const check = await words.checkWords(typed);
			if (!check.ok) {
				throw new Error(
					check.unknown.length
						? t('onboarding.words.unknown', { positions: check.unknown.join(', ') })
						: check.count !== words.WORD_COUNT
							? t('onboarding.words.count', { count: check.count })
							: t('onboarding.words.checksum')
				);
			}
			const seed = await words.seedFromWords(typed);
			try {
				const lookup = !networkPause();
				let opened = await vaultModule
					.openWithWords({
						seed,
						storage: globalThis.localStorage,
						...(lookup ? { find: () => indexes.findVaultWithWords({ seed }) } : {})
					})
					.catch((/** @type {any} */ e) => {
						if (e?.code === 'VAULT_LOCKED') throw new Error(t('onboarding.words.wrong'));
						throw e;
					});
				if (!opened) {
					throw new Error(lookup ? t('onboarding.words.notFound') : t('onboarding.words.notHere'));
				}
				let owner = '';
				if (lookup) {
					const current = await indexes.readRootIndex({ root: opened.root }).catch(() => null);
					owner = current?.pointer?.owner ?? '';
					if (current?.vault) {
						opened = await vaultModule.newerWithWords(opened, current.vault, seed, current.slots);
					}
				}
				recovered = { opened, owner, label: name };
			} finally {
				seed.fill(0);
			}
			return createPasskeyCredential({ userId: name, displayName: name });
		},
		t('messages.passkey.createFailed'),
		'create',
		{ recovered: () => recovered }
	);
}

/** @param {string} label shown in the passkey picker; identifies nothing */
export function createPasskey(label) {
	const name = label.trim() || 'Le Space Belege';
	// The label in both: a security key's picker lists `user.name` (the
	// provider's `userId`), not the display name (#429). The provider makes
	// the user handle, which is what identifies the credential, at random.
	return run(
		() => createPasskeyCredential({ userId: name, displayName: name }),
		t('messages.passkey.createFailed'),
		'create'
	);
}

export function restorePasskey() {
	return run(() => restorePasskeyCredential(), t('messages.passkey.notFound'), 'restore');
}

export function unlockStoredPasskey() {
	return run(async () => loadStoredPasskeyCredential(), t('messages.passkey.notStored'), 'unlock');
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
				// Only books made as before #496 (an E2E switch) have a passkey signing key.
				...(secrets.signingKey ? { signingKey: hex(secrets.signingKey) } : {}),
				booksSecret: hex(secrets.booksSecret),
				databaseKey: hex(secrets.databaseKey),
				replicationKey: hex(secrets.replicationKey),
				blobKey: hex(secrets.blobKey),
				peerKey: hex(secrets.peerKey)
			};
		},
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx),
		// The books' own identity and where their databases are (#496).
		booksDid: () => session?.booksDid,
		addresses: () =>
			session
				? Object.fromEntries(
						Object.entries(session.store.databases()).map(([name, db]) => [
							name,
							String(db.address)
						])
					)
				: null,
		transactions: () => session?.store.transactions.list(),
		// A made-up receipt, as reading one would leave it (instalments spec, #258).
		addReceipt: (/** @type {Record<string, any>} */ r) => session?.store.receipts.put(r),
		// …and one with its file in the sealed blob store (the receipt preview, #273).
		addReceiptFile: async (/** @type {number[]} */ bytes, /** @type {Record<string, any>} */ r) => {
			const blobs = currentBlobs();
			if (!session || !blobs) return null;
			const fileCid = await blobs.put(new Uint8Array(bytes));
			return session.store.receipts.put({ ...r, fileCid });
		},
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
			estimate: () => navigator.storage.estimate(),
			// The sync node's network, for the resilience benchmark: its
			// connections as they are, and what happened since `watchNet()` —
			// connections opened and closed, peers gone, OrbitDB's heads
			// exchanges and sync errors — each with the time.
			connections: () => connectionsOf(session?.libp2p),
			// Whom gossipsub still counts as a peer: it keeps that list itself,
			// and it can forget a peer that libp2p is still connected to.
			pubsubPeers: () =>
				(session?.libp2p?.services?.pubsub?.getPeers?.() ?? []).map((/** @type {any} */ p) =>
					String(p)
				),
			watchNet: () => watchNet(session?.libp2p, session?.store?.databases?.()),
			netlog: () => netlog.slice()
		}
	};
}

/** @type {Array<Record<string, unknown>>} */
const netlog = [];
/** @type {WeakSet<object>} */
const watched = new WeakSet();

/** @param {any} c a libp2p connection */
const describeConnection = (c) => ({
	peer: String(c.remotePeer),
	addr: String(c.remoteAddr),
	// libp2p 3 marks a relayed connection with `limits`; `limited` is the
	// older flag the app's device-sync still reads. Both, to tell them apart.
	limited: c.limited ?? null,
	limits: c.limits ?? null,
	direction: c.direction,
	status: c.status,
	streams: (c.streams ?? []).map((/** @type {any} */ s) => s.protocol ?? '?')
});

/** @param {any} libp2p */
function connectionsOf(libp2p) {
	return (libp2p?.getConnections?.() ?? []).map(describeConnection);
}

/**
 * Start writing the node's network events into `netlog`, once per node and
 * per database. Reading `netlog()` leaves it in place.
 *
 * @param {any} libp2p
 * @param {Record<string, any> | undefined} databases the store's OrbitDB databases by name
 */
function watchNet(libp2p, databases) {
	const note = (/** @type {string} */ event, /** @type {Record<string, unknown>} */ detail) =>
		netlog.push({ t: Date.now(), event, ...detail });
	if (libp2p && !watched.has(libp2p)) {
		watched.add(libp2p);
		libp2p.addEventListener('connection:open', (/** @type {any} */ e) =>
			note('connection:open', describeConnection(e.detail))
		);
		libp2p.addEventListener('connection:close', (/** @type {any} */ e) =>
			note('connection:close', describeConnection(e.detail))
		);
		libp2p.addEventListener('peer:disconnect', (/** @type {any} */ e) =>
			note('peer:disconnect', { peer: String(e.detail) })
		);
	}
	for (const [name, db] of Object.entries(databases ?? {})) {
		if (!db?.events || watched.has(db)) continue;
		watched.add(db);
		db.events.on('join', (/** @type {unknown} */ peer, /** @type {unknown[]} */ heads) =>
			note('orbitdb:join', { db: name, peer: String(peer), heads: heads?.length ?? null })
		);
		db.events.on('leave', (/** @type {unknown} */ peer) =>
			note('orbitdb:leave', { db: name, peer: String(peer) })
		);
		db.events.on('error', (/** @type {any} */ error) =>
			note('orbitdb:error', { db: name, name: error?.name, message: error?.message })
		);
	}
	return netlog.length;
}

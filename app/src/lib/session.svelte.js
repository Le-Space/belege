// App-wide state: who is signed in, and the records the pages show.
import { networkPause } from './network-pause.js';
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting, setSetting } from './store/settings.js';
import { passkeyStepsFor } from './passkey-steps.svelte.js';
import { sharedOrigin } from './shared-origin.js';
import { redactionFromStatus } from './llm-redaction.js';
import { classifyTransaction, cleanMatchingSettings } from './matching/classify.js';
import { buildMatchingContext } from './matching/context.js';
import { cleanChart } from './booking/chart.js';
import { intlLocale, t } from './i18n/index.js';
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
	/**
	 * New keys for the books (#627): `left` – this passkey has no slot in the
	 * new vault, these are the old books; `done` – the books were taken over
	 * under the new keys; `taking` – that is going on now.
	 * @type {'' | 'left' | 'done' | 'taking'}
	 */
	rekey: '',
	/**
	 * How long the Aleph account's credits keep the backups (backup/credits-watch.js):
	 * days left at what the kept backups cost; null when it cannot be told.
	 * @type {{ days: number, credits: number } | null}
	 */
	backupCredits: null,
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
		 * How the bridge answered last: over the stream to its own node (#573),
		 * here over HTTP, or through an own device's (#142).
		 * @type {'stream' | 'local' | 'device'}
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
	/** @type {{ books: string, writer: string, role: 'bookkeeping' | 'reader' } | null} the books open are someone else's, as their member (#612), who writes as `writer` – or reads only (#641) */
	member: null,
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
	if (!session || readOnly()) return;
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
	// A token over HTTP, or the bridge's node over the stream (#575).
	const pairing = saved?.token ?? saved?.peerId ?? null;
	if (!pairing || pairing === lanRelayAskedWith) return;
	lanRelayAskedWith = pairing;
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
		// A member who only reads (#641) writes no matches: the owner's devices do.
		if (!session || readOnly()) return null;
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
			if (!session || readOnly()) return 0;
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
export async function pairedClient() {
	if (!session) return null;
	const saved = await getSetting(session.store.settings, 'bridge');
	const { createBridgeClient, pairedWith, setRedactTerms } = await import('./bridge/client.js');
	if (!pairedWith(saved)) return null;
	// The company's names are blacked out in whatever goes to the language model (#226).
	setRedactTerms(() => cleanMatchingSettings(app.matchingSettings).companyNames);
	return createBridgeClient({ url: saved.url, token: saved.token ?? null });
}

/**
 * "✦ Belege der Reise neu auslesen" (#693): receipts read before, once more,
 * on the app-wide queue (receipts/extract-queue.svelte.js), then matching.
 * Only on a click.
 *
 * @param {string[]} ids
 * @returns {Promise<'started' | 'noBridge' | 'busy'>}
 */
export async function extractAgain(ids) {
	if (!session) return 'noBridge';
	const client = await pairedClient();
	if (!client) return 'noBridge';
	const { extractAll } = await import('./receipts/extract-queue.svelte.js');
	const ctx = { client, store: currentStore, blobs: currentBlobs, refresh };
	if (!(await extractAll(ctx, ids, { again: true }))) return 'busy';
	await runMatchingNow();
	return 'started';
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
		// Before anyone is dialled: the books' bridge proves with its own key (#575).
		await loadBridgeAuth().catch(() => {});
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

/** @type {Awaited<ReturnType<typeof import('./sync/remote-bridge.js').startBridgeConsumer>> | null} */
let bridgeConsumer = null;

/**
 * The bridge over the stream (#573, #575): the bridge's own node, a device of
 * the books, first; the bridge between own devices (issue #142) after – this
 * device may use a desktop's bridge when its own cannot be reached, and a
 * desktop that switched "Bridge für eigene Geräte freigeben" on serves its own
 * to the devices the books know.
 */
async function startBridgeForDevices() {
	if (!session?.online) return;
	const { startBridgeConsumer, startBridgeProvider, bridgeFetch, bridgeShareOn, setBridgeNode } =
		await import('./sync/remote-bridge.js');
	const { knownDevices } = await import('./sync/device-sync.js');
	const { setBridgeTransport } = await import('./bridge/client.js');
	const libp2p = session.libp2p;
	const settings = session.store.settings;
	// The bridge's node, as the books know it (settings `bridge.peerId`, written at its pairing).
	const readNode = async () => {
		const saved = /** @type {any} */ (await getSetting(settings, 'bridge'));
		setBridgeNode(saved?.peerId ? { peerId: saved.peerId } : null);
		await loadBridgeAuth();
	};
	await readNode();
	const consumer = await startBridgeConsumer({
		libp2p,
		label: deviceLabel(),
		// `connected` only once the device proved the passkey (device-gate.js).
		devices: () => (app.sync.state?.devices ?? []).filter((d) => d.connected).map((d) => d.peerId),
		isProved: (peerId) => Boolean(session?.deviceGate?.isProved(peerId))
	});
	bridgeConsumer = consumer;
	setBridgeTransport(
		bridgeFetch({
			stream: () => consumer.streamFetch,
			remote: () => consumer.remoteFetch,
			onRoute: (r) => (app.sync.bridgeRoute = r)
		})
	);
	// The books' device list to the bridge's node whenever it changes, from any
	// device that is connected to it: a device removed here is refused there.
	let toldDevices = '';
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let tellTimer;
	const tellDevices = async () => {
		const records = await settings.list({ includeDeleted: true });
		const { whose } = await import('./members/whose.js');
		const members = whose(records);
		// Own devices, and a writing member's the owner let use the bridge (#641, #579).
		const list = knownDevices(records)
			.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
			.map((d) => d.peerId)
			.sort();
		const key = list.join(',');
		if (key === toldDevices) return;
		if (await consumer.tellDevices(list).catch(() => false)) toldDevices = key;
	};
	settings.onChange(() => {
		readNode().catch(() => {});
		clearTimeout(tellTimer);
		tellTimer = setTimeout(() => tellDevices().catch(() => {}), 1500);
	});
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
		isOwnDevice: async (peerId) => {
			if (!session?.deviceGate?.isProved(peerId)) return false;
			// The bridge's own node is no device that may use this one's bridge.
			if (!knownDevices(await settings.list()).some((d) => d.peerId === peerId && !d.bridge)) {
				return false;
			}
			// A member's device proves the same key, and is not one of these: the
			// share is for the owner's own devices (members reach a bridge only as
			// the owner admitted them).
			const { whose } = await import('./members/whose.js');
			return !whose(await settings.list({ includeDeleted: true })).isMemberDevice(peerId);
		}
	});
	app.sync.bridgeServed = true;
}

/** The generation of the bridge's key the books keep (settings `bridge.keyGeneration`), from 1. @param {any} saved */
const keyGenerationOf = (saved) =>
	Number.isSafeInteger(saved?.keyGeneration) && saved.keyGeneration >= 1 ? saved.keyGeneration : 1;

/**
 * The bridge's key for this session's gate (node.js `bridgeAuth`): the peer
 * the books name as their bridge and its key of the current generation. Read
 * before device sync dials anyone, and again when the settings change.
 */
async function loadBridgeAuth() {
	if (!session?.online || !session.bridgeAuthBase) return;
	const saved = /** @type {any} */ (await getSetting(session.store.settings, 'bridge'));
	const { bridgeAuthKeyOf } = await import('./database-keys.js');
	const peerId = typeof saved?.peerId === 'string' ? saved.peerId : null;
	session.bridgeAuth.key = peerId
		? await bridgeAuthKeyOf(session.bridgeAuthBase, keyGenerationOf(saved))
		: null;
	session.bridgeAuth.peerId = peerId;
}

/**
 * "Über Einladung koppeln" (Integrationen → Bridge, #575): pair the bridge's
 * own node by the invitation `pnpm bridge` printed, hand it the bridge's own
 * key (never the books' device key), the relays and the devices, and add it to
 * the books as their bridge. Then wait for it to come back armed and proved,
 * so the next call goes over the stream.
 *
 * @param {string} invitation `web+ucep:pair?…`
 * @returns {Promise<{ peerId: string }>} the bridge's node
 */
export async function pairBridgeNode(invitation) {
	if (!session?.online || !session.bridgeAuthBase || !deviceSync || !bridgeConsumer) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	const { knownDevices } = await import('./sync/device-sync.js');
	const { setBridgeNode } = await import('./sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('./database-keys.js');
	const settings = session.store.settings;
	const saved = /** @type {any} */ ((await getSetting(settings, 'bridge')) ?? {});
	const keyGeneration = keyGenerationOf(saved);
	const key = await bridgeAuthKeyOf(session.bridgeAuthBase, keyGeneration);
	const records = await settings.list({ includeDeleted: true });
	const { whose } = await import('./members/whose.js');
	const members = whose(records);
	// Own devices, and a writing member's the owner let use the bridge (#641, #579).
	const own = knownDevices(records)
		.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
		.map((d) => d.peerId);
	const { peerId, addrs } = await bridgeConsumer.pairBridge({
		invitation,
		authKey: key,
		relays: session.relays,
		devices: [session.peerId, ...own]
	});
	// Known as the books' bridge at once – the gate proves with its key toward it –
	// and in the books (settings `bridge`), for the other devices.
	session.bridgeAuth.peerId = peerId;
	session.bridgeAuth.key = key;
	setBridgeNode({ peerId });
	await setSetting(settings, 'bridge', {
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
	await deviceSync.addDevice(peerId, label, { bridge: true, addrs });
	while (!bridgeConsumer.streamServer() && Date.now() < until) {
		await new Promise((r) => setTimeout(r, 2000));
		if (!bridgeConsumer.streamServer())
			await deviceSync.addDevice(peerId, label, { bridge: true, addrs });
	}
	return { peerId };
}

/**
 * The hosted bridge the books know (settings `bridge/hosted`): which VM, its
 * name, its peer id and when it was last attested; never the peer key.
 *
 * @returns {Promise<{ instance: string, host: string, peerId: string, measurement: string, attestedAt: string } | null>}
 */
export async function hostedBridgeRecord() {
	if (!session?.store) return null;
	const { HOSTED_SETTING } = await import('./integrations/hosted-bridge.js');
	const kept = /** @type {any} */ (await getSetting(session.store.settings, HOSTED_SETTING));
	if (typeof kept?.instance !== 'string') return null;
	const { instance, host, peerId, measurement, attestedAt } = kept;
	return { instance, host, peerId, measurement, attestedAt };
}

/** The sealed settings record of the bridge on Phala, started through NEAR (#696). */
const NEAR_HOSTED_SETTING = 'bridge/hosted-near';

/**
 * The books on NEAR for the hosted bridge on Phala: their account (made on
 * the owner's device), its balance, the contract's view and the bridge this
 * browser last started.
 *
 * @returns {Promise<{ accountId: string, balance: bigint | null, contract: any, kept: any } | null>}
 */
export async function nearBridgeStatus() {
	if (!session?.store) return null;
	const nb = await import('./integrations/near-bridge.js');
	const settings = session.store.settings;
	const seed = await nb.ensureNearKey(settings, { create: !app.member });
	if (!seed) return null;
	const near = nb.nearBooks({ seed });
	const [balance, contract] = await Promise.all([near.balance(), near.view().catch(() => null)]);
	const kept = /** @type {any} */ (await getSetting(settings, NEAR_HOSTED_SETTING)) ?? null;
	return { accountId: near.books.accountId, balance, contract, kept };
}

/**
 * "Gehostete Bridge auf Phala, über NEAR" (#696): start the bridge in a TDX
 * VM through the NEAR contract and Le Space's launcher, and pair it in the
 * same step – what goes in is what goes into an Aleph VM (`hostedSecrets`):
 * its key of the books, its own peer key (made here, so its peer id is known
 * before it runs), the books' relays and devices. It goes only to the VM
 * whose quote the contract checked, sealed to that VM's key. The bridge
 * dials out to the relays; there is no inbound route to the VM.
 *
 * @param {{ onPhase?: (phase: string, detail?: any) => void }} [p]
 * @returns {Promise<{ peerId: string, composeHash: string }>}
 */
export async function startNearHostedBridge({ onPhase = () => {} } = {}) {
	if (!session?.online || !session.bridgeAuthBase || !deviceSync || !bridgeConsumer) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	const nb = await import('./integrations/near-bridge.js');
	const hosted = await import('./integrations/hosted-bridge.js');
	const { knownDevices } = await import('./sync/device-sync.js');
	const { setBridgeNode } = await import('./sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('./database-keys.js');
	const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import(
		'@libp2p/crypto/keys'
	);
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');

	const settings = session.store.settings;
	const seed = await nb.ensureNearKey(settings, { create: !app.member });
	if (!seed) throw new Error(t('messages.nearBridge.noKey'));
	const near = nb.nearBooks({ seed });
	if ((await near.balance()) === null) throw new Error(t('messages.nearBridge.notFunded'));
	if (!(session.relays ?? []).length) throw new Error(t('messages.nearBridge.noRelay'));

	// The bridge's own peer key: the one these books' NEAR bridge had, or a new one.
	const kept = /** @type {any} */ (await getSetting(settings, NEAR_HOSTED_SETTING));
	const peerKey =
		kept?.books === near.books.accountId && typeof kept?.peerKey === 'string'
			? privateKeyFromProtobuf(Uint8Array.from(atob(kept.peerKey), (c) => c.charCodeAt(0)))
			: await generateKeyPair('Ed25519');
	const peerKeyBytes = privateKeyToProtobuf(peerKey);
	const peerId = peerIdFromPrivateKey(peerKey).toString();

	const saved = /** @type {any} */ ((await getSetting(settings, 'bridge')) ?? {});
	const keyGeneration = keyGenerationOf(saved);
	const authKey = await bridgeAuthKeyOf(session.bridgeAuthBase, keyGeneration);

	// Made only once the contract shows the VM attested.
	const secrets = async () => {
		const records = await settings.list({ includeDeleted: true });
		const { whose } = await import('./members/whose.js');
		const members = whose(records);
		const own = knownDevices(records)
			.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
			.map((d) => d.peerId);
		const all = hosted.hostedSecrets({
			host: '',
			authKey,
			peerKey: peerKeyBytes,
			relays: session?.relays ?? [],
			devices: [session?.peerId ?? '', ...own].filter(Boolean)
		});
		// No HTTPS name: the VM on Phala has no inbound route.
		delete all.https_hostname;
		// What else it starts with (#728): the accounts and settings kept for a hosted bridge.
		const { withHostedSettings } = await import('./integrations/hosted-settings.js');
		return withHostedSettings(all, await keptHostedSettings());
	};

	const launcher = nb.launcherClient({ books: near.books });
	const { atMs, composeHash } = await nb.startNearBridge({ near, launcher, secrets, onPhase });

	const attestedAt = isoNow();
	await setSetting(settings, NEAR_HOSTED_SETTING, {
		books: near.books.accountId,
		peerId,
		peerKey: btoa(String.fromCharCode(...peerKeyBytes)),
		composeHash,
		atMs,
		attestedAt
	});
	// The books' bridge from now on, as after a handover.
	session.bridgeAuth.peerId = peerId;
	session.bridgeAuth.key = authKey;
	setBridgeNode({ peerId });
	await setSetting(settings, 'bridge', {
		token: null,
		...saved,
		peerId,
		keyGeneration,
		nodePairedAt: attestedAt
	});
	await deviceSync.addDevice(peerId, t('messages.nearBridge.deviceLabel'), { bridge: true });
	return { peerId, composeHash };
}

/** Stop the bridge on Phala: the contract forgets the VM at once, the launcher deletes it. */
export async function stopNearHostedBridge() {
	if (!session?.store) throw new Error(t('messages.bridge.needsSync'));
	const nb = await import('./integrations/near-bridge.js');
	const seed = await nb.ensureNearKey(session.store.settings, { create: false });
	if (!seed) throw new Error(t('messages.nearBridge.noKey'));
	return nb.stopNearBridge({ near: nb.nearBooks({ seed }) });
}

/**
 * The settings a hosted bridge starts with besides its pairing (#728),
 * from the books' sealed settings; empty when none are kept.
 *
 * @returns {Promise<import('./integrations/hosted-settings.js').HostedSettings>}
 */
async function keptHostedSettings() {
	const hs = await import('./integrations/hosted-settings.js');
	if (!session?.store) return hs.emptySettings();
	return hs.cleanSettings(await getSetting(session.store.settings, hs.HOSTED_SETTINGS_KEY));
}

/**
 * What is kept for a hosted bridge, by name only (never a value): for the cards.
 *
 * @returns {Promise<{ accounts: string[], sections: string[] }>}
 */
export async function hostedSettingsNames() {
	const hs = await import('./integrations/hosted-settings.js');
	return hs.keptNames(await keptHostedSettings());
}

/**
 * Keep settings for a hosted bridge, sealed in the books: over what is kept,
 * a section or an account replacing the one before. Only an owner's device.
 *
 * @param {unknown} settings `{ config, secrets }`
 */
export async function keepHostedSettings(settings) {
	if (!session?.store || app.member) throw new Error(t('messages.hostedSettings.ownerOnly'));
	const hs = await import('./integrations/hosted-settings.js');
	const merged = hs.mergeSettings(await keptHostedSettings(), hs.cleanSettings(settings));
	await setSetting(session.store.settings, hs.HOSTED_SETTINGS_KEY, merged);
	return hs.keptNames(merged);
}

/** Forget what is kept for a hosted bridge. */
export async function forgetHostedSettings() {
	if (!session?.store || app.member) throw new Error(t('messages.hostedSettings.ownerOnly'));
	const hs = await import('./integrations/hosted-settings.js');
	await setSetting(session.store.settings, hs.HOSTED_SETTINGS_KEY, hs.emptySettings());
}

/**
 * Take over the settings of the bridge on a computer (#728): it hands them
 * over the stream to the device that paired it, and they are kept sealed as
 * if typed in. The bridge on the computer keeps them and keeps working.
 */
export async function takeOverBridgeSettings() {
	const { createBridgeClient } = await import('./bridge/client.js');
	const exported = await createBridgeClient().settingsExport();
	return keepHostedSettings(exported);
}

/**
 * "Gehostete Bridge" (Integrationen → Bridge, #585): attest the bridge's VM
 * from this browser and unlock it, paired in the same step
 * (integrations/hosted-bridge.js). The VM is the books' Aleph key's: the
 * measurement names it and it signs the unlock. It is paid by that key or by
 * `payer` (Le Space's sub-account for these books; asked of Le Space Credits
 * when not given and they are switched on). The passphrase is the image's,
 * typed here and kept nowhere. The bridge's peer key is made here once per VM
 * and kept in the sealed settings, so a restart unlocks the same bridge again.
 *
 * `attempts` is how often the guest is asked before giving up (attest-wasm's
 * own patience when not given); `signal` cancels the waiting between them.
 * An error trying again will not help with is marked `fatal`
 * (integrations/hosted-unlock.js).
 *
 * @param {{ instance: string, passphrase: string, payer?: string, attempts?: number, signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string }) => void }} p
 * @returns {Promise<{ peerId: string, host: string, measurement: string }>}
 */
export async function unlockHostedBridge({
	instance,
	passphrase,
	payer,
	attempts,
	signal,
	onProgress = () => {}
}) {
	const { fatal, pause } = await import('./integrations/hosted-unlock.js');
	if (!session?.online || !session.bridgeAuthBase || !deviceSync || !bridgeConsumer) {
		throw fatal(t('messages.bridge.needsSync'));
	}
	const hosted = await import('./integrations/hosted-bridge.js');
	const { ensureBackupKey, alephEndpoints } = await import('./backup/keeper.js');
	const { alephAddressOf, alephSign } = await import('./backup/aleph-signer.js');
	const { twoN6Host } = await import('./ucep/net.js');
	const { knownDevices } = await import('./sync/device-sync.js');
	const { setBridgeNode } = await import('./sync/remote-bridge.js');
	const { bridgeAuthKeyOf } = await import('./database-keys.js');
	const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import(
		'@libp2p/crypto/keys'
	);
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');

	const hash = instance.trim();
	if (!hosted.isInstanceHash(hash)) throw fatal(t('messages.hostedBridge.notInstance'));
	if (!passphrase) throw fatal(t('messages.hostedBridge.noPassphrase'));
	const settings = session.store.settings;
	// The books' key, made on the owner's device as for the backup; a member's device waits for it (#613).
	const ownerKey = await ensureBackupKey(settings, { create: !app.member });
	if (!ownerKey) throw fatal(t('messages.hostedBridge.noAlephKey'));
	const owner = alephAddressOf(ownerKey);
	const { apiHost } = alephEndpoints();
	const relayUrl = hosted.attestUrlOf(session.relays ?? []);
	if (!relayUrl) throw fatal(t('messages.hostedBridge.noRelay'));

	onProgress({ phase: 'instance', detail: hash });
	const { content, crn, vcpus } = await hosted.fetchInstance(hash, { apiHost });
	// Paid by another account than the books' key: Le Space's sub-account for these books, or none.
	const payers = [owner];
	if (payer) payers.push(payer);
	else if (String(content?.address ?? '').toLowerCase() !== owner.toLowerCase()) {
		const sub = await leSpaceVmAccount(ownerKey).catch(() => null);
		if (sub) payers.push(sub);
	}
	const wasm = await import('@le-space/attest-wasm/pkg/relay_button_attest.js');
	await wasm.default();
	/** @type {any} */
	let published = null;
	/** @type {any} */
	let verify;
	if (import.meta.env.VITE_E2E === 'true') {
		// The fake agent's reports carry no AMD signature: the test names the
		// measurement, and only it is checked (as in bridge/test/support/fake-attest-agent.js).
		const pins = globalThis.localStorage?.getItem(hosted.E2E_HOSTED_PINS_KEY);
		if (pins) {
			published = JSON.parse(pins);
			verify = async (/** @type {any} */ { report, expectedMeasurements }) => {
				const m = Array.from(report.subarray(0x90, 0xc0), (/** @type {number} */ b) =>
					b.toString(16).padStart(2, '0')
				).join('');
				if (!expectedMeasurements.includes(m)) throw new Error('measurement not pinned');
				return { verified: true, measurement: m, policy: '0x30000', launchTcb: {} };
			};
		}
	}
	if (!published) {
		const { confidentialTrustedExecution } = await import('@le-space/attest-wasm/instance');
		published = await confidentialTrustedExecution({ wasm, owner, vcpus, apiHost, onProgress });
	}

	// The bridge's own peer key: the one made for this VM before, or a new one.
	const kept = /** @type {any} */ (await getSetting(settings, hosted.HOSTED_SETTING));
	const peerKey =
		kept?.instance === hash && typeof kept?.peerKey === 'string'
			? privateKeyFromProtobuf(Uint8Array.from(atob(kept.peerKey), (c) => c.charCodeAt(0)))
			: await generateKeyPair('Ed25519');
	const peerKeyBytes = privateKeyToProtobuf(peerKey);
	const peerId = peerIdFromPrivateKey(peerKey).toString();

	const saved = /** @type {any} */ ((await getSetting(settings, 'bridge')) ?? {});
	const keyGeneration = keyGenerationOf(saved);
	const authKey = await bridgeAuthKeyOf(session.bridgeAuthBase, keyGeneration);
	const records = await settings.list({ includeDeleted: true });
	const { whose } = await import('./members/whose.js');
	const members = whose(records);
	// Own devices, and a writing member's the owner let use the bridge (#641, #579): as at a handover.
	const own = knownDevices(records)
		.filter((d) => !d.bridge && members.mayUseBridge(d.peerId))
		.map((d) => d.peerId);
	const host = twoN6Host(hash);
	const secrets = hosted.hostedSecrets({
		host,
		authKey,
		peerKey: peerKeyBytes,
		relays: session.relays ?? [],
		devices: [session.peerId, ...own]
	});
	// What else it starts with (#728): the accounts and settings kept for a hosted bridge.
	const { withHostedSettings } = await import('./integrations/hosted-settings.js');
	const startWith = withHostedSettings(secrets, await keptHostedSettings());

	signal?.throwIfAborted();
	const result = await hosted.unlockHosted({
		instance: content,
		published,
		image: hosted.HOSTED_IMAGE,
		owner,
		payers,
		wasm,
		relayUrl,
		crnHash: crn,
		instanceItemHash: hash,
		passphrase,
		secrets: startWith,
		sign: async (/** @type {string} */ payload) => alephSign(ownerKey, payload),
		onProgress,
		sleep: (/** @type {number} */ ms) => pause(ms, signal),
		...(attempts ? { attempts } : {}),
		...(verify ? { verify } : {})
	});
	const attestedAt = isoNow();
	await setSetting(settings, hosted.HOSTED_SETTING, {
		instance: hash,
		host,
		peerId,
		peerKey: btoa(String.fromCharCode(...peerKeyBytes)),
		measurement: result.measurement,
		attestedAt
	});
	// The books' bridge from now on, as after a handover.
	session.bridgeAuth.peerId = peerId;
	session.bridgeAuth.key = authKey;
	setBridgeNode({ peerId });
	await setSetting(settings, 'bridge', {
		token: null,
		...saved,
		peerId,
		keyGeneration,
		nodePairedAt: attestedAt
	});
	const addrs = [`/dns4/${host}/tcp/443/tls/ws/p2p/${peerId}`];
	await deviceSync.addDevice(peerId, t('messages.hostedBridge.deviceLabel'), {
		bridge: true,
		addrs,
		hosted: { host }
	});
	return { peerId, host, measurement: result.measurement };
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

/**
 * The hosted bridge's VM as the books last recorded it (#587): which
 * instance, on which node, since when, at what price; null when none.
 */
export async function hostedVmRecord() {
	if (!session?.store) return null;
	const { VM_SETTING } = await import('./integrations/hosted-vm.js');
	const kept = /** @type {any} */ (await getSetting(session.store.settings, VM_SETTING));
	return typeof kept?.instance === 'string' ? kept : null;
}

/** Where Aleph's node list is read: Aleph's, or in an E2E build the fake Aleph's. */
async function hostedNodeList() {
	const vm = await import('./integrations/hosted-vm.js');
	if (import.meta.env.VITE_E2E === 'true') {
		const { E2E_ALEPH_URL_KEY } = await import('./backup/keeper.js');
		const base = globalThis.localStorage?.getItem(E2E_ALEPH_URL_KEY);
		if (base) return { url: `${base}/crns.json`, loopback: true };
	}
	return { url: vm.CRN_LIST, loopback: false };
}

/** The confidential nodes a hosted bridge can start on, best first (#587). */
export async function hostedNodes() {
	const { loadNodes } = await import('./integrations/hosted-vm.js');
	return loadNodes(await hostedNodeList());
}

/**
 * The books' Aleph key and its address, on a device that may start a VM.
 * @returns {Promise<{ key: Uint8Array, owner: string }>}
 */
async function hostedOwner() {
	if (!session?.store) throw new Error(t('messages.bridge.needsSync'));
	const { ensureBackupKey } = await import('./backup/keeper.js');
	const { alephAddressOf } = await import('./backup/aleph-signer.js');
	const key = await ensureBackupKey(session.store.settings, { create: !app.member });
	if (!key) throw new Error(t('messages.hostedBridge.noAlephKey'));
	return { key, owner: alephAddressOf(key) };
}

/** A Le Space Credits client for the books, or null while the person has not switched them on. */
async function creditsClientOf(/** @type {Uint8Array} */ key) {
	if (!session?.store) return null;
	const { ON_SETTING, createCreditsClient } = await import('./credits/credits.js');
	if ((await getSetting(session.store.settings, ON_SETTING)) !== true) return null;
	return createCreditsClient({ key });
}

/**
 * Le Space's sub-account that pays these books' VM, as Le Space Credits name
 * it; null when Credits are off or name none.
 *
 * @param {Uint8Array} key the books' Aleph key
 */
async function leSpaceVmAccount(key) {
	const client = await creditsClientOf(key);
	const owner = client ? (await client.balance())?.vm?.owner : null;
	return typeof owner === 'string' && /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner : null;
}

/**
 * What the hosted bridge card shows of Le Space Credits (#587): whether they
 * are on, the balance in credits, the plan and the hours it holds. Null
 * fields when Credits are off.
 */
export async function hostedCredits() {
	const { key } = await hostedOwner();
	const client = await creditsClientOf(key);
	if (!client) return { on: false, credits: null, plan: null, hoursLeft: null, periodEnd: null };
	const balance = await client.balance();
	const plan = balance?.package ?? null;
	return {
		on: true,
		credits: Number(balance?.credits ?? 0) - Number(balance?.reserved ?? 0),
		plan: plan?.id ?? null,
		hoursLeft: plan?.hours_left ?? null,
		periodEnd: plan?.period_end ?? null
	};
}

/**
 * "Paket wählen" on the hosted bridge card: a plan of the hosted bridge, paid
 * from the books' balance at Le Space Credits; its first period opens now.
 *
 * @param {string} planId one of credits.js BRIDGE_PLANS
 */
export async function chooseHostedPlan(planId) {
	const { BRIDGE_PLANS } = await import('./credits/credits.js');
	if (!BRIDGE_PLANS.some((p) => p.id === planId))
		throw new Error('not a plan of the hosted bridge');
	const { key } = await hostedOwner();
	const client = await creditsClientOf(key);
	if (!client) throw new Error(t('messages.hostedBridge.creditsOff'));
	await client.choosePlan(planId);
	return hostedCredits();
}

/**
 * Le Space's sub-account for these books, with the books' key authorized to
 * start, forget and forward its VM (Le Space Credits' model A).
 *
 * @param {Uint8Array} key @param {string} owner the books' key's address
 * @returns {Promise<{ payer: string, hoursLeft: number | null }>}
 */
async function authorizeLeSpacePayer(key, owner) {
	const client = await creditsClientOf(key);
	if (!client) throw new Error(t('messages.hostedBridge.creditsOff'));
	let answer;
	try {
		answer = await client.vmAuthorize(owner);
	} catch (e) {
		if (/** @type {any} */ (e)?.code === 'NO_PLAN')
			throw new Error(t('messages.hostedBridge.noPlan'));
		throw e;
	}
	if (!/^0x[0-9a-fA-F]{40}$/.test(String(answer?.owner ?? ''))) {
		throw new Error(t('messages.hostedBridge.noPayer'));
	}
	return { payer: answer.owner, hoursLeft: answer.hours_left ?? null };
}

/**
 * "Starten" on the "Gehostete Bridge" card (#587): ask Aleph for a
 * confidential VM of the published bridge image, owned by the books' Aleph
 * key and paid by `paidBy` – Le Space from the books' plan (its sub-account,
 * the books' key as delegate) or the books' key itself – then bring it up and
 * unlock and pair it (`continueHostedStart`). The VM is recorded, sealed, as
 * soon as Aleph has it, so a start that is interrupted carries on from there.
 *
 * @param {{ crn: string, passphrase: string, paidBy?: 'lespace' | 'books', signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string, attempt?: number, tries?: number }) => void }} p
 */
export async function startHostedBridge({
	crn,
	passphrase,
	paidBy = 'books',
	signal,
	onProgress = () => {}
}) {
	if (!session?.online || !session.bridgeAuthBase || !deviceSync) {
		throw new Error(t('messages.bridge.needsSync'));
	}
	if (!passphrase) throw new Error(t('messages.hostedBridge.noPassphrase'));
	const vm = await import('./integrations/hosted-vm.js');
	const hosted = await import('./integrations/hosted-bridge.js');
	const { alephEndpoints } = await import('./backup/keeper.js');
	const { alephSign } = await import('./backup/aleph-signer.js');
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const running = await hostedVmRecord();
	if (running && !running.stoppedAt) throw new Error(t('messages.hostedBridge.alreadyRunning'));

	onProgress({ phase: 'node', detail: crn });
	const node = (await hostedNodes()).find((n) => n.hash === crn);
	if (!node) throw new Error(t('messages.hostedBridge.noNode'));

	// Who pays: Le Space's sub-account for these books, or the books' key.
	let payer = owner;
	if (paidBy === 'lespace') {
		onProgress({ phase: 'payer', detail: '' });
		({ payer } = await authorizeLeSpacePayer(key, owner));
	}

	onProgress({ phase: 'measure', detail: '' });
	/** @type {any} */
	let trustedExecution = null;
	if (import.meta.env.VITE_E2E === 'true') {
		const pins = globalThis.localStorage?.getItem(hosted.E2E_HOSTED_PINS_KEY);
		if (pins) trustedExecution = JSON.parse(pins);
	}
	if (!trustedExecution) {
		const wasm = await import('@le-space/attest-wasm/pkg/relay_button_attest.js');
		await wasm.default();
		const { confidentialTrustedExecution } = await import('@le-space/attest-wasm/instance');
		trustedExecution = await confidentialTrustedExecution({
			wasm,
			owner,
			vcpus: vm.HOSTED_VM.vcpus,
			apiHost,
			onProgress
		});
	}

	const content = vm.instanceContent({
		payer,
		image: hosted.HOSTED_IMAGE,
		crn,
		trustedExecution,
		name: `belege-bridge-${isoNow().slice(0, 16)}`
	});
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	const message = await vm.signedMessage({ type: 'INSTANCE', content, sign, sender: owner });
	// Aleph takes the VM only with a day of its price in reserve: said here, before it refuses.
	const [perHour, credits] = await Promise.all([
		vm.creditsPerHour(message, { apiHost }),
		vm.creditsOf(payer, { apiHost })
	]);
	if (perHour && credits < vm.RESERVE_HOURS * perHour) {
		throw new Error(
			t(
				paidBy === 'lespace'
					? 'messages.hostedBridge.fewHours'
					: 'messages.hostedBridge.fewCredits',
				{
					needed: (vm.RESERVE_HOURS * perHour).toLocaleString(intlLocale()),
					credits: Math.floor(credits).toLocaleString(intlLocale()),
					perHour: perHour.toLocaleString(intlLocale())
				}
			)
		);
	}

	onProgress({ phase: 'requested', detail: message.item_hash });
	const instance = await vm.sendMessage(message, { apiHost });
	await setSetting(session.store.settings, vm.VM_SETTING, {
		instance,
		crn,
		nodeUrl: node.url,
		payer,
		paidBy,
		startedAt: isoNow(),
		creditsPerHour: perHour
	});
	return continueHostedStart({ passphrase, signal, onProgress });
}

/**
 * From a VM Aleph has to a paired bridge: the node told, 443 forwarded, then
 * the attestation and unlock of #585. The VM boots meanwhile; until its agent
 * answers, the unlock is tried again, each try once, and the card hears which
 * try it is and why the last one failed. An answer that refuses the VM
 * (another measurement, image or owner), or an error trying again will not
 * help with (integrations/hosted-unlock.js), ends it: no secret went out.
 * `signal` cancels the waiting; the VM keeps running.
 *
 * @param {{ passphrase: string, signal?: AbortSignal, onProgress?: (p: { phase: string, detail: string, attempt?: number, tries?: number }) => void, patience?: { tries?: number, delayMs?: number } }} p
 */
export async function continueHostedStart({
	passphrase,
	signal,
	onProgress = () => {},
	patience = {}
}) {
	if (!passphrase) throw new Error(t('messages.hostedBridge.noPassphrase'));
	const vm = await import('./integrations/hosted-vm.js');
	const { pause, reasonOf, unlockVerdict } = await import('./integrations/hosted-unlock.js');
	const { alephEndpoints } = await import('./backup/keeper.js');
	const { alephSign } = await import('./backup/aleph-signer.js');
	const record = await hostedVmRecord();
	if (!record || record.stoppedAt || !session?.store)
		throw new Error(t('messages.hostedBridge.noVm'));
	const settings = session.store.settings;
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const { loopback } = await hostedNodeList();
	const nodeUrl = vm.nodeUrlOf(record.nodeUrl, { loopback });
	if (!nodeUrl) throw new Error(t('messages.hostedBridge.noNode'));
	/** @type {{ tries?: number, delayMs?: number }} */
	let e2ePatience = {};
	if (import.meta.env.VITE_E2E === 'true') {
		// A test waits seconds, not minutes, for a VM that does not answer.
		try {
			e2ePatience = JSON.parse(
				globalThis.localStorage?.getItem('belege.e2e.hostedPatience') ?? '{}'
			);
		} catch {
			e2ePatience = {};
		}
	}
	const { tries = 60, delayMs = 10_000 } = { ...e2ePatience, ...patience };
	/** A node retries a failed start a few times; after three it is not going to work there. */
	const gaveUp = (/** @type {any} */ p) => Boolean(p?.failed && p.failed.attempts >= 3);

	onProgress({ phase: 'network', detail: record.instance });
	let placed = await vm.onNode(nodeUrl, record.instance);
	if (!placed) {
		await vm.notifyNode(nodeUrl, record.instance);
		placed = await vm.onNode(nodeUrl, record.instance);
	}
	// The account that pays the VM holds its port forwards; the books' key sends for it.
	const payer = typeof record.payer === 'string' ? record.payer : owner;
	if (!placed?.port443) {
		const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
		await vm.sendMessage(
			await vm.signedMessage({
				type: 'AGGREGATE',
				content: vm.forward443Content(payer, record.instance),
				sign,
				sender: owner
			}),
			{ apiHost }
		);
		for (let i = 0; i < tries && !placed?.port443; i++) {
			// The node gave up starting it: waiting longer will not help (#587).
			if (gaveUp(placed)) break;
			onProgress({ phase: 'network', detail: record.instance, attempt: i + 1, tries });
			await pause(delayMs, signal);
			placed = await vm.onNode(nodeUrl, record.instance);
		}
		if (gaveUp(placed)) {
			throw new Error(
				t('messages.hostedBridge.startupFailed', {
					code: placed?.failed?.code ?? '',
					attempts: placed?.failed?.attempts ?? 0
				})
			);
		}
		if (!placed?.port443) throw new Error(t('messages.hostedBridge.noPort'));
	}

	// The VM boots, and its agent answers only then.
	/** @type {unknown} */
	let last = null;
	for (let i = 0; i < tries; i++) {
		if (i) await pause(delayMs, signal);
		try {
			const done = await unlockHostedBridge({
				instance: record.instance,
				passphrase,
				payer,
				// This loop is the patience: one ask per try, so each try's reason is seen.
				attempts: 1,
				signal,
				onProgress
			});
			await setSetting(settings, vm.VM_SETTING, {
				...record,
				unlockedAt: isoNow()
			});
			return done;
		} catch (e) {
			last = e;
			// Refused, or nothing a later try changes: say why now instead of waiting.
			if (unlockVerdict(e) === 'stop') throw e;
			onProgress({ phase: 'boot', detail: reasonOf(e), attempt: i + 1, tries });
		}
	}
	throw last;
}

/**
 * "Stoppen" (#587): FORGET the VM; its node stops and drops it, and the VM
 * keeps nothing. The books keep when it ran, for the hours used; the hosted
 * bridge leaves the devices.
 */
export async function stopHostedBridge() {
	const vm = await import('./integrations/hosted-vm.js');
	const { alephEndpoints } = await import('./backup/keeper.js');
	const { alephSign } = await import('./backup/aleph-signer.js');
	const record = await hostedVmRecord();
	if (!record || record.stoppedAt || !session?.store)
		throw new Error(t('messages.hostedBridge.noVm'));
	const settings = session.store.settings;
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	const payer = typeof record.payer === 'string' ? record.payer : owner;
	await vm.sendMessage(
		await vm.signedMessage({
			type: 'FORGET',
			content: vm.forgetContent(payer, record.instance),
			sign,
			sender: owner
		}),
		{ apiHost }
	);
	const stoppedAt = isoNow();
	await setSetting(settings, vm.VM_SETTING, { ...record, stoppedAt });
	const paired = await hostedBridgeRecord();
	if (paired && paired.instance === record.instance && paired.peerId && deviceSync) {
		await deviceSync.removeDevice(paired.peerId).catch(() => {});
	}
	return { stoppedAt };
}

/**
 * The VMs the books' Aleph key started that Aleph still holds (#587), newest
 * first, with the node each runs on as Aleph's node list names it, and
 * whether it is the one these books recorded or unlocked.
 *
 * @returns {Promise<Array<import('./integrations/hosted-vm.js').OwnInstance & { nodeName: string | null, nodeUrl: string | null, known: boolean }>>}
 */
export async function hostedInstances() {
	const vm = await import('./integrations/hosted-vm.js');
	const { alephEndpoints } = await import('./backup/keeper.js');
	const { owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const [list, nodes, record, paired] = await Promise.all([
		vm.listInstances(owner, { apiHost }),
		hostedNodes().catch(() => []),
		hostedVmRecord(),
		hostedBridgeRecord()
	]);
	return list.map((i) => {
		const node = nodes.find((n) => n.hash === i.crn);
		const recorded = record?.instance === i.hash;
		return {
			...i,
			nodeName: node?.name ?? null,
			nodeUrl:
				node?.url ?? (recorded && typeof record?.nodeUrl === 'string' ? record.nodeUrl : null),
			known: recorded || paired?.instance === i.hash
		};
	});
}

/**
 * "Stoppen" for one of the books' key's VMs from the list (#587): FORGET it,
 * paid by whoever its INSTANCE names. The one these books recorded stops as
 * `stopHostedBridge` stops it.
 *
 * @param {string} instance
 */
export async function stopHostedInstance(instance) {
	const hash = String(instance ?? '').trim();
	const record = await hostedVmRecord();
	if (record && !record.stoppedAt && record.instance === hash) return stopHostedBridge();
	if (!session?.store) throw new Error(t('messages.bridge.needsSync'));
	const vm = await import('./integrations/hosted-vm.js');
	const hosted = await import('./integrations/hosted-bridge.js');
	const { alephEndpoints } = await import('./backup/keeper.js');
	const { alephSign } = await import('./backup/aleph-signer.js');
	if (!hosted.isInstanceHash(hash)) throw new Error(t('messages.hostedBridge.notInstance'));
	const { key, owner } = await hostedOwner();
	const { apiHost } = alephEndpoints();
	const { content } = await hosted.fetchInstance(hash, { apiHost });
	const payer = /^0x[0-9a-fA-F]{40}$/.test(String(content?.address ?? ''))
		? content.address
		: owner;
	const sign = async (/** @type {string} */ payload) => alephSign(key, payload);
	await vm.sendMessage(
		await vm.signedMessage({
			type: 'FORGET',
			content: vm.forgetContent(payer, hash),
			sign,
			sender: owner
		}),
		{ apiHost }
	);
	const paired = await hostedBridgeRecord();
	if (paired && paired.instance === hash && paired.peerId && deviceSync) {
		await deviceSync.removeDevice(paired.peerId).catch(() => {});
	}
	return { stoppedAt: isoNow() };
}

/**
 * A join code being answered (#611): its one-time key, the member's new root
 * and this passkey's PRF answer, in memory only until the answer comes.
 *
 * @type {{ key: { secretKey: Uint8Array, publicKey: Uint8Array }, memberRoot: Uint8Array, prfOutput: Uint8Array, credential: any, label: string } | null}
 */
let joining = null;

/** The pending join, wiped. */
function forgetJoining() {
	if (!joining) return;
	joining.key.secretKey.fill(0);
	joining.memberRoot.fill(0);
	joining.prfOutput.fill(0);
	joining = null;
}

/**
 * "Einer Buchhaltung beitreten" (#611), on the joining device: a join code to
 * send to the owner. The passkey this browser unlocks with answers once; its
 * PRF answer and the member's new root stay in memory until the answer is in.
 *
 * @param {string} label how the member calls themselves
 * @returns {Promise<{ text: string, fingerprint: string }>}
 */
export async function startJoining(label) {
	forgetJoining();
	const [
		{ loadStoredPasskeyCredential, readPrfOutput },
		{ createSecretSigner },
		join,
		vault,
		keys,
		sync
	] = await Promise.all([
		import('./passkey-identity.js'),
		import('@le-space/orbitdb-identity-provider-webauthn-did'),
		import('./members/join.js'),
		import('./members/member-vault.js'),
		import('./database-keys.js'),
		import('./sync/device-sync.js')
	]);
	const credential = loadStoredPasskeyCredential();
	if (!credential) throw new Error(t('members.join.noPasskey'));
	const prfOutput = await readPrfOutput(credential);
	const memberRoot = crypto.getRandomValues(new Uint8Array(32));
	const writer = (await createSecretSigner(memberRoot, { info: vault.MEMBER_IDENTITY_INFO })).did;
	const { generateKeyPairFromSeed } = await import('@libp2p/crypto/keys');
	const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
	const device = peerIdFromPrivateKey(
		await generateKeyPairFromSeed(
			'Ed25519',
			await keys.deriveDevicePeerSeed(memberRoot, sync.deviceSalt())
		)
	).toString();
	const request = join.createJoinRequest({ writer, device, label: label.trim() });
	joining = {
		key: { secretKey: request.secretKey, publicKey: request.publicKey },
		memberRoot,
		prfOutput,
		credential,
		label: label.trim()
	};
	return { text: request.text, fingerprint: request.fingerprint };
}

/**
 * The owner's answer to this device's join code (#611): the member vault made,
 * under this passkey. From the next unlock this passkey opens those books too.
 *
 * @param {string} answer `belege-member:…`
 * @returns {Promise<{ books: string }>} the books' name
 */
export async function finishJoining(answer) {
	const bundle = await openAnswer(answer);
	if (!joining) throw new Error(t('members.join.noCode'));
	const { createMemberVault } = await import('./members/member-vault.js');
	await createMemberVault({
		bundle,
		passkey: {
			prfOutput: joining.prfOutput,
			rawCredentialId: joining.credential.rawCredentialId,
			credentialId: String(joining.credential.credentialId ?? ''),
			label: joining.label
		},
		storage: globalThis.localStorage,
		memberRoot: Uint8Array.from(joining.memberRoot)
	});
	forgetJoining();
	return { books: bundle.books.label };
}

/** @param {string} answer */
async function openAnswer(answer) {
	if (!joining) throw new Error(t('members.join.noCode'));
	const { openJoinAnswer } = await import('./members/join.js');
	return openJoinAnswer(answer, joining.key).catch((/** @type {any} */ e) => {
		throw new Error(t(`members.error.${e?.code === 'otherCode' ? 'otherCode' : 'answer'}`));
	});
}

/**
 * The owner's answer read, nothing kept yet (#614 audit): which books it
 * opens, and their fingerprint – to compare with the owner's screen before
 * "Beitreten".
 *
 * @param {string} answer `belege-member:…`
 * @returns {Promise<{ books: string, fingerprint: string }>}
 */
export async function readJoinAnswer(answer) {
	const bundle = await openAnswer(answer);
	const { booksFingerprint } = await import('./members/join.js');
	return { books: bundle.books.label, fingerprint: booksFingerprint(bundle.books) };
}

/**
 * A join code read on the owner's device, nothing written yet: its
 * fingerprint and the name it gives – to compare with the bookkeeping's
 * screen before "Aufnehmen".
 *
 * @param {string} code `belege-join:…`
 * @returns {Promise<{ fingerprint: string, label: string }>}
 */
export async function readJoinCode(code) {
	const { parseJoinRequest } = await import('./members/join.js');
	try {
		const request = parseJoinRequest(code);
		return { fingerprint: request.fingerprint, label: request.label };
	} catch {
		throw new Error(t('members.error.code'));
	}
}

/** The join code shown, given up. */
export function cancelJoining() {
	forgetJoining();
}

/**
 * "Mitglied aufnehmen" (#611), on the owner's device: the join code read, the
 * member written into the books, its write identity granted, its device
 * listed – and the answer to send back, sealed to the code's one-time key.
 *
 * @param {{ code: string, label: string, booksLabel: string, role?: 'bookkeeping' | 'reader', bridge?: boolean }} p
 *   `bridge`: a writing member may use the owner's bridge (#641)
 * @returns {Promise<{ answer: string, fingerprint: string, books: string }>} `books`: the books' fingerprint
 */
export async function admitMember({
	code,
	label,
	booksLabel,
	role = 'bookkeeping',
	bridge = true
}) {
	if (!session) throw new Error(t('messages.sync.off'));
	const [{ parseJoinRequest, sealJoinAnswer }, { addMemberRecord, membersOf }] = await Promise.all([
		import('./members/join.js'),
		import('./members/members.js')
	]);
	/** @type {ReturnType<typeof parseJoinRequest>} */
	let request;
	try {
		request = parseJoinRequest(code);
	} catch {
		throw new Error(t('members.error.code'));
	}
	// A write identity taken out stays refused by every access list: it would
	// show as a member who can write nothing. A new join code brings a new one.
	const before = membersOf(await session.store.settings.list({ includeDeleted: true }));
	if (before.some((m) => m.writer === request.writer && m.removed)) {
		throw new Error(t('members.error.removedBefore'));
	}
	const name = label.trim() || request.label;
	const bundle = await session.memberBundle(booksLabel, role, {
		bridge: role !== 'reader' && bridge
	});
	const mayBridge = role !== 'reader' && bridge;
	// Who only reads gets no write access in any access list (#641).
	if (role !== 'reader') await session.grantWriter(request.writer);
	await addMemberRecord(session.store.settings, {
		writer: request.writer,
		label: name,
		role,
		devices: [request.device],
		bridge: mayBridge,
		invitedBy: app.did ?? '',
		at: isoNow()
	});
	if (deviceSync) await deviceSync.addDevice(request.device, name).catch(() => {});
	const answer = await sealJoinAnswer({ request, bundle });
	const { booksFingerprint } = await import('./members/join.js');
	return { answer, fingerprint: request.fingerprint, books: booksFingerprint(bundle.books) };
}

/**
 * Take a member out (#614), on the owner's device: what they wrote by now
 * stays, anything after is refused by every device (store/books-access.js);
 * their devices are taken off the list and refused. What they have read stays
 * with them: the keys change only with a move of the books.
 *
 * @param {string} writer the member's write identity
 */
export async function removeMember(writer) {
	if (!session) throw new Error(t('messages.sync.off'));
	ownerVault();
	const { membersOf, removeMemberRecord } = await import('./members/members.js');
	const settings = session.store.settings;
	const member = membersOf(await settings.list({ includeDeleted: true })).find(
		(m) => m.writer === writer && !m.removed
	);
	if (!member) throw new Error(t('members.error.unknown'));
	const theirs = await session.removeWriter(writer);
	const devices = [...member.devices, ...theirs.devices];
	for (const peerId of devices.filter((d, i) => devices.indexOf(d) === i)) {
		if (deviceSync) {
			await deviceSync.removeDevice(peerId).catch(() => {});
		} else {
			for (const r of await settings.list({ where: (x) => x.key === `device:${peerId}` }))
				await settings.softDelete(r.id);
		}
	}
	// What only the owner sets, as the member last set it: put back to unset.
	const { OWNER_SETTINGS } = await import('./members/members.js');
	const reset = theirs.settings.filter((k) => OWNER_SETTINGS.includes(k));
	for (const key of reset) {
		for (const r of await settings.list({ where: (x) => x.key === key }))
			await settings.softDelete(r.id);
	}
	await removeMemberRecord(settings, writer, { at: isoNow(), by: app.did ?? '' });
	return { reset, changed: theirs.settings.filter((k) => !OWNER_SETTINGS.includes(k)) };
}

/** The books are open to read only: a member in the role `reader` (#641). */
export const readOnly = () => session?.member?.role === 'reader';

/** A timestamp for a stored record, not reactive state. */
const isoNow = () => new Date().toISOString();

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

/**
 * A device that proved the books' key but is not on their list (first-contact.js):
 * let in by the person – it goes on the list and is dialled – or turned away.
 *
 * @param {string} peerId
 * @param {boolean} letIn
 */
export async function answerAskingDevice(peerId, letIn) {
	if (!deviceSync) throw new Error(t('messages.sync.off'));
	const { asking } = await import('./sync/device-sync.js');
	asking.delete(peerId);
	if (letIn) await deviceSync.addDevice(peerId);
	else deviceSync.refresh();
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
 * @param {{ lookupVault?: boolean, recovered?: Recovered, memberOf?: string }} [options] `lookupVault`: an empty
 *   device – ask Aleph's index for the vault (#406); `recovered`: opened with recovery words;
 *   `memberOf`: a member's books, by the member vault's id (#612)
 */
async function unlockWith(
	credential,
	progress,
	beforePrompt,
	{ lookupVault = false, recovered, memberOf } = {}
) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential, {
		onStatus: (s) => progress?.status(s),
		beforePrompt,
		lookupVault,
		...(recovered ? { recovered } : {}),
		...(memberOf ? { memberOf } : {})
	});
	// The books have new keys (#627): this passkey took the new vault – the
	// page opens it at once, with one more answer of the passkey – or has no
	// slot in it, and stays in the old books, which say so.
	if (session.moved && 'peers' in session.moved) {
		const { DIAL_STORAGE_KEY } = await import('./move/rekey.js');
		globalThis.localStorage.setItem(DIAL_STORAGE_KEY, JSON.stringify(session.moved.peers));
		await session.stop().catch(() => {});
		session = null;
		location.reload();
		return new Promise(() => {});
	}
	app.rekey = session.moved ? 'left' : '';
	app.member = session.member
		? {
				books: session.member.books.label,
				writer: session.member.writer,
				role: session.member.role
			}
		: null;
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
	// New keys made on this device (#627): the books packed before the reload come in.
	await takeOverAfterNewKeys().catch((e) => console.error('new keys:', e));
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
	// Not awaited: how long the credits keep the backups, for the header.
	import('./backup/credits-watch.js')
		.then(({ checkBackupCredits }) => checkBackupCredits())
		.catch(() => {});
	{
		// The bridge's calls wait until device sync has set up the stream to its node (#575).
		const { holdBridgeTransport } = await import('./bridge/client.js');
		const release = session?.online ? holdBridgeTransport() : () => {};
		startDeviceSyncIfOn()
			.finally(release)
			.then(watchQrConnections)
			.then(dialAfterNewKeys)
			.catch((e) => console.warn('device sync:', e));
	}
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
	let letSleep = () => {};
	let letQuiet = () => {};
	try {
		const credential = await getCredential();
		if (!credential) throw new Error(nothingFound);
		// After the passkey answered: from here on the books open, and that is shown.
		const { createUnlockProgress } = await import('./unlock-progress.js');
		const { holdAlive } = await import('./keep-alive.js');
		const { t } = await import('./i18n/index.js');
		let moving = false;
		progress = createUnlockProgress({
			onChange: (s) => {
				app.unlock = s;
				// A move of the books after an update takes minutes: a tone keeps
				// the tab from being frozen when a phone switches apps (#525). Only
				// then, not for every unlock; the click on "Öffnen" still counts.
				if (s.step === 'move' && !moving) {
					moving = true;
					letQuiet = holdAlive({ title: t('keepAlive.moving') });
				}
			}
		});
		// Opening may move the books after an update, for minutes: a phone must
		// not darken its screen meanwhile (#512).
		const { keepAwake } = await import('./wake-lock.js');
		letSleep = keepAwake();
		// A restore is an empty device: its passkey's vault may be on Aleph (#406),
		// asked unless the network is paused.
		const opened = recovered?.();
		// The books chosen on the unlock screen (#612): the own, or a member's.
		const { chosenBooks } = await import('./members/open-choice.js');
		const memberOf = flow === 'unlock' ? chosenBooks() : '';
		await unlockWith(credential, progress, passkeyStepsFor(flow), {
			lookupVault: flow === 'restore' && !networkPause(),
			...(opened ? { recovered: opened } : {}),
			...(memberOf ? { memberOf } : {})
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
	} finally {
		letSleep();
		letQuiet();
	}
}

/**
 * The books' vault, open – the owner's only: a member's session has none
 * (#612), and what changes the books' passkeys or words is the owner's.
 */
function ownerVault() {
	if (!session?.vault) throw new Error(t('members.ownerOnly'));
	return session.vault;
}

/** The setting that says the vault is published on Aleph (#406). */
const VAULT_INDEX_SETTING = 'vault/index';

/** What the keys page shows of the open vault. */
async function showVault() {
	// A member's session has no books' vault to show (#612).
	if (!session?.vault) return;
	const { record, kid } = ownerVault();
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
		root: ownerVault().root,
		record: ownerVault().record,
		passkeyKeys: [session.ownIndexKey, ...extraKeys],
		owner: await loadOwner(session.store.settings)
	});
	await setSetting(session.store.settings, VAULT_INDEX_SETTING, true);
	await showVault();
}

/**
 * The paying account a member's index on Aleph named (#613): what the backup
 * card shows until the books' own settings have come by sync.
 */
export const pointedOwner = () => session?.pointedOwner || null;

/**
 * "Neue Schlüssel für die Bücher" (#627), on the owner's device: a new root
 * and a new vault for the passkeys in `stay` – each answers once –, the books
 * packed for it and kept in this browser, their successor written into the
 * old books, and the page reloaded into the new books (move/rekey.js).
 *
 * @param {string[]} stay the slot ids of the passkeys that stay; this one among them
 */
export async function renewBooksKeys(stay) {
	if (!session) throw new Error('The books are not open.');
	const opened = ownerVault();
	if (!stay.includes(opened.kid)) throw new Error(t('settings.keys.rekey.thisOne'));
	const [
		vaultModule,
		{ readPrfOutput },
		{ WebAuthnDIDProvider },
		{ packBooks },
		rekey,
		keys,
		sync,
		{ releaseName }
	] = await Promise.all([
		import('./books-vault.js'),
		import('./passkey-identity.js'),
		import('@le-space/orbitdb-identity-provider-webauthn-did'),
		import('./move/book-move.js'),
		import('./move/rekey.js'),
		import('./database-keys.js'),
		import('./sync/device-sync.js'),
		import('./build-info.js')
	]);
	const wordsKid = await vaultModule.wordsSlotId();
	/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} */
	const answers = [];
	for (const slot of opened.record.slots.filter(
		(x) => stay.includes(x.kid) && x.kid !== wordsKid
	)) {
		const rawCredentialId = new Uint8Array(
			WebAuthnDIDProvider.base64urlToArrayBuffer(slot.credentialId)
		);
		answers.push({
			prfOutput: await readPrfOutput({ credentialId: slot.credentialId, rawCredentialId }),
			rawCredentialId
		});
	}
	const root = crypto.getRandomValues(new Uint8Array(32));
	try {
		const next = await vaultModule.newBooksVault(opened, answers, root);
		const byOthers = await session.settingsByOthers([...rekey.KEPT]);
		const blobs = currentBlobs();
		if (!blobs) throw new Error('The books are not open.');
		const { file } = await packBooks({
			store: /** @type {any} */ (session.store),
			blobs,
			seal: { to: rekey.rekeyMoveKey(root).publicKey },
			appVersion: releaseName() || 'dev',
			// What only the owner sets comes along only as the owner set it.
			kept: [...rekey.KEPT].filter((k) => !byOthers.includes(k)),
			dropped: [...rekey.DROPPED]
		});
		await rekey.keepRekeyFile(file);
		// Whom another device dials in the new books: this one, under its new id.
		const { generateKeyPairFromSeed } = await import('@libp2p/crypto/keys');
		const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
		const peer = peerIdFromPrivateKey(
			await generateKeyPairFromSeed(
				'Ed25519',
				await keys.deriveDevicePeerSeed(root, sync.deviceSalt())
			)
		).toString();
		const successor = { vault: next.record.vault, removed: next.record.removed, peers: [peer] };
		await setSetting(session.store.settings, rekey.SUCCESSOR_SETTING, successor);
		// For a device offline now: the old books' index on Aleph names it too,
		// when the vault is kept there.
		if (app.vault.indexOn && !networkPause()) {
			const { publishRootSuccessor } = await import('./backup/vault-index.js');
			await publishRootSuccessor({ root: opened.root, successor }).catch((e) =>
				console.warn('vault index:', e)
			);
		}
		// Devices connected now get it through the old books: a moment for that.
		if ((app.sync.state?.devices ?? []).some((d) => d.connected)) {
			await session.store.resync().catch(() => {});
			await new Promise((resolve) => setTimeout(resolve, 10_000));
		}
		// This browser takes the new vault now, so the reload opens the new books.
		vaultModule.replaceVaultRecord(opened.record.vault.id, next.record, globalThis.localStorage);
	} finally {
		root.fill(0);
		for (const a of answers) a.prfOutput.fill(0);
	}
	await session.stop().catch(() => {});
	session = null;
	location.reload();
}

/** The books packed for new keys (#627), taken over into the new books once. */
async function takeOverAfterNewKeys() {
	if (!session?.vault) return;
	const rekey = await import('./move/rekey.js');
	const file = await rekey.rekeyFile();
	if (!file) return;
	const { MoveError, openMoveFile, takeOverBooks } = await import('./move/book-move.js');
	/** @type {Awaited<ReturnType<typeof openMoveFile>>} */
	let opened;
	try {
		opened = await openMoveFile(file, rekey.rekeyMoveKey(session.vault.root));
	} catch (e) {
		// Sealed for other books: not for these, and kept for the ones it is for.
		if (e instanceof MoveError && e.code === 'key') return;
		throw e;
	}
	const blobs = currentBlobs();
	if (!blobs) return;
	app.rekey = 'taking';
	await takeOverBooks({ store: /** @type {any} */ (session.store), blobs, opened });
	await rekey.dropRekeyFile();
	app.rekey = 'done';
	await refresh();
	if (app.vault.indexOn && !networkPause()) {
		publishBooksVault().catch((e) => console.warn('vault index:', e));
	}
}

/** Another device of the owner, in the new books (#627): it dials the one that made them. */
async function dialAfterNewKeys() {
	const { DIAL_STORAGE_KEY } = await import('./move/rekey.js');
	const raw = globalThis.localStorage.getItem(DIAL_STORAGE_KEY);
	if (!raw || !deviceSync) return;
	/** @type {unknown} */
	let peers;
	try {
		peers = JSON.parse(raw);
	} catch {
		peers = [];
	}
	for (const peer of Array.isArray(peers) ? peers : []) {
		if (typeof peer === 'string' && peer) await deviceSync.addDevice(peer).catch(() => {});
	}
	globalThis.localStorage.removeItem(DIAL_STORAGE_KEY);
}

/**
 * A member's vault on Aleph (#613), with the account the books' backups are
 * kept for: an empty device with the member's passkey finds the books' keys
 * there, and with them the backups. Never while the network is paused.
 */
export async function publishMemberVault() {
	if (!session?.member) throw new Error('The books open are not a member’s.');
	if (networkPause()) throw new Error(t('settings.keys.paused'));
	const { loadOwner } = await import('./backup/keeper.js');
	await session.publishMembership(
		(await loadOwner(session.store.settings)) ?? (session.pointedOwner || null)
	);
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
		ownerVault(),
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
		session.vault = vaultModule.removePasskey(ownerVault(), kid, globalThis.localStorage);
	} else {
		const { readPrfOutput } = await import('./passkey-identity.js');
		const { WebAuthnDIDProvider } = await import(
			'@le-space/orbitdb-identity-provider-webauthn-did'
		);
		/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} */
		const answers = [];
		const wordsKid = await vaultModule.wordsSlotId();
		// The recovery words cannot answer here: a renewed vault has none, and says so.
		for (const slot of ownerVault().record.slots.filter(
			(s) => s.kid !== kid && s.kid !== wordsKid
		)) {
			const rawCredentialId = new Uint8Array(
				WebAuthnDIDProvider.base64urlToArrayBuffer(slot.credentialId)
			);
			const prfOutput = await readPrfOutput({ credentialId: slot.credentialId, rawCredentialId });
			answers.push({ prfOutput, rawCredentialId });
		}
		session.vault = await vaultModule.renewBooksVault(
			ownerVault(),
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
		session.vault = await addRecoveryWords(ownerVault(), seed, globalThis.localStorage);
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
	session.vault = await removeRecoveryWords(ownerVault(), globalThis.localStorage);
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
						opened = await vaultModule
							.newerWithWords(opened, current.vault, seed, current.slots)
							.catch((/** @type {any} */ e) => {
								if (e instanceof vaultModule.RemovedWordsError) {
									throw new Error(t('onboarding.words.removed'));
								}
								throw e;
							});
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
 * An E2E-only hook: tests add records through the real store, the way the
 * bank import does. Only in an E2E build (AGENTS.md), not in `vite dev`.
 */
function installE2EHooks() {
	if (import.meta.env.VITE_E2E !== 'true') return;
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
				// A member has none (#612).
				...(secrets.booksSecret ? { booksSecret: hex(secrets.booksSecret) } : {}),
				databaseKey: hex(secrets.databaseKey),
				replicationKey: hex(secrets.replicationKey),
				blobKey: hex(secrets.blobKey),
				peerKey: hex(secrets.peerKey)
			};
		},
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx),
		// The books' Aleph key's address (made if there is none yet), for a fake INSTANCE it owns (#585).
		alephAddress: async () => {
			if (!session?.store) return null;
			const { ensureBackupKey } = await import('./backup/keeper.js');
			const { alephAddressOf } = await import('./backup/aleph-signer.js');
			const key = await ensureBackupKey(session.store.settings);
			return key ? alephAddressOf(key) : null;
		},
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
		// A relay that dropped this device (sleep, another network): every connection to the relays hung up.
		hangUpRelays: async () => {
			const { relayPeerOf } = await import('./sync/first-contact.js');
			const peers = new Set((session?.relays ?? []).map((r) => relayPeerOf(r)).filter(Boolean));
			let closed = 0;
			for (const c of session?.libp2p?.getConnections?.() ?? []) {
				if (peers.has(c.remotePeer.toString())) {
					closed++;
					await c.close().catch(() => {});
				}
			}
			return { closed, relays: [...peers] };
		},
		// A backup's bytes, and putting them back, without Aleph (#628).
		backupBytes: async () => {
			const built = await session?.makeBackup({ appVersion: 'e2e' });
			return built ? Array.from(built.sealed) : null;
		},
		restoreBytes: async (/** @type {number[]} */ bytes) => {
			const done = await session?.restoreBackup(new Uint8Array(bytes));
			return done ? { target: done.target, databases: done.databases } : null;
		},
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

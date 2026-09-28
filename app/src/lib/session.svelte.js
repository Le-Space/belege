// App-wide state: who is signed in, and the records the pages show.
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting } from './store/settings.js';
import { classifyTransaction } from './matching/classify.js';
import { buildMatchingContext } from './matching/context.js';
import { cleanChart } from './booking/chart.js';

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
		bridgeServed: false
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
	const { pairedApp } = await import('./ucep/consumer.js');
	if (await pairedApp(session.store.settings)) await startUcep();
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
		const { createBelegeConsumer } = await import('./ucep/consumer.js');
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
	const { createBridgeClient } = await import('./bridge/client.js');
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
	setBridgeTransport(bridgeFetch({ remote: () => remoteFetch }));
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
		return `${browser} auf ${system}`;
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
	if (!deviceSync) throw new Error('Die Synchronisation ist auf diesem Gerät nicht an.');
	await deviceSync.addDevice(peerId.trim());
}

/** "Entfernen" in Integrationen → Eigene Geräte. @param {string} peerId */
export async function removeSyncDevice(peerId) {
	if (!deviceSync) throw new Error('Die Synchronisation ist auf diesem Gerät nicht an.');
	await deviceSync.removeDevice(peerId);
}

/** @param {any} credential */
async function unlockWith(credential) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential);
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
	await refresh();
	installE2EHooks();
	// Not awaited: the books are open, whatever the relay does.
	startUcepIfPaired();
	startDeviceSyncIfOn();
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
		'Der Passkey konnte nicht angelegt werden.'
	);
}

export function restorePasskey() {
	return run(
		() => restorePasskeyCredential(),
		'Auf diesem Gerät wurde kein Passkey für Belege gefunden.'
	);
}

export function unlockStoredPasskey() {
	return run(
		async () => loadStoredPasskeyCredential(),
		'In diesem Browser ist kein Passkey gespeichert.'
	);
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

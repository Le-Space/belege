// App-wide state: who is signed in, and the records the pages show.
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting } from './store/settings.js';
import { classifyTransaction } from './matching/classify.js';
import { buildMatchingContext } from './matching/context.js';

/** @typedef {import('./node.js').Session} Session */
/** @typedef {import('./store/repository.js').StoredRecord} StoredRecord */

export const app = $state({
	/** @type {'locked' | 'starting' | 'ready' | 'error'} */
	status: 'locked',
	/** @type {string | null} */
	error: null,
	/** @type {string | null} */
	did: null,
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
	/** whether an "Abgleich" is running */
	matching: false,
	/** @type {import('./matching/engine.js').MatchingProgress | null} where the running "Abgleich" is */
	matchingProgress: null
});

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

async function refresh() {
	if (!session) return;
	const [transactions, receipts, partners, accounts, matches, questions, events, matchingSettings] =
		await Promise.all([
			session.store.transactions.list(),
			session.store.receipts.list(),
			session.store.partners.list(),
			session.store.accounts.list(),
			session.store.matches.list(),
			session.store.questions.list(),
			session.store.events.list(),
			getSetting(session.store.settings, 'matching')
		]);
	const ctx = await buildMatchingContext({ accounts, transactions, settings: matchingSettings });
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

/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;
/** An import writes hundreds of records; the lists are read again once, after the burst. */
function scheduleRefresh() {
	if (refreshTimer) return;
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		void refresh();
	}, 100);
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
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx)
	};
}

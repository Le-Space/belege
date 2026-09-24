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
	/** @type {Record<string, import('./matching/classify.js').Classification>} bookings that need no receipt, by id */
	classifications: {},
	/** @type {any} the stored "Eigene Anweisungen" (settings key `matching`) */
	matchingSettings: null,
	/** whether an "Abgleich" is running */
	matching: false
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
	const [transactions, receipts, partners, accounts, matches, questions, matchingSettings] =
		await Promise.all([
			session.store.transactions.list(),
			session.store.receipts.list(),
			session.store.partners.list(),
			session.store.accounts.list(),
			session.store.matches.list(),
			session.store.questions.list(),
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
	app.classifications = classifications;
	app.matchingSettings = matchingSettings;
}

/** @type {Promise<unknown>} */
let matchingQueue = Promise.resolve();

/**
 * "Abgleich": receipts against transactions (matching/engine.js). Runs one at
 * a time; the lists are read again afterwards.
 *
 * @returns {Promise<{ sure: number, open: number, resolved: number, writes: number } | null>}
 */
export function runMatchingNow() {
	const next = matchingQueue.then(async () => {
		if (!session) return null;
		app.matching = true;
		try {
			const { runMatching } = await import('./matching/engine.js');
			return await runMatching({ store: session.store });
		} catch (error) {
			console.error('matching failed:', error);
			return null;
		} finally {
			app.matching = false;
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
		'settings'
	])) {
		session.store[name].onChange(scheduleRefresh);
	}
	await refresh();
	installE2EHooks();
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

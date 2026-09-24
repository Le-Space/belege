// App-wide state: who is signed in, and the records the pages show.
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';

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
	accounts: []
});

/** @type {Session | null} */
let session = null;

/** @returns {Session['store'] | null} */
export function currentStore() {
	return session?.store ?? null;
}

async function refresh() {
	if (!session) return;
	const [transactions, receipts, partners, accounts] = await Promise.all([
		session.store.transactions.list(),
		session.store.receipts.list(),
		session.store.partners.list(),
		session.store.accounts.list()
	]);
	app.transactions = transactions;
	app.receipts = receipts;
	app.partners = partners;
	app.accounts = accounts;
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
	for (const name of /** @type {const} */ (['transactions', 'receipts', 'partners', 'accounts'])) {
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
	const name = label.trim() || 'Belege';
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
				peerKey: hex(secrets.peerKey)
			};
		},
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx)
	};
}

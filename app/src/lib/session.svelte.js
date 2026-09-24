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
	partners: []
});

/** @type {Session | null} */
let session = null;

/** @returns {Session['store'] | null} */
export function currentStore() {
	return session?.store ?? null;
}

async function refresh() {
	if (!session) return;
	const [transactions, receipts, partners] = await Promise.all([
		session.store.transactions.list(),
		session.store.receipts.list(),
		session.store.partners.list()
	]);
	app.transactions = transactions;
	app.receipts = receipts;
	app.partners = partners;
}

/** @param {any} credential */
async function unlockWith(credential) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential);
	app.did = session.did;
	for (const name of /** @type {const} */ (['transactions', 'receipts', 'partners'])) {
		session.store[name].onChange(() => void refresh());
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
 * A dev/E2E-only hook: tests add records through the real store, exactly as
 * the bank import in step 2 will, without a form that does not exist yet.
 */
function installE2EHooks() {
	if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === 'true')) return;
	/** @type {any} */ (window).__belegeE2E = {
		did: () => app.did,
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx)
	};
}

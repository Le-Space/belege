// The bridge as Integrationen sees it (issue #152): where it is, whether this
// device is paired (the token, from the sealed settings), whether it answers
// and what is set up on it. Shared by the overview and every integration's
// own page, so pairing on one shows on the others.
import { createBridgeClient, DEFAULT_BRIDGE_URL } from '$lib/bridge/client.js';
import { currentStore } from '$lib/session.svelte.js';
import { getSetting, setSetting } from '$lib/store/settings.js';
import { t } from '$lib/i18n/index.js';

/**
 * @typedef {object} BridgeHealth what /health says is set up
 * @property {boolean} hibiscus
 * @property {boolean} kraken
 * @property {boolean} mail
 * @property {boolean} llm
 */

/** The time a pairing is stored with: a timestamp, not reactive state. */
const now = () => new Date();

export const bridge = $state({
	url: DEFAULT_BRIDGE_URL,
	/** @type {string | null} */
	token: null,
	/** @type {'unknown' | 'checking' | 'online' | 'offline'} */
	state: 'unknown',
	/** the bridge has paired some device (not necessarily this one) */
	paired: false,
	/** @type {BridgeHealth} */
	health: { hibiscus: false, kraken: false, mail: false, llm: false },
	/** @type {string | null} */
	error: null,
	/** the saved pairing has been read */
	loaded: false
});

/** A client with this device's token. */
export const bridgeClient = () => createBridgeClient({ url: bridge.url, token: bridge.token });

/** Read the saved pairing, then ask the bridge how it is. */
export async function loadBridge() {
	const store = currentStore();
	if (!store) return;
	const saved = /** @type {any} */ (await getSetting(store.settings, 'bridge'));
	if (saved?.url) bridge.url = saved.url;
	bridge.token = saved?.token ?? null;
	bridge.loaded = true;
	await checkBridge();
}

/** "Status prüfen". */
export async function checkBridge() {
	bridge.state = 'checking';
	bridge.error = null;
	try {
		const health = await createBridgeClient({ url: bridge.url }).health();
		bridge.state = health.ok ? 'online' : 'offline';
		bridge.paired = health.paired;
		bridge.health = {
			hibiscus: health.hibiscus?.configured ?? false,
			kraken: health.kraken?.configured ?? false,
			mail: health.mail?.configured ?? false,
			llm: health.llm?.configured ?? false
		};
	} catch (error) {
		bridge.state = 'offline';
		bridge.error = error instanceof Error ? error.message : String(error);
	}
}

/**
 * Pair with the code the bridge printed; the token goes into the sealed store,
 * never localStorage.
 *
 * @param {string} code
 */
export async function pairBridge(code) {
	const store = currentStore();
	if (!store) return false;
	bridge.error = null;
	try {
		const token = await createBridgeClient({ url: bridge.url }).pair(code.trim());
		await setSetting(store.settings, 'bridge', {
			url: bridge.url,
			token,
			pairedAt: now().toISOString()
		});
		bridge.token = token;
		await checkBridge();
		return true;
	} catch (error) {
		bridge.error = error instanceof Error ? error.message : String(error);
		return false;
	}
}

/** "Kopplung lösen": the bridge forgets the token too, so a copy of it is worthless. */
export async function unpairBridge() {
	const store = currentStore();
	if (!store) return;
	bridge.error = null;
	try {
		await bridgeClient().unpair();
	} catch {
		bridge.error = t('integrationen.bridge.unpairOffline');
	}
	await setSetting(store.settings, 'bridge', { url: bridge.url, token: null });
	bridge.token = null;
}

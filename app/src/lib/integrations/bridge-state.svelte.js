// The bridge as Integrationen sees it (issue #152): where it is, whether this
// device is paired (the token, from the sealed settings), whether it answers
// and what is set up on it. Shared by the overview and every integration's
// own page, so pairing on one shows on the others.
import { createBridgeClient, DEFAULT_BRIDGE_URL } from '$lib/bridge/client.js';
import { app, currentStore, refreshLlmRedaction } from '$lib/session.svelte.js';
import { getSetting, setSetting } from '$lib/store/settings.js';
import { t } from '$lib/i18n/index.js';
import { noteWayOut } from '$lib/help/way-out.js';

/**
 * @typedef {object} BridgeHealth what /health says is set up
 * @property {boolean} hibiscus
 * @property {boolean} kraken
 * @property {boolean} [paperless] Paperless-ngx set up on the bridge (#318)
 * @property {boolean} mail
 * @property {boolean} llm
 * @property {boolean} enablebanking
 * @property {boolean} backup the backup key for Aleph is made (`pnpm setup:aleph`, #77)
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
	health: {
		hibiscus: false,
		kraken: false,
		paperless: false,
		mail: false,
		llm: false,
		enablebanking: false,
		backup: false
	},
	/** @type {string | null} */
	error: null,
	/** the saved pairing has been read */
	loaded: false
});

/**
 * The bridge answers, but through an own device's (a phone using the Mac's,
 * #142): pairing, setup and unpairing belong to that device.
 */
export const bridgeViaDevice = () => bridge.state === 'online' && app.sync.bridgeRoute === 'device';

/** A client with this device's token. */
export const bridgeClient = () => createBridgeClient({ url: bridge.url, token: bridge.token });

/** The books whose settings are watched for a pairing that comes later. */
const watched = new WeakSet();
/** Reads of the pairing so far: only the latest one's answer counts. */
let reads = 0;

/**
 * While no token is known, every change to the settings reads it again: on a
 * device that reaches the bridge through another one (#142), the token is that
 * device's and comes with the books by sync – often after a page has read it.
 *
 * @param {{ settings: import('$lib/store/repository.js').Collection }} store the open books
 */
function watchForToken(store) {
	if (watched.has(store)) return;
	watched.add(store);
	let reading = false;
	let again = false;
	store.settings.onChange(async () => {
		if (bridge.token || currentStore() !== store) return;
		// A change during a read is read after it: it may be the one with the token.
		if (reading) return void (again = true);
		reading = true;
		try {
			do {
				again = false;
				const read = ++reads;
				const saved = /** @type {any} */ (await getSetting(store.settings, 'bridge'));
				if (saved?.token && read === reads && !bridge.token && currentStore() === store) {
					if (saved.url) bridge.url = saved.url;
					bridge.token = saved.token;
					await checkBridge();
				}
			} while (again && !bridge.token);
		} catch {
			// the next change reads it again
		} finally {
			reading = false;
		}
	});
}

/** Read the saved pairing, then ask the bridge how it is. */
export async function loadBridge() {
	const store = currentStore();
	if (!store) return;
	watchForToken(store);
	const read = ++reads;
	const saved = /** @type {any} */ (await getSetting(store.settings, 'bridge'));
	// A later read – the watcher's, with a token that just came – knows better.
	if (read === reads) {
		if (saved?.url) bridge.url = saved.url;
		bridge.token = saved?.token ?? null;
	}
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
			paperless: health.paperless?.configured ?? false,
			mail: health.mail?.configured ?? false,
			llm: health.llm?.configured ?? false,
			backup: health.backup?.aleph ?? false,
			enablebanking: health.enablebanking?.configured ?? false
		};
	} catch (error) {
		bridge.state = 'offline';
		bridge.error = error instanceof Error ? error.message : String(error);
		// Running, but not letting this page in: say so, with the command that does.
		const { diagnoseBridge } = await import('$lib/setup/diagnose.js');
		if ((await diagnoseBridge(bridge.url).catch(() => null)) === 'origin') {
			const message = t('integrationen.bridge.originRefused', { origin: location.origin });
			noteWayOut(message, 'origin');
			bridge.error = message;
		}
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
		// Not awaited: whether the AI hints may say "geschwärzt" (ai-text.js).
		refreshLlmRedaction();
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
	// The pairing is in the books, which own devices share: dropping it here would unpair the Mac.
	if (bridgeViaDevice()) return;
	bridge.error = null;
	try {
		await bridgeClient().unpair();
	} catch {
		bridge.error = t('integrationen.bridge.unpairOffline');
	}
	await setSetting(store.settings, 'bridge', { url: bridge.url, token: null });
	bridge.token = null;
}
